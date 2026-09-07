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

    // 1. Authenticate caller (Admin user JWT or Supabase Service Role for system automation)
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) throw new Error("Missing Authorization header");

    const isServiceRole = token === supabaseServiceKey;
    if (!isServiceRole) {
      const {
        data: { user },
      } = await adminClient.auth.getUser(token);

      if (!user) throw new Error("Invalid token");

      // Canonical Admin Role Verification
      let isAdmin = false;

      const { data: roleRow } = await adminClient
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();

      if (
        roleRow?.role === "admin" ||
        roleRow?.role === "owner" ||
        roleRow?.role === "staff" ||
        roleRow?.role === "manager"
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
        throw new Error("Unauthorized: Admin access required");
      }
    }

    // 2. Parse request payload
    const body = await req.json().catch(() => ({}));
    const { action, orderId, returnId } = body;

    if (!action || (!orderId && !returnId)) {
      throw new Error("Missing action, orderId, or returnId");
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
        throw new Error("Shiprocket credentials not configured in Supabase secrets");
      }

      const authRes = await fetch(`${srBaseUrl}/v1/external/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: srEmail, password: srPassword }),
      });

      const authData = await authRes.json().catch(() => ({}));
      if (!authRes.ok || !authData.token) {
        const err =
          authData.message ||
          (authData.errors ? Object.values(authData.errors).flat().join(", ") : "") ||
          "Failed to authenticate with Shiprocket";
        throw new Error(err);
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

    // Helper: Dynamically fetch active primary pickup location
    const getPrimaryPickupLocation = async (): Promise<string> => {
      try {
        const res = await fetch(`${srBaseUrl}/v1/external/settings/company/pickup`, {
          headers: { Authorization: `Bearer ${srToken}` },
        });
        if (res.ok) {
          const json = await res.json();
          const addresses = json?.data?.shipping_address || [];
          const primary =
            addresses.find((a: any) => a.is_primary_location === 1) || addresses[0];
          if (primary?.pickup_location) {
            return primary.pickup_location;
          }
        }
      } catch (err) {
        console.warn("[shiprocket-api] Failed to fetch pickup locations dynamically:", err);
      }
      return "work";
    };

    // --- Process Actions ---

    if (action === "create_return_shipment") {
      const targetReturnId = returnId || body.return_id;
      if (!targetReturnId) throw new Error("Missing returnId for reverse shipment");

      const { data: ret, error: retErr } = await adminClient
        .from("online_returns")
        .select("*, orders(*), online_return_items(*)")
        .eq("id", targetReturnId)
        .single();

      if (retErr || !ret) throw new Error("Online return record not found");

      if (ret.shiprocket_return_order_id) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Reverse pickup already created",
            shiprocket_return_order_id: ret.shiprocket_return_order_id,
            shiprocket_return_awb: ret.shiprocket_return_awb,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      const retOrder = ret.orders;
      const firstName = (retOrder?.full_name || "Customer").split(" ")[0];
      const lastName =
        (retOrder?.full_name || "Customer").split(" ").slice(1).join(" ") || firstName;

      const orderItems = (ret.online_return_items || []).map((i: any) => ({
        name: i.product_name_snapshot || "Product",
        sku: i.sku_snapshot || "SKU-RETURN",
        units: i.quantity_requested || 1,
        selling_price: i.historical_unit_price || 0,
        discount: 0,
        tax: 0,
        hsn: "",
      }));

      const returnPayload = {
        order_id: String(ret.return_number).substring(0, 20),
        order_date: new Date(ret.created_at).toISOString().split("T")[0],
        channel_id: "",
        pickup_customer_name: firstName,
        pickup_last_name: lastName,
        pickup_address: retOrder.address,
        pickup_address_2: retOrder.address_line2 || "",
        pickup_city: retOrder.city,
        pickup_state: retOrder.state,
        pickup_country: "India",
        pickup_pincode: retOrder.pincode,
        pickup_email: retOrder.email || "hello@zerahkids.com",
        pickup_phone: retOrder.phone,
        shipping_customer_name: "Zerah Baby & Kids Store",
        shipping_last_name: "Returns Department",
        shipping_address: "80 Feet Link Rd, near Bajot Restaurant",
        shipping_address_2: "Bajot Restaurant Circle",
        shipping_city: "Kota",
        shipping_state: "Rajasthan",
        shipping_country: "India",
        shipping_pincode: "324001",
        shipping_email: "hello@zerahkids.com",
        shipping_phone: "919057074777",
        order_items: orderItems,
        payment_method: "Prepaid",
        sub_total: ret.final_refund_amount || 100,
        length: 10,
        breadth: 10,
        height: 10,
        weight: 0.5,
      };

      const res = await fetch(`${srBaseUrl}/v1/external/orders/create/return`, {
        method: "POST",
        headers,
        body: JSON.stringify(returnPayload),
      });

      const srData = await res.json().catch(() => ({}));
      if (!res.ok || srData.status_code !== 1) {
        console.error("Shiprocket Create Return Error:", srData);
        const errMsg =
          srData.message ||
          (srData.errors ? Object.values(srData.errors).flat().join(", ") : "") ||
          "Shiprocket reverse pickup creation failed";
        return new Response(
          JSON.stringify({
            success: false,
            error: errMsg,
            details: srData,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
        );
      }

      await adminClient
        .from("online_returns")
        .update({
          shiprocket_return_order_id: srData.order_id,
          shiprocket_return_shipment_id: srData.shipment_id,
          shiprocket_return_status: "PICKUP_SCHEDULED",
          return_status: "PICKUP_SCHEDULED",
          pickup_scheduled_at: new Date().toISOString(),
        })
        .eq("id", targetReturnId);

      return new Response(
        JSON.stringify({
          success: true,
          shiprocket_return_order_id: srData.order_id,
          shiprocket_return_shipment_id: srData.shipment_id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // Fetch authoritative order details
    const { data: order, error: orderError } = await adminClient
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (orderError || !order) throw new Error("Order not found");

    if (action === "create_shipment") {
      if (order.shiprocket_order_id) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Shipment already created for this order",
            shiprocket_order_id: order.shiprocket_order_id,
            shiprocket_shipment_id: order.shiprocket_shipment_id,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          },
        );
      }

      // Fetch order items to build payload
      const { data: items, error: itemsError } = await adminClient
        .from("order_items")
        .select(
          `
          qty, quantity, price, name, sku_snapshot,
          products ( name, sku, stock, mrp )
        `,
        )
        .eq("order_id", orderId);

      if (itemsError) {
        console.error("[shiprocket-api] Failed to fetch order items:", itemsError);
        throw new Error(`Failed to fetch order items: ${itemsError.message}`);
      }

      const orderItems = (items || []).map(
        (i: {
          qty?: number;
          quantity?: number;
          price: number;
          name?: string;
          sku_snapshot?: string;
          products?: { name?: string; sku?: string; stock?: number; mrp?: number } | null;
        }) => {
          const units = i.qty || i.quantity || 1;
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
      const safeFullName = (order.full_name || "Customer").trim();
      const firstName = safeFullName.split(" ")[0] || "Customer";
      const lastName = safeFullName.split(" ").slice(1).join(" ") || firstName;

      const isCod = order.payment_method === "cod" || order.payment_method === "COD";

      const srOrderId =
        order.order_number ||
        `ORD-${String(order.id).replace(/-/g, "").substring(0, 12).toUpperCase()}`;

      const pickupLocation = await getPrimaryPickupLocation();

      const orderDate = new Date(order.created_at);
      const formattedDate = `${orderDate.getFullYear()}-${String(orderDate.getMonth() + 1).padStart(2, "0")}-${String(orderDate.getDate()).padStart(2, "0")} ${String(orderDate.getHours()).padStart(2, "0")}:${String(orderDate.getMinutes()).padStart(2, "0")}`;

      const payload = {
        order_id: srOrderId,
        order_date: formattedDate,
        pickup_location: pickupLocation,
        billing_customer_name: firstName,
        billing_last_name: lastName,
        billing_address: order.address,
        billing_address_2: order.address_line2 || "",
        billing_city: order.city,
        billing_pincode: order.pincode,
        billing_state: order.state,
        billing_country: "India",
        billing_email: order.email || "hello@zerahkids.com",
        billing_phone: order.phone,
        shipping_is_billing: true,
        order_items: orderItems,
        payment_method: isCod ? "COD" : "Prepaid",
        sub_total: Number(order.subtotal || order.total || 0),
        length: 10,
        breadth: 10,
        height: 10,
        weight: 0.5,
      };

      const res = await fetch(`${srBaseUrl}/v1/external/orders/create/adhoc`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const srData = await res.json().catch(() => ({}));
      if (
        !res.ok ||
        (srData.status_code !== 1 && srData.status_code !== 200 && !srData.order_id)
      ) {
        console.error("Shiprocket Create Order Error:", srData);
        const errMsg =
          srData.message ||
          (srData.errors ? Object.values(srData.errors).flat().join(", ") : "") ||
          "Failed to create shipment in Shiprocket";
        throw new Error(errMsg);
      }

      // Save to database
      await adminClient
        .from("orders")
        .update({
          shiprocket_order_id: srData.order_id,
          shiprocket_shipment_id: srData.shipment_id,
          shiprocket_status: srData.status || "NEW",
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
          courier_id: body.courierId || "",
        }),
      });

      const srData = await res.json().catch(() => ({}));
      if (!res.ok || !srData.awb_assign_status) {
        console.error("Shiprocket AWB Error:", srData);
        const errMsg =
          srData.message ||
          (srData.errors ? Object.values(srData.errors).flat().join(", ") : "") ||
          "Failed to generate AWB";
        throw new Error(errMsg);
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
          status: "processing",
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

      const srData = await res.json().catch(() => ({}));
      if (!res.ok || (srData.status !== 1 && srData.pickup_status !== 1 && !srData.response)) {
        console.error("Shiprocket Pickup Error:", srData);
        const errMsg =
          srData.message ||
          (srData.errors ? Object.values(srData.errors).flat().join(", ") : "") ||
          "Failed to request pickup";
        throw new Error(errMsg);
      }

      await adminClient
        .from("orders")
        .update({
          shiprocket_status: "PICKUP_SCHEDULED",
          status: "packed",
        })
        .eq("id", orderId);

      return new Response(
        JSON.stringify({ success: true, pickup_status: srData.pickup_status || "Scheduled" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
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
