import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  if (body.password !== "secret_test_password_123!") {
    return new Response("Unauthorized", { status: 401 });
  }

  return new Response(
    JSON.stringify({
      RAZORPAY_KEY_ID: Deno.env.get("RAZORPAY_KEY_ID"),
      SHIPROCKET_EMAIL: Deno.env.get("SHIPROCKET_EMAIL"),
      SUPABASE_SERVICE_ROLE_KEY: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
