import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
    const supabaseServiceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase server credentials not configured");
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Authenticate user from JWT token
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      throw new Error("Authentication required");
    }

    const {
      data: { user },
      error: userError,
    } = await adminClient.auth.getUser(token);

    if (userError || !user) {
      throw new Error("Unauthorized: Invalid session");
    }

    // 2. Verify user has admin privileges in user_roles
    const { data: roleRow, error: roleError } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleError || roleRow?.role !== "admin") {
      throw new Error("Unauthorized: Only store administrators can delete orders");
    }

    // 3. Parse request payload
    const body = await req.json().catch(() => ({}));
    const orderId = body.order_id || body._order_id || body.orderId;

    if (!orderId) {
      throw new Error("Missing order_id in request payload");
    }

    // 4. Fetch target order to verify existence and strict 'cancelled' status
    const { data: order, error: orderFetchError } = await adminClient
      .from("orders")
      .select("id, order_number, user_id, full_name, email, total, status, cancellation_reason")
      .eq("id", orderId)
      .maybeSingle();

    if (orderFetchError || !order) {
      throw new Error("Order not found in store database");
    }

    if (order.status !== "cancelled") {
      throw new Error(
        `This order cannot be deleted because its status is '${order.status}'. Only cancelled orders can be permanently deleted.`,
      );
    }

    // 5. Insert audit log record before deletion (safe if table exists)
    try {
      await adminClient.from("admin_order_deletion_logs").insert({
        order_id: order.id,
        order_number: order.order_number,
        user_id: order.user_id,
        customer_name: order.full_name,
        customer_email: order.email,
        total: order.total,
        cancellation_reason: order.cancellation_reason,
        deleted_by: user.id,
      });
    } catch (auditErr) {
      console.warn("[delete-cancelled-order] Audit log insert warning (non-blocking):", auditErr);
    }

    // 6. Delete dependent child records
    await adminClient.from("coupon_usage").delete().eq("order_id", orderId);
    await adminClient.from("order_items").delete().eq("order_id", orderId);
    await adminClient.from("order_status_history").delete().eq("order_id", orderId);
    await adminClient.from("payments").delete().eq("order_id", orderId);

    // 7. Delete the cancelled order
    const { error: deleteError } = await adminClient
      .from("orders")
      .delete()
      .eq("id", orderId)
      .eq("status", "cancelled");

    if (deleteError) {
      console.error("[delete-cancelled-order] Failed to delete order:", deleteError);
      throw new Error(deleteError.message || "Failed to delete cancelled order");
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Cancelled order deleted successfully.",
        order_id: orderId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error: unknown) {
    const message = (error as Error).message || "Failed to delete order";
    console.error("[delete-cancelled-order] Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
