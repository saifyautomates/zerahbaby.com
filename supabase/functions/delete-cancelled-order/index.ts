import { createClient } from "https://esm.sh/@supabase/supabase-js@2.21.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
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

    // 2. Canonical Admin Role Verification
    let isAdmin = false;

    const { data: roleRow } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (
      roleRow?.role === "admin" ||
      roleRow?.role === "owner" ||
      roleRow?.role === "manager" ||
      roleRow?.role === "staff"
    ) {
      isAdmin = true;
    }

    if (!isAdmin && user.email) {
      const { data: allowRow } = await adminClient
        .from("admin_allowlist")
        .select("email")
        .eq("email", user.email.toLowerCase().trim())
        .maybeSingle();
      if (allowRow) isAdmin = true;
    }

    if (!isAdmin) {
      const { data: profileRow } = await adminClient
        .from("profiles")
        .select("is_admin")
        .eq("id", user.id)
        .maybeSingle();
      if (profileRow?.is_admin === true) isAdmin = true;
    }

    if (!isAdmin) {
      const { data: rpcAdmin } = await adminClient.rpc("has_role", {
        _user_id: user.id,
        _role: "admin",
      });
      if (rpcAdmin === true) isAdmin = true;
    }

    if (!isAdmin) {
      throw new Error("Unauthorized: Only store administrators can delete orders");
    }

    // 3. Parse request payload
    const body = (await req.json().catch(() => ({}))) as {
      order_id?: string;
      _order_id?: string;
      orderId?: string;
    };
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
    // A. Clean up online return child items and return records
    const { data: retRows } = await adminClient
      .from("online_returns")
      .select("id")
      .eq("order_id", orderId);

    if (retRows && retRows.length > 0) {
      const retIds = retRows.map((r: { id: string }) => r.id);
      await adminClient.from("online_return_items").delete().in("return_id", retIds);
      await adminClient.from("online_returns").delete().eq("order_id", orderId);
    }

    // B. Clean up shipments, coupons, items, status history, and payments
    await adminClient.from("shiprocket_shipments").delete().eq("order_id", orderId);
    await adminClient.from("order_shipments").delete().eq("order_id", orderId);
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
