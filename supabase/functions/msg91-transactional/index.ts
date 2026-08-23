import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    const payload = await req.json();
    const { order_id, event_type, phone, name } = payload;

    if (!order_id || !event_type || !phone) {
      throw new Error("Missing required fields (order_id, event_type, phone)");
    }

    const msg91AuthKey = Deno.env.get("MSG91_AUTH_KEY");

    // Fallback template IDs - the user will configure these in Supabase Dashboard
    const templateMap: Record<string, string> = {
      order_placed: Deno.env.get("MSG91_TEMPLATE_ORDER_PLACED") || "TEMPLATE_ID_ORDER_PLACED",
      order_shipped: Deno.env.get("MSG91_TEMPLATE_ORDER_SHIPPED") || "TEMPLATE_ID_ORDER_SHIPPED",
      order_delivered:
        Deno.env.get("MSG91_TEMPLATE_ORDER_DELIVERED") || "TEMPLATE_ID_ORDER_DELIVERED",
      order_cancelled:
        Deno.env.get("MSG91_TEMPLATE_ORDER_CANCELLED") || "TEMPLATE_ID_ORDER_CANCELLED",
    };

    const templateId = templateMap[event_type];

    if (!templateId) {
      console.log(`No MSG91 template configured for event: ${event_type}`);
      return new Response(JSON.stringify({ success: true, message: "No template mapped" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    let providerStatus = "mock_success";
    let errorDetails = null;
    const cleanPhone = phone.replace("+", "");

    if (msg91AuthKey) {
      try {
        const url = "https://control.msg91.com/api/v5/flow/";

        // Construct the MSG91 Send Flow payload
        const msg91Payload = {
          template_id: templateId,
          short_url: "0",
          recipients: [
            {
              mobiles: cleanPhone,
              name: name || "Customer",
              order_id: order_id.substring(0, 8), // Provide a short, readable order ID for SMS
            },
          ],
        };

        const response = await fetch(url, {
          method: "POST",
          headers: {
            authkey: msg91AuthKey,
            "Content-Type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify(msg91Payload),
        });

        const result = await response.json();

        if (result.type === "error") {
          providerStatus = "error";
          errorDetails = result.message;
        } else {
          providerStatus = "sent";
        }
      } catch (err: unknown) {
        providerStatus = "error";
        errorDetails = (err as Error).message;
      }
    } else {
      console.warn("MSG91_AUTH_KEY not configured. Mocking success.");
    }

    // Log the outcome to our sms_logs table
    await adminClient.from("sms_logs").insert({
      order_id: order_id,
      phone: phone,
      message_type: event_type,
      provider_status: providerStatus,
      error_details: errorDetails,
    });

    return new Response(JSON.stringify({ success: true, providerStatus }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: unknown) {
    console.error("Transactional SMS Error:", error);

    // We try to log the catastrophic error if possible, but we don't have order_id guaranteed here
    // so we just return 400.
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
