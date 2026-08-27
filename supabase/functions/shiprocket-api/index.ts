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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim() || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Missing Supabase credentials");
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Authenticate user from JWT token (only admins allowed)
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) throw new Error("Missing Authorization header");

    const {
      data: { user },
    } = await adminClient.auth.getUser(token);

    if (!user) throw new Error("Invalid token");

    const { data: roleRow } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (roleRow?.role !== "admin") {
      throw new Error("Unauthorized: Admin access required");
    }

    // 2. Parse request payload
    const body = await req.json().catch(() => ({}));
    const { action, orderId } = body;

    if (!action || !orderId) {
      throw new Error("Missing action or orderId");
    }

    // --- Helper: Get Shiprocket Token ---
    const getShiprocketToken = async () => {
      // Check cache first
      const { data: cached } = await adminClient
        .from("shiprocket_tokens")
        .select("*")
        .eq("id", 1)
        .maybeSingle();

      if (cached && new Date(cached.expires_at) > new Date()) {
        return cached.token;
      }

      // Need new token
      const srEmail = Deno.env.get("SHIPROCKET_EMAIL")?.trim();
      const srPassword = Deno.env.get("SHIPROCKET_PASSWORD")?.trim();
      const srBaseUrl =
        Deno.env.get("SHIPROCKET_API_BASE_URL")?.trim() || "https://apiv2.shiprocket.in";

      if (!srEmail || !srPassword) {
        throw new Error("Shiprocket credentials not configured");
      }

      const authRes = await fetch(`${srBaseUrl}/v1/external/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: srEmail, password: srPassword }),
      });

      const authData = await authRes.json();
      if (!authRes.ok || !authData.token) {
        throw new Error("Failed to authenticate with Shiprocket");
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 9); // valid for ~10 days

      await adminClient.from("shiprocket_tokens").upsert({
        id: 1,
        token: authData.token,
        expires_at: expiresAt.toISOString(),
      });

      return authData.token;
    };

    const srToken = await getShiprocketToken();
    const srBaseUrl =
      Deno.env.get("SHIPROCKET_API_BASE_URL")?.trim() || "https://apiv2.shiprocket.in";
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${srToken}`,
    };

    // --- Process Actions ---

    // Fetch authoritative order details
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (orderError || !order) throw new Error("Order not found");

    if (action === "create_shipment") {
      if (order.shiprocket_order_id) {
        throw new Error("Shipment already created for this order");
      }

      // Fetch order items to build payload
      const { data: items, error: itemsError } = await adminClient
        .from("order_items")
        .select(
          `
          quantity, qty, price, name, sku_snapshot,
          products ( name, sku, stock, mrp )
        `,
        )
        .eq("order_id", orderId);

      if (itemsError) {
        console.error("[shiprocket-api] Failed to fetch order items:", itemsError);
        throw new Error("Failed to fetch order items for shipment creation");
      }

      const orderItems = (items || []).map(
        (i: {
          quantity?: number;
          qty?: number;
          price: number;
          name?: string;
          sku_snapshot?: string;
          products?: { name?: string; sku?: string; stock?: number; mrp?: number } | null;
        }) => {
          const units = i.quantity || i.qty || 1;
          const itemName = i.products?.name || i.name || "Product";
          const itemSku = i.products?.sku || i.sku_snapshot || "SKU-UNKNOWN";
          const mrpVal = i.products?.mrp || i.price;
          return {
            name: itemName,
            sku: itemSku,
            units,
            selling_price: i.price,
            discount: mrpVal ? Math.max(0, mrpVal - i.price) : 0,
            tax: 0,
            hsn: "",
          };
        },
      );

      if (orderItems.length === 0) {
        throw new Error("Cannot create shipment for order with no items");
      }

      // Calculate safe names and addresses
      const firstName = order.full_name.split(" ")[0];
      const lastName = order.full_name.split(" ").slice(1).join(" ") || firstName;

      const isCod = order.payment_method === "cod" || order.payment_method === "COD";

      const payload = {
        order_id: String(order.id).substring(0, 20), // SR requires max 20 chars
        order_date: new Date(order.created_at).toISOString().split("T")[0],
        pickup_location: "Primary", // Usually configured in SR panel
        billing_customer_name: firstName,
        billing_last_name: lastName,
        billing_address: order.address,
        billing_address_2: order.address_line2 || "",
        billing_city: order.city,
        billing_pincode: order.pincode,
        billing_state: order.state,
        billing_country: "India",
        billing_email: order.email || "noemail@zerah.in",
        billing_phone: order.phone,
        shipping_is_billing: true,
        order_items: orderItems,
        payment_method: isCod ? "COD" : "Prepaid",
        sub_total: order.subtotal,
        length: 10,
        breadth: 10,
        height: 10,
        weight: 0.5,
      };

      const res = await fetch(`${srBaseUrl}/v1/external/orders/create/ad-hoc`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const srData = await res.json();
      if (!res.ok || srData.status_code !== 1) {
        console.error("Shiprocket Create Order Error:", srData);
        throw new Error(srData.message || "Failed to create shipment in Shiprocket");
      }

      // Save to database
      await adminClient
        .from("orders")
        .update({
          shiprocket_order_id: srData.order_id,
          shiprocket_shipment_id: srData.shipment_id,
          shiprocket_status: "NEW",
        })
        .eq("id", orderId);

      return new Response(
        JSON.stringify({
          success: true,
          shiprocket_order_id: srData.order_id,
          shiprocket_shipment_id: srData.shipment_id,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    } else if (action === "generate_awb") {
      if (!order.shiprocket_shipment_id) throw new Error("Shipment ID missing");
      if (order.awb_code) throw new Error("AWB already generated");

      const res = await fetch(`${srBaseUrl}/v1/external/courier/assign/awb`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          shipment_id: order.shiprocket_shipment_id,
          courier_id: body.courierId || "", // Optionally pass specific courier, or let SR auto-assign if empty
        }),
      });

      const srData = await res.json();
      if (!res.ok || !srData.awb_assign_status) {
        console.error("Shiprocket AWB Error:", srData);
        throw new Error(srData.message || "Failed to generate AWB");
      }

      const awbCode = srData.response?.data?.awb_code;
      const courierName = srData.response?.data?.courier_name;

      if (!awbCode) throw new Error("AWB code not returned by Shiprocket");

      await adminClient
        .from("orders")
        .update({
          awb_code: awbCode,
          courier_name: courierName || "Assigned",
          shiprocket_status: "AWB_GENERATED",
          status: "processing", // Auto-update store order status
        })
        .eq("id", orderId);

      return new Response(
        JSON.stringify({ success: true, awb_code: awbCode, courier_name: courierName }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    } else if (action === "request_pickup") {
      if (!order.shiprocket_shipment_id) throw new Error("Shipment ID missing");

      const res = await fetch(`${srBaseUrl}/v1/external/courier/generate/pickup`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          shipment_id: [order.shiprocket_shipment_id],
        }),
      });

      const srData = await res.json();
      if (!res.ok) {
        console.error("Shiprocket Pickup Error:", srData);
        throw new Error(srData.message || "Failed to request pickup");
      }

      await adminClient
        .from("orders")
        .update({
          shiprocket_status: "PICKUP_SCHEDULED",
          status: "packed", // Auto-update store order status
        })
        .eq("id", orderId);

      return new Response(JSON.stringify({ success: true, pickup_status: srData.pickup_status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    } else {
      throw new Error(`Unknown action: ${action}`);
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.error("[shiprocket-api] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message || "Internal Server Error" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
