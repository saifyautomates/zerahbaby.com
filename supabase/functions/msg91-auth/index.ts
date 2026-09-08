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

  // Use WebCrypto API to hash the combination
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);

  // Convert to hex string and ensure it meets password requirements (add some symbols/uppercase)
  return "Zerah@" + new TextDecoder().decode(hexEncode(hashArray)).substring(0, 32);
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
    const msg91TemplateId = Deno.env.get("MSG91_OTP_TEMPLATE_ID");
    // Securely derive authSecret from private environment or fallback to service role key
    const authSecret =
      (Deno.env.get("MSG91_AUTH_SECRET") || "").trim() ||
      (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

    if (!authSecret) {
      throw new Error("Authentication secret not configured on server");
    }

    if (!msg91AuthKey) {
      console.warn("MSG91_AUTH_KEY not configured.");
    }

    const cleanPhone = phone.replace("+", ""); // MSG91 typically expects number without +

    if (action === "send") {
      if (msg91AuthKey) {
        const url = `https://control.msg91.com/api/v5/otp?template_id=${msg91TemplateId}&mobile=${cleanPhone}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { authkey: msg91AuthKey },
        });
        const result = await response.json();
        if (result.type === "error") throw new Error(result.message);
      }
      return new Response(JSON.stringify({ success: true, message: "OTP sent" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (action === "resend") {
      if (msg91AuthKey) {
        const url = `https://control.msg91.com/api/v5/otp/retry?retrytype=text&mobile=${cleanPhone}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { authkey: msg91AuthKey },
        });
        const result = await response.json();
        if (result.type === "error") throw new Error(result.message);
      }
      return new Response(JSON.stringify({ success: true, message: "OTP resent" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    if (action === "verify") {
      if (!otp) throw new Error("Missing OTP");

      if (msg91AuthKey) {
        const url = `https://control.msg91.com/api/v5/otp/verify?otp=${otp}&mobile=${cleanPhone}`;
        const response = await fetch(url, {
          method: "POST",
          headers: { authkey: msg91AuthKey },
        });
        const result = await response.json();
        if (result.type === "error") throw new Error(result.message);
      } else {
        const isDev = (Deno.env.get("ENVIRONMENT") || "").toLowerCase() === "development";
        if (!isDev) {
          throw new Error("SMS verification gateway is currently unconfigured or unavailable.");
        }
        // Mock verification only allowed in explicit dev environment
        if (otp !== "123456") throw new Error("Invalid OTP (Dev mock: use 123456)");
      }

      // ------------------------------------------------------------------
      // OTP Verified! Now we create or fetch the Supabase session
      // ------------------------------------------------------------------
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      });

      const derivedPassword = await generateDeterministicPassword(phone, authSecret);

      // Attempt to sign in
      let signInResult = await adminClient.auth.signInWithPassword({
        phone: phone,
        password: derivedPassword,
      });

      // If invalid credentials, the user might not exist OR the password changed
      if (signInResult.error && signInResult.error.message.includes("Invalid login credentials")) {
        // Create the user
        const createResult = await adminClient.auth.admin.createUser({
          phone: phone,
          password: derivedPassword,
          phone_confirm: true,
        });

        if (createResult.error) {
          // User might exist but with a different password, let's update it
          if (createResult.error.message.includes("already registered")) {
            // Use server-side phone lookup with robust 10-digit normalizer
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

        // Try sign in again after creation/update if not already signed in
        if (!signInResult.data?.session) {
          signInResult = await adminClient.auth.signInWithPassword({
            phone: phone,
            password: derivedPassword,
          });
        }
      }

      if (signInResult.error) {
        throw signInResult.error;
      }

      return new Response(
        JSON.stringify({
          success: true,
          session: signInResult.data.session,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    throw new Error("Invalid action");
  } catch (error: unknown) {
    console.error(error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
