import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper to convert an ArrayBuffer to a hex string without external dependencies
function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a deterministic password based on the phone number and a server-side secret.
 * This guarantees the user can log in natively to Supabase via phone without needing an actual password.
 */
async function generateDeterministicPassword(phone: string, secret: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${phone}:${secret}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return "Zerah@" + toHex(hashBuffer).substring(0, 32);
}

/**
 * Compute SHA-256 hash of an OTP bound to phone and server secret.
 * Plaintext OTPs are NEVER stored anywhere.
 */
async function hashOtp(phone: string, otp: string, secret: string) {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${phone}:${otp}:${secret}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return toHex(hashBuffer);
}

/**
 * Generate a cryptographically secure 4-digit numeric OTP (1000 to 9999).
 */
function generate4DigitOtp(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  const num = (buf[0] % 9000) + 1000;
  return num.toString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      phone?: string;
      otp?: string;
    };
    const { action, phone, otp } = body;

    if (!phone) throw new Error("Missing phone number");
    if (!action || !["send", "resend", "verify"].includes(action)) {
      throw new Error("Missing or invalid action (send, verify, resend)");
    }

    const msg91AuthKey = Deno.env.get("MSG91_AUTH_KEY");
    // Template ID for Zerah_Login_OTP (6aa1c8937992a371950d6052)
    const msg91TemplateId =
      (Deno.env.get("MSG91_OTP_TEMPLATE_ID") || "").trim() || "6aa1c8937992a371950d6052";
    const sender = (Deno.env.get("MSG91_SENDER_ID") || "").trim() || "ZERAHH";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Securely derive authSecret from private env or fallback to service role key
    const authSecret = (Deno.env.get("MSG91_AUTH_SECRET") || "").trim() || supabaseServiceKey;

    if (!authSecret) {
      throw new Error("Authentication secret not configured on server");
    }

    if (!msg91AuthKey) {
      throw new Error("SMS gateway is not configured. Please contact support.");
    }

    if (!msg91TemplateId) {
      throw new Error("MSG91_OTP_TEMPLATE_ID secret is not configured on server.");
    }

    // Normalise phone to 10 Indian digits + format for Supabase Auth
    const rawDigits = String(phone).replace(/\D/g, "");
    const tenDigits = rawDigits.slice(-10);
    if (tenDigits.length !== 10) {
      throw new Error("Please enter a valid 10-digit Indian mobile number.");
    }
    const cleanPhone = "91" + tenDigits; // Format for MSG91: 91XXXXXXXXXX
    const formattedPhone = "+91" + tenDigits; // Format for Supabase Auth: +91XXXXXXXXXX

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── SEND / RESEND OTP ───────────────────────────────────────────────────
    if (action === "send" || action === "resend") {
      // Cooldown protection: if recently requested within 20s, reject rapid spam
      const { data: existingOtp } = await adminClient
        .from("auth_otps")
        .select("created_at")
        .eq("phone", cleanPhone)
        .maybeSingle();

      if (existingOtp && existingOtp.created_at) {
        const elapsedSec = (Date.now() - new Date(existingOtp.created_at).getTime()) / 1000;
        if (elapsedSec < 15 && action === "send") {
          throw new Error("Please wait a few seconds before requesting another code.");
        }
      }

      // Generate 4-digit code & compute hash
      const otpCode = generate4DigitOtp();
      const otpHash = await hashOtp(cleanPhone, otpCode, authSecret);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

      // Store in auth_otps table
      const { error: dbError } = await adminClient.from("auth_otps").upsert(
        {
          phone: cleanPhone,
          otp_hash: otpHash,
          attempts: 0,
          expires_at: expiresAt,
          created_at: new Date().toISOString(),
        },
        { onConflict: "phone" },
      );

      if (dbError) {
        console.error(
          "[msg91-auth] DB upsert error:",
          dbError.message,
          dbError.code,
          dbError.details,
        );
        throw new Error("Could not initialize authentication session. Please try again.");
      }

      // Dispatch via MSG91 Flow API using approved Zerah_Login_OTP template
      // Matches DLT ID: 1777178887911531588, Sender: ZERAHH, variable: ##var##
      const flowPayload = {
        template_id: msg91TemplateId,
        sender: sender,
        short_url: "0",
        recipients: [
          {
            mobiles: cleanPhone,
            var: otpCode,
          },
        ],
      };

      const resp = await fetch("https://control.msg91.com/api/v5/flow/", {
        method: "POST",
        headers: {
          authkey: msg91AuthKey,
          "Content-Type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(flowPayload),
      });

      const resData = (await resp.json().catch(() => ({}))) as Record<string, any>;

      if (!resp.ok || resData.type === "error") {
        // Rollback un-dispatched OTP to prevent dangling unusable state
        await adminClient.from("auth_otps").delete().eq("phone", cleanPhone);
        console.error(
          "[msg91-auth] MSG91 Flow dispatch error:",
          resData.message || resp.statusText,
        );
        throw new Error(resData.message || "Failed to dispatch OTP SMS via gateway.");
      }

      const requestId = resData.message || resData.request_id || "dispatched";
      console.log(
        `[msg91-auth] 4-digit OTP dispatched: phone=${cleanPhone.substring(0, 4)}**** request_id=${requestId}`,
      );

      return new Response(
        JSON.stringify({
          success: true,
          message: "OTP sent",
          request_id: requestId,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // ── VERIFY OTP ──────────────────────────────────────────────────────────
    if (action === "verify") {
      if (!otp) throw new Error("Missing OTP");

      // Validate that OTP is strictly 4 digits
      const cleanOtp = String(otp).trim();
      if (!/^\d{4}$/.test(cleanOtp)) {
        throw new Error("Please enter the 4-digit code.");
      }

      // Fetch active OTP record from auth_otps table
      const { data: record, error: fetchErr } = await adminClient
        .from("auth_otps")
        .select("*")
        .eq("phone", cleanPhone)
        .maybeSingle();

      if (fetchErr || !record) {
        throw new Error("No active OTP found. Tap “Resend OTP” to get a new code.");
      }

      // Check expiry (10 minutes)
      if (new Date(record.expires_at).getTime() < Date.now()) {
        await adminClient.from("auth_otps").delete().eq("phone", cleanPhone);
        throw new Error("OTP has expired. Tap “Resend OTP” to get a fresh one.");
      }

      // Check brute force attempts
      if (record.attempts >= 5) {
        await adminClient.from("auth_otps").delete().eq("phone", cleanPhone);
        throw new Error("Too many incorrect attempts. Please request a new OTP.");
      }

      // Verify cryptographic hash
      const expectedHash = await hashOtp(cleanPhone, cleanOtp, authSecret);
      if (expectedHash !== record.otp_hash) {
        await adminClient
          .from("auth_otps")
          .update({ attempts: record.attempts + 1 })
          .eq("phone", cleanPhone);
        throw new Error("Incorrect OTP. Please double-check and try again.");
      }

      console.log(
        `[msg91-auth] OTP verified successfully: phone=${cleanPhone.substring(0, 4)}****`,
      );

      // ── SUPABASE AUTH SESSION ─────────────────────────────────────────────
      const derivedPassword = await generateDeterministicPassword(formattedPhone, authSecret);

      // Attempt initial sign in
      let signInResult = await adminClient.auth.signInWithPassword({
        phone: formattedPhone,
        password: derivedPassword,
      });

      // If sign in fails for ANY reason (e.g. Phone not confirmed, Invalid login credentials, user not created yet)
      if (signInResult.error) {
        console.log(
          `[msg91-auth] Initial signInWithPassword failed (${signInResult.error.message}). Resolving user state in Supabase Auth...`,
        );

        // Search for user in Supabase Auth by phone number
        let existingUser: any = null;
        let page = 1;
        while (!existingUser) {
          const { data: pageData, error: listErr } = await adminClient.auth.admin.listUsers({
            page,
            perPage: 1000,
          });
          if (listErr) {
            console.error("[msg91-auth] listUsers error:", listErr);
            break;
          }
          const users = pageData?.users || [];
          if (users.length === 0) break;
          existingUser = users.find((u: { phone?: string }) => {
            if (!u.phone) return false;
            const uDigits = u.phone.replace(/\D/g, "");
            return (
              u.phone === cleanPhone ||
              u.phone === formattedPhone ||
              uDigits.slice(-10) === tenDigits
            );
          });
          if (users.length < 1000) break;
          page++;
        }

        if (existingUser) {
          console.log(
            `[msg91-auth] Found existing user ${existingUser.id}, confirming phone and updating password...`,
          );
          const { error: updateErr } = await adminClient.auth.admin.updateUserById(
            existingUser.id,
            {
              phone_confirm: true,
              password: derivedPassword,
            },
          );
          if (updateErr) {
            console.error("[msg91-auth] updateUserById error:", updateErr);
          }

          const targetPhone = existingUser.phone || formattedPhone;
          signInResult = await adminClient.auth.signInWithPassword({
            phone: targetPhone,
            password: derivedPassword,
          });
        } else {
          // User doesn't exist yet, create user with phone_confirm: true
          console.log(`[msg91-auth] Creating new Supabase user for ${formattedPhone}...`);
          const createResult = await adminClient.auth.admin.createUser({
            phone: formattedPhone,
            password: derivedPassword,
            phone_confirm: true,
          });

          if (createResult.error) {
            console.error("[msg91-auth] createUser error:", createResult.error);
          }

          signInResult = await adminClient.auth.signInWithPassword({
            phone: formattedPhone,
            password: derivedPassword,
          });
        }
      }

      if (signInResult.error) {
        console.error("[msg91-auth] Final signInWithPassword failed:", signInResult.error);
        throw signInResult.error;
      }

      if (!signInResult.data?.session) {
        throw new Error("Failed to establish user session. Please try again.");
      }

      // OTP verified AND session established successfully!
      // Delete record from auth_otps to prevent replay
      await adminClient.from("auth_otps").delete().eq("phone", cleanPhone);

      return new Response(JSON.stringify({ success: true, session: signInResult.data.session }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    throw new Error("Invalid action");
  } catch (error: unknown) {
    const safeMsg = error instanceof Error ? error.message : String(error);
    console.error("[msg91-auth] Error:", safeMsg);
    return new Response(JSON.stringify({ error: safeMsg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
