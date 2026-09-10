import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";
import { encode as hexEncode } from "https://deno.land/std@0.177.0/encoding/hex.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Generate a deterministic password based on the phone number and a server-side secret.
 * This guarantees the user can log in natively to Supabase via phone without needing an actual password.
 */
async function generateDeterministicPassword(phone: string, secret: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${phone}:${secret}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return "Zerah@" + new TextDecoder().decode(hexEncode(hashArray)).substring(0, 32);
}

/**
 * Call MSG91 OTP API --- query-params only, NO JSON body.
 *
 * ROOT CAUSE FIX: MSG91 v5 OTP endpoint (/api/v5/otp, /api/v5/otp/retry,
 * /api/v5/otp/verify) uses ONLY query-parameters. Passing a JSON body alongside
 * query params causes MSG91 to ignore the query params and use internal defaults,
 * which means the template_id, mobile, and sender are silently ignored.
 * This results in MSG91 returning type:"success" but never dispatching the SMS.
 */
async function callMsg91OtpApi(
  endpoint: string,
  authKey: string,
  method: "POST" | "GET" = "POST",
): Promise<{ type: string; message?: string; request_id?: string }> {
  const response = await fetch(endpoint, {
    method,
    headers: {
      authkey: authKey,
      accept: "application/json",
      // NO Content-Type header, NO body --- MSG91 OTP API is query-param-only
    },
  });

  const result = await response
    .json()
    .catch(() => ({ type: "error", message: "MSG91 returned unparseable response" }));

  if (!response.ok) {
    throw new Error(`MSG91 HTTP ${response.status}: ${result?.message || "Unknown error"}`);
  }

  if (result.type === "error") {
    throw new Error(`MSG91 error: ${result.message || "Unknown MSG91 error"}`);
  }

  return result;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { action, phone, otp } = await req.json();

    if (!phone) throw new Error("Missing phone number");
    if (!action) throw new Error("Missing action (send, verify, resend)");

    const msg91AuthKey = Deno.env.get("MSG91_AUTH_KEY");
    // Template ID and sender --- read strictly from Supabase secrets
    const msg91TemplateId = (Deno.env.get("MSG91_OTP_TEMPLATE_ID") || "").trim();
    const sender = (Deno.env.get("MSG91_SENDER_ID") || "").trim() || "ZERAHH";

    // Securely derive authSecret from private env or fallback to service role key
    const authSecret =
      (Deno.env.get("MSG91_AUTH_SECRET") || "").trim() ||
      (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

    if (!authSecret) {
      throw new Error("Authentication secret not configured on server");
    }

    if (!msg91AuthKey) {
      // Hard error --- do NOT silently fall through to mock mode in production
      throw new Error("SMS gateway is not configured. Please contact support.");
    }

    if (!msg91TemplateId) {
      throw new Error("MSG91_OTP_TEMPLATE_ID secret is not configured on server.");
    }

    // MSG91 expects the mobile number WITHOUT leading + (e.g., 917014098198)
    const cleanPhone = phone.replace("+", "");

    // -- SEND OTP --------------------------------------------------------------
    if (action === "send") {
      // CORRECT format: query params only, zero body. Explicitly request 4-digit OTP.
      const url = `https://control.msg91.com/api/v5/otp?template_id=${msg91TemplateId}&mobile=${cleanPhone}&sender=${sender}&otp_length=4`;
      const providerResult = await callMsg91OtpApi(url, msg91AuthKey, "POST");

      console.log(
        `[msg91-auth] OTP dispatched: type=${providerResult.type} phone=${cleanPhone.substring(0, 4)}****`,
      );

      return new Response(
        JSON.stringify({ success: true, message: "OTP sent" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // -- RESEND OTP ------------------------------------------------------------
    if (action === "resend") {
      // MSG91 retry endpoint --- query-params only, GET method per official documentation
      const url = `https://control.msg91.com/api/v5/otp/retry?retrytype=text&mobile=${cleanPhone}`;
      await callMsg91OtpApi(url, msg91AuthKey, "GET");

      console.log(`[msg91-auth] OTP resent: phone=${cleanPhone.substring(0, 4)}****`);

      return new Response(
        JSON.stringify({ success: true, message: "OTP resent" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // -- VERIFY OTP ------------------------------------------------------------
    if (action === "verify") {
      if (!otp) throw new Error("Missing OTP");

      // Validate that OTP is strictly 4 digits (preserving leading zeros as string)
      const cleanOtp = String(otp).trim();
      if (!/^\d{4}$/.test(cleanOtp)) {
        throw new Error("OTP must contain exactly 4 digits");
      }

      // MSG91 OTP verify --- query-params only, GET method per official documentation
      const url = `https://control.msg91.com/api/v5/otp/verify?otp=${cleanOtp}&mobile=${cleanPhone}`;
      await callMsg91OtpApi(url, msg91AuthKey, "GET");

      console.log(`[msg91-auth] OTP verified: phone=${cleanPhone.substring(0, 4)}****`);

      // OTP Verified --- create or sign in to Supabase session
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });

      const derivedPassword = await generateDeterministicPassword(phone, authSecret);

      // Attempt to sign in first
      let signInResult = await adminClient.auth.signInWithPassword({
        phone: phone,
        password: derivedPassword,
      });

      // If invalid credentials, user might not exist yet OR password changed
      if (signInResult.error && signInResult.error.message.includes("Invalid login credentials")) {
        // Try to create the user
        const createResult = await adminClient.auth.admin.createUser({
          phone: phone,
          password: derivedPassword,
          phone_confirm: true,
        });

        if (createResult.error) {
          if (createResult.error.message.includes("already registered")) {
            // User exists with a different password --- find by phone and update
            const tenDigit = cleanPhone.replace(/\D/g, "").slice(-10);
            let existingUser: any = null;
            let page = 1;
            while (!existingUser) {
              const { data: pageData } = await adminClient.auth.admin.listUsers({
                page,
                perPage: 1000,
              });
              const users = pageData?.users || [];
              if (users.length === 0) break;
              existingUser = users.find((u: { phone?: string }) => {
                if (!u.phone) return false;
                const uDigits = u.phone.replace(/\D/g, "");
                return (
                  u.phone === cleanPhone ||
                  u.phone === phone ||
                  u.phone === `+${cleanPhone}` ||
                  (tenDigit.length === 10 && uDigits.slice(-10) === tenDigit)
                );
              });
              if (users.length < 1000) break;
              page++;
            }
            if (existingUser) {
              await adminClient.auth.admin.updateUserById(existingUser.id, {
                password: derivedPassword,
              });
              // Use the existing user's exact registered phone format for signInWithPassword
              if (existingUser.phone && existingUser.phone !== phone) {
                signInResult = await adminClient.auth.signInWithPassword({
                  phone: existingUser.phone,
                  password: derivedPassword,
                });
              }
            }
          } else {
            throw createResult.error;
          }
        }

        // Sign in after creation/update if not already done
        if (!signInResult.data?.session) {
          signInResult = await adminClient.auth.signInWithPassword({
            phone: phone,
            password: derivedPassword,
          });
        }
      }

      if (signInResult.error) throw signInResult.error;

      return new Response(
        JSON.stringify({ success: true, session: signInResult.data.session }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    throw new Error("Invalid action");
  } catch (error: unknown) {
    // Never log full error objects --- they may contain phone/OTP in stack traces
    const safeMsg = error instanceof Error ? error.message : String(error);
    console.error("[msg91-auth] Error:", safeMsg);
    return new Response(
      JSON.stringify({ error: safeMsg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
    );
  }
});
