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
    let authUser: { id: string; email?: string } | null = null;

    if (!isServiceRole) {
      const {
        data: { user },
      } = await adminClient.auth.getUser(token);

      if (!user) throw new Error("Invalid token");
      authUser = user;

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
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      orderId?: string;
      order_id?: string;
      returnId?: string;
      return_id?: string;
      courierId?: string;
      reason?: string;
      awbCode?: string;
    };
    const action = body.action;
    const orderId = body.orderId || body.order_id;
    const returnId = body.returnId || body.return_id;

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

      const authData = (await authRes.json().catch(() => ({}))) as Record<string, any>;
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

    const srBaseUrl =
      Deno.env.get("SHIPROCKET_API_BASE_URL")?.trim() || "https://apiv2.shiprocket.in";

    // Lazy load token when making remote calls
    let _cachedToken: string | null = null;
    const getHeaders = async () => {
      if (!_cachedToken) {
        _cachedToken = await getShiprocketToken();
      }
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${_cachedToken}`,
      };
    };

    // Helper: Dynamically fetch active primary pickup location
    const getPrimaryPickupLocation = async (): Promise<string> => {
      try {
        const headers = await getHeaders();
        const res = await fetch(`${srBaseUrl}/v1/external/settings/company/pickup`, {
          headers,
        });
        if (res.ok) {
          const json = (await res.json()) as Record<string, any>;
          const addresses = json?.data?.shipping_address || [];
          const primary = addresses.find((a: any) => a.is_primary_location === 1) || addresses[0];
          if (primary?.pickup_location) {
            return primary.pickup_location;
          }
        }
      } catch (err) {
        console.warn("[shiprocket-api] Failed to fetch pickup locations dynamically:", err);
      }
      return "work";
    };

    // --- Action: Create Return Shipment ---
    if (action === "create_return_shipment") {
      const targetReturnId = returnId;
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

      const headers = await getHeaders();
      const res = await fetch(`${srBaseUrl}/v1/external/orders/create/return`, {
        method: "POST",
        headers,
        body: JSON.stringify(returnPayload),
      });

      const srData = (await res.json().catch(() => ({}))) as Record<string, any>;
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
      .select("*, order_items(*)")
      .eq("id", orderId!)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ success: false, error: "Order not found" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 404 },
      );
    }

    // --- Action: Create Shipment ---
    if (action === "create_shipment") {
      if (order.shiprocket_order_id) {
        return new Response(
          JSON.stringify({
            success: true,
            message: "Shipment already created for this order",
            shiprocket_order_id: order.shiprocket_order_id,
            shiprocket_shipment_id: order.shiprocket_shipment_id,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      const { data: items, error: itemsError } = await adminClient
        .from("order_items")
        .select(
          `
          qty, quantity, price, name, sku_snapshot,
          products ( name, sku, stock, mrp )
        `,
        )
        .eq("order_id", orderId!);

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

      const headers = await getHeaders();
      const res = await fetch(`${srBaseUrl}/v1/external/orders/create/adhoc`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const srData = (await res.json().catch(() => ({}))) as Record<string, any>;
      if (!res.ok || (srData.status_code !== 1 && srData.status_code !== 200 && !srData.order_id)) {
        console.error("Shiprocket Create Order Error:", srData);
        const errMsg =
          srData.message ||
          (srData.errors ? Object.values(srData.errors).flat().join(", ") : "") ||
          "Failed to create shipment in Shiprocket";
        throw new Error(errMsg);
      }

      await adminClient
        .from("orders")
        .update({
          shiprocket_order_id: srData.order_id,
          shiprocket_shipment_id: srData.shipment_id,
          shiprocket_status: srData.status || "NEW",
        })
        .eq("id", orderId!);

      await adminClient.from("shipping_events").insert({
        order_id: orderId!,
        event_type: "SHIPMENT_CREATED",
        shiprocket_order_id: srData.order_id,
        shiprocket_shipment_id: srData.shipment_id,
        provider_status: srData.status || "NEW",
        actor_id: authUser?.id || null,
      });

      return new Response(
        JSON.stringify({
          success: true,
          shiprocket_order_id: srData.order_id,
          shiprocket_shipment_id: srData.shipment_id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // --- Action: Generate AWB ---
    else if (action === "generate_awb") {
      if (!order.shiprocket_shipment_id) throw new Error("Shipment ID missing");
      if (order.awb_code) {
        return new Response(
          JSON.stringify({
            success: true,
            awb_code: order.awb_code,
            courier_name: order.courier_name,
            already_assigned: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      const headers = await getHeaders();
      const res = await fetch(`${srBaseUrl}/v1/external/courier/assign/awb`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          shipment_id: order.shiprocket_shipment_id,
          courier_id: body.courierId || "",
        }),
      });

      const srData = (await res.json().catch(() => ({}))) as Record<string, any>;
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
        .eq("id", orderId!);

      await adminClient.from("shipping_events").insert({
        order_id: orderId!,
        event_type: "AWB_ASSIGNED",
        shiprocket_order_id: order.shiprocket_order_id,
        shiprocket_shipment_id: order.shiprocket_shipment_id,
        awb_code: awbCode,
        provider_status: "AWB_GENERATED",
        details: { courier_name: courierName },
        actor_id: authUser?.id || null,
      });

      return new Response(
        JSON.stringify({ success: true, awb_code: awbCode, courier_name: courierName }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // --- Action: Request Pickup ---
    else if (action === "request_pickup") {
      if (!order.shiprocket_shipment_id) throw new Error("Shipment ID missing");

      const headers = await getHeaders();
      const res = await fetch(`${srBaseUrl}/v1/external/courier/generate/pickup`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          shipment_id: [order.shiprocket_shipment_id],
        }),
      });

      const srData = (await res.json().catch(() => ({}))) as Record<string, any>;
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
        .eq("id", orderId!);

      await adminClient.from("shipping_events").insert({
        order_id: orderId!,
        event_type: "PICKUP_REQUESTED",
        shiprocket_order_id: order.shiprocket_order_id,
        shiprocket_shipment_id: order.shiprocket_shipment_id,
        awb_code: order.awb_code,
        provider_status: "PICKUP_SCHEDULED",
        actor_id: authUser?.id || null,
      });

      return new Response(
        JSON.stringify({ success: true, pickup_status: srData.pickup_status || "Scheduled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // --- Action: Generate Shipping Label ---
    else if (action === "generate_label") {
      if (!order.shiprocket_shipment_id) throw new Error("Shipment ID missing for label generation");

      if (order.shiprocket_label_url) {
        return new Response(
          JSON.stringify({
            success: true,
            label_url: order.shiprocket_label_url,
            already_generated: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      const headers = await getHeaders();
      const res = await fetch(`${srBaseUrl}/v1/external/courier/generate/label`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          shipment_id: [order.shiprocket_shipment_id],
        }),
      });

      const srData = (await res.json().catch(() => ({}))) as Record<string, any>;
      const labelUrl = srData.label_url || srData.response?.label_url;

      if (!res.ok || !labelUrl) {
        const errMsg =
          srData.message ||
          (srData.errors ? Object.values(srData.errors).flat().join(", ") : "") ||
          "Failed to generate shipping label from Shiprocket";
        throw new Error(errMsg);
      }

      await adminClient
        .from("orders")
        .update({ shiprocket_label_url: labelUrl })
        .eq("id", orderId!);

      await adminClient.from("shipping_events").insert({
        order_id: orderId!,
        event_type: "LABEL_GENERATED",
        shiprocket_order_id: order.shiprocket_order_id,
        shiprocket_shipment_id: order.shiprocket_shipment_id,
        awb_code: order.awb_code,
        details: { label_url: labelUrl },
        actor_id: authUser?.id || null,
      });

      return new Response(
        JSON.stringify({ success: true, label_url: labelUrl }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // --- Action: Generate Manifest ---
    else if (action === "generate_manifest") {
      if (!order.shiprocket_shipment_id) throw new Error("Shipment ID missing for manifest");

      if (order.shiprocket_manifest_url) {
        return new Response(
          JSON.stringify({
            success: true,
            manifest_url: order.shiprocket_manifest_url,
            already_generated: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      const headers = await getHeaders();
      const res = await fetch(`${srBaseUrl}/v1/external/manifests/generate`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          shipment_id: [order.shiprocket_shipment_id],
        }),
      });

      const srData = (await res.json().catch(() => ({}))) as Record<string, any>;
      let manifestUrl = srData.manifest_url;

      if (!manifestUrl && order.shiprocket_order_id) {
        const printRes = await fetch(`${srBaseUrl}/v1/external/manifests/print`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            order_ids: [order.shiprocket_order_id],
          }),
        });
        const printData = (await printRes.json().catch(() => ({}))) as Record<string, any>;
        manifestUrl = printData.manifest_url;
      }

      if (!manifestUrl) {
        const errMsg = srData.message || "Manifest not yet available from Shiprocket";
        throw new Error(errMsg);
      }

      await adminClient
        .from("orders")
        .update({ shiprocket_manifest_url: manifestUrl })
        .eq("id", orderId!);

      await adminClient.from("shipping_events").insert({
        order_id: orderId!,
        event_type: "MANIFEST_GENERATED",
        shiprocket_order_id: order.shiprocket_order_id,
        shiprocket_shipment_id: order.shiprocket_shipment_id,
        awb_code: order.awb_code,
        details: { manifest_url: manifestUrl },
        actor_id: authUser?.id || null,
      });

      return new Response(
        JSON.stringify({ success: true, manifest_url: manifestUrl }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // --- Action: Get Live Tracking & Synchronize Status ---
    else if (action === "get_tracking" || action === "sync_tracking") {
      const awb = order.awb_code || body.awbCode;
      let trackUrl = "";
      if (awb) {
        trackUrl = `${srBaseUrl}/v1/external/courier/track/awb/${awb}`;
      } else if (order.shiprocket_shipment_id) {
        trackUrl = `${srBaseUrl}/v1/external/courier/track/shipment/${order.shiprocket_shipment_id}`;
      } else if (order.shiprocket_order_id) {
        trackUrl = `${srBaseUrl}/v1/external/courier/track?order_id=${order.shiprocket_order_id}`;
      } else {
        throw new Error("No AWB or Shipment ID available to track");
      }

      const headers = await getHeaders();
      const res = await fetch(trackUrl, { headers });
      const srData = (await res.json().catch(() => ({}))) as Record<string, any>;

      const trackingInfo = srData.tracking_data || srData;
      const scans =
        trackingInfo?.shipment_track_activities ||
        trackingInfo?.scans ||
        trackingInfo?.shipment_track?.[0]?.scans ||
        [];
      const currentStatus = (
        trackingInfo?.shipment_status ||
        trackingInfo?.current_status ||
        trackingInfo?.shipment_track?.[0]?.current_status ||
        order.shiprocket_status ||
        ""
      )
        .toString()
        .toUpperCase();

      const updates: Record<string, any> = {
        shipping_last_synced_at: new Date().toISOString(),
        shipping_tracking_history: scans,
      };

      if (currentStatus) {
        updates.shiprocket_status = currentStatus;
        const terminalStates = ["delivered", "cancelled", "returned"];
        if (!terminalStates.includes(order.status)) {
          if (["SHIPPED", "IN TRANSIT", "OUT FOR DELIVERY"].includes(currentStatus)) {
            updates.status = "shipped";
          } else if (currentStatus === "DELIVERED") {
            updates.status = "delivered";
          } else if (
            ["RTO INITIATED", "RTO DELIVERED", "RETURNED", "CANCELLED"].includes(currentStatus)
          ) {
            updates.status = "cancelled";
          }
        }
      }

      await adminClient.from("orders").update(updates).eq("id", orderId!);

      await adminClient.from("shipping_events").insert({
        order_id: orderId!,
        event_type: "TRACKING_SYNCED",
        shiprocket_order_id: order.shiprocket_order_id,
        shiprocket_shipment_id: order.shiprocket_shipment_id,
        awb_code: order.awb_code,
        provider_status: currentStatus,
        details: { scans_count: scans.length, current_status: currentStatus },
        actor_id: authUser?.id || null,
      });

      return new Response(
        JSON.stringify({
          success: true,
          tracking_data: trackingInfo,
          scans,
          status: currentStatus,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    // --- Action: Critical Order & Shipment Cancellation ---
    else if (action === "cancel_shipment" || action === "cancel_order") {
      const reason = (body.reason || "Admin cancelled order via Zérah Admin Panel").trim();

      // Idempotency: already cancelled
      if (order.status === "cancelled" && order.shipping_cancellation_status === "CANCELLED") {
        return new Response(
          JSON.stringify({
            success: true,
            already_cancelled: true,
            message: "Order is already cancelled both locally and on Shiprocket.",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
        );
      }

      // Pre-flight check: Non-cancellable provider states
      const currentSrStatus = (order.shiprocket_status || "").toUpperCase().trim();
      const nonCancellableStatuses = [
        "SHIPPED",
        "IN_TRANSIT",
        "IN TRANSIT",
        "OUT_FOR_DELIVERY",
        "OUT FOR DELIVERY",
        "DELIVERED",
      ];

      if (nonCancellableStatuses.includes(currentSrStatus)) {
        const safeErrorMsg = `Order cancellation requested, but Shiprocket has already progressed the shipment to '${currentSrStatus}' and it cannot be cancelled through the current provider state.`;

        await adminClient
          .from("orders")
          .update({
            shipping_cancellation_status: "NOT_CANCELLABLE",
            shipping_error: safeErrorMsg,
          })
          .eq("id", orderId!);

        await adminClient.from("shipping_events").insert({
          order_id: orderId!,
          event_type: "CANCEL_REJECTED",
          shiprocket_order_id: order.shiprocket_order_id,
          shiprocket_shipment_id: order.shiprocket_shipment_id,
          awb_code: order.awb_code,
          provider_status: currentSrStatus,
          details: { reason, rejection: safeErrorMsg },
          actor_id: authUser?.id || null,
        });

        return new Response(
          JSON.stringify({
            success: false,
            non_cancellable: true,
            error: safeErrorMsg,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
        );
      }

      // Execute provider cancellation if linked to Shiprocket
      let providerCancelled = false;
      let providerNote = "";

      if (order.shiprocket_order_id || order.awb_code) {
        try {
          const headers = await getHeaders();

          // 1. If AWB exists, cancel shipment by AWB
          if (order.awb_code) {
            const awbRes = await fetch(`${srBaseUrl}/v1/external/orders/cancel/shipment/awbs`, {
              method: "POST",
              headers,
              body: JSON.stringify({ awbs: [order.awb_code] }),
            });
            const awbData = (await awbRes.json().catch(() => ({}))) as Record<string, any>;
            console.log("[shiprocket-api] Cancel AWB response:", awbData);
          }

          // 2. Cancel order by Shiprocket Order ID
          if (order.shiprocket_order_id) {
            const cancelRes = await fetch(`${srBaseUrl}/v1/external/orders/cancel`, {
              method: "POST",
              headers,
              body: JSON.stringify({ ids: [order.shiprocket_order_id] }),
            });
            const cancelData = (await cancelRes.json().catch(() => ({}))) as Record<string, any>;
            console.log("[shiprocket-api] Cancel Order response:", cancelData);

            if (!cancelRes.ok && cancelData.status_code !== 200 && cancelData.status !== 200) {
              const errMsg = cancelData.message || "Shiprocket rejected order cancellation";
              if (
                errMsg.toLowerCase().includes("pickup") ||
                errMsg.toLowerCase().includes("transit") ||
                errMsg.toLowerCase().includes("delivered")
              ) {
                const safeErrorMsg = `Order cancellation requested, but Shiprocket has already progressed the shipment and it cannot be cancelled through the current provider state. (${errMsg})`;
                await adminClient
                  .from("orders")
                  .update({
                    shipping_cancellation_status: "NOT_CANCELLABLE",
                    shipping_error: safeErrorMsg,
                  })
                  .eq("id", orderId!);

                return new Response(
                  JSON.stringify({
                    success: false,
                    non_cancellable: true,
                    error: safeErrorMsg,
                  }),
                  { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
                );
              }
            }
          }
          providerCancelled = true;
          providerNote = "Shiprocket shipment & order cancelled successfully.";
        } catch (srErr: any) {
          console.error("[shiprocket-api] Provider cancel error:", srErr);
          await adminClient
            .from("orders")
            .update({
              shipping_cancellation_status: "CANCELLATION_FAILED",
              shipping_error: srErr.message || "Network error communicating with Shiprocket",
            })
            .eq("id", orderId!);

          await adminClient.from("shipping_events").insert({
            order_id: orderId!,
            event_type: "CANCEL_FAILED",
            shiprocket_order_id: order.shiprocket_order_id,
            shiprocket_shipment_id: order.shiprocket_shipment_id,
            awb_code: order.awb_code,
            details: { error: srErr.message, reason },
            actor_id: authUser?.id || null,
          });

          return new Response(
            JSON.stringify({
              success: false,
              error: `Failed to cancel shipment with Shiprocket: ${srErr.message}. The local order was not marked cancelled. Please retry.`,
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 502 },
          );
        }
      } else {
        providerNote = "Order was not yet pushed to Shiprocket. Local cancellation only.";
      }

      // Provider cancellation succeeded or not applicable: finalize local cancellation
      const cancelledAt = new Date().toISOString();
      await adminClient
        .from("orders")
        .update({
          status: "cancelled",
          shiprocket_status: "CANCELLED",
          shipping_cancellation_status: "CANCELLED",
          shipping_cancellation_reason: reason,
          shipping_cancellation_completed_at: cancelledAt,
          cancelled_at: cancelledAt,
          cancellation_reason: reason,
          cancelled_by: authUser?.id || "admin",
        })
        .eq("id", orderId!);

      // Restore inventory atomically for all order items
      const items = order.order_items || [];
      for (const item of items) {
        const qty = Number(item.qty || item.quantity || 1);
        if (item.product_id && qty > 0) {
          await adminClient.from("inventory_transactions").insert({
            product_id: item.product_id,
            variant_id: item.variant_id || null,
            transaction_type: "adjustment",
            quantity: qty,
            reference_type: "order",
            reference_id: orderId!,
            notes: `Stock restored due to order cancellation: ${reason}`,
            created_by: authUser?.id || null,
          });

          if (item.variant_id) {
            const { data: vRow } = await adminClient
              .from("product_variants")
              .select("stock")
              .eq("id", item.variant_id)
              .single();
            if (vRow) {
              await adminClient
                .from("product_variants")
                .update({ stock: (vRow.stock || 0) + qty })
                .eq("id", item.variant_id);
            }
          } else {
            const { data: pRow } = await adminClient
              .from("products")
              .select("stock")
              .eq("id", item.product_id)
              .single();
            if (pRow) {
              await adminClient
                .from("products")
                .update({ stock: (pRow.stock || 0) + qty })
                .eq("id", item.product_id);
            }
          }
        }
      }

      // Log shipping event
      await adminClient.from("shipping_events").insert({
        order_id: orderId!,
        event_type: "CANCELLED",
        shiprocket_order_id: order.shiprocket_order_id,
        shiprocket_shipment_id: order.shiprocket_shipment_id,
        awb_code: order.awb_code,
        provider_status: "CANCELLED",
        details: { reason, providerNote },
        actor_id: authUser?.id || null,
      });

      // Log in order status history
      await adminClient.from("order_status_history").insert({
        order_id: orderId!,
        new_status: "cancelled",
        note: `Order & Shiprocket shipment cancelled: ${reason}. Stock restored.`,
        changed_by: authUser?.id || null,
      });

      // Trigger automatic gateway refund for online paid orders (non-blocking)
      const pMethod = (order.payment_method || "").toLowerCase();
      const isPaid = order.payment_status === "paid" || Boolean(order.razorpay_payment_id);
      if (isPaid && pMethod !== "cod") {
        try {
          fetch(`${supabaseUrl}/functions/v1/process-order-cancellation-refund`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              order_id: orderId!,
              reason: `Auto refund on cancellation: ${reason}`,
            }),
          }).catch((e) => console.warn("[shiprocket-api] Refund trigger notice:", e));
        } catch {
          // Non-blocking
        }
      }

      // Dispatch order_cancelled transactional SMS (non-blocking)
      try {
        fetch(`${supabaseUrl}/functions/v1/msg91-transactional`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            order_id: orderId!,
            event_type: "order_cancelled",
            notify_owner: true,
          }),
        }).catch((e) => console.warn("[shiprocket-api] SMS trigger notice:", e));
      } catch {
        // Non-blocking
      }

      return new Response(
        JSON.stringify({
          success: true,
          provider_cancelled: providerCancelled,
          message: `Order and Shiprocket shipment cancelled successfully. Stock restored.`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
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
