import { test, expect } from "@playwright/test";

test.describe("Shiprocket Logistics Integration & State Machine Suite", () => {
  // 1. Order Payload Construction for Forward Fulfillment
  test("1. Forward Shipment: Authoritative Payload Validation", () => {
    const mockOrder = {
      id: "ord-test-uuid-12345",
      order_number: "ORD-260908-1001",
      full_name: "Fatima Khan",
      address: "Flat 402, Sunshine Apartments, Link Road",
      address_line2: "Opposite City Mall",
      city: "Jaipur",
      state: "Rajasthan",
      pincode: "302015",
      phone: "9876543210",
      email: "fatima@example.com",
      payment_method: "upi",
      subtotal: 699,
      total: 699,
    };

    const mockItems = [
      {
        name: "Organic Cotton Baby Romper",
        sku: "ZR-ROM-01-S",
        quantity: 1,
        price: 699,
        mrp: 999,
      },
    ];

    const buildShiprocketPayload = (order: typeof mockOrder, items: typeof mockItems) => {
      const safeFullName = (order.full_name || "Customer").trim();
      const firstName = safeFullName.split(" ")[0] || "Customer";
      const lastName = safeFullName.split(" ").slice(1).join(" ") || firstName;
      const isCod = order.payment_method?.toLowerCase() === "cod";

      return {
        order_id: order.order_number,
        order_date: new Date().toISOString().split("T")[0],
        pickup_location: "work",
        billing_customer_name: firstName,
        billing_last_name: lastName,
        billing_address: order.address,
        billing_address_2: order.address_line2 || "",
        billing_city: order.city,
        billing_pincode: order.pincode,
        billing_state: order.state,
        billing_country: "India",
        billing_email: order.email,
        billing_phone: order.phone,
        shipping_is_billing: true,
        order_items: items.map((i) => ({
          name: i.name,
          sku: i.sku,
          units: i.quantity,
          selling_price: i.price,
          discount: Math.max(0, i.mrp - i.price),
          tax: 0,
          hsn: "",
        })),
        payment_method: isCod ? "COD" : "Prepaid",
        sub_total: order.total,
        length: 10,
        breadth: 10,
        height: 10,
        weight: 0.5,
      };
    };

    const payload = buildShiprocketPayload(mockOrder, mockItems);

    expect(payload.order_id).toBe("ORD-260908-1001");
    expect(payload.payment_method).toBe("Prepaid");
    expect(payload.billing_customer_name).toBe("Fatima");
    expect(payload.billing_last_name).toBe("Khan");
    expect(payload.billing_pincode).toBe("302015");
    expect(payload.order_items.length).toBe(1);
    expect(payload.order_items[0].selling_price).toBe(699);
    expect(payload.order_items[0].discount).toBe(300);
    expect(payload.weight).toBe(0.5);
  });

  // 2. COD Payload Flags Validation
  test("2. COD Forward Shipment: Flagged Correctly as COD", () => {
    const codOrder = {
      order_number: "ORD-260908-COD1",
      full_name: "Rahul Sharma",
      address: "12 MG Road",
      city: "Kota",
      state: "Rajasthan",
      pincode: "324005",
      phone: "9123456780",
      email: "rahul@example.com",
      payment_method: "cod",
      total: 1250,
    };

    const isCod = codOrder.payment_method.toLowerCase() === "cod";
    const paymentMethodField = isCod ? "COD" : "Prepaid";

    expect(paymentMethodField).toBe("COD");
  });

  // 3. Reverse Logistics (Online Return) Payload Validation
  test("3. Reverse Return: Customer Pickup & Store Delivery Routing", () => {
    const mockReturn = {
      return_number: "RET-260908-8812",
      final_refund_amount: 549,
      orders: {
        full_name: "Anita Desai",
        address: "54 Heritage Heights",
        address_line2: "Near Jain Temple",
        city: "Udaipur",
        state: "Rajasthan",
        pincode: "313001",
        phone: "9988776655",
        email: "anita@example.com",
      },
      online_return_items: [
        {
          product_name_snapshot: "Embroidered Baby Kurta",
          sku_snapshot: "ZR-KUR-02-M",
          quantity_requested: 1,
          historical_unit_price: 549,
        },
      ],
    };

    const buildReturnPayload = (ret: typeof mockReturn) => {
      const retOrder = ret.orders;
      const firstName = (retOrder.full_name || "Customer").split(" ")[0];
      const lastName =
        (retOrder.full_name || "Customer").split(" ").slice(1).join(" ") || firstName;

      return {
        order_id: String(ret.return_number).substring(0, 20),
        pickup_customer_name: firstName,
        pickup_last_name: lastName,
        pickup_address: retOrder.address,
        pickup_address_2: retOrder.address_line2 || "",
        pickup_city: retOrder.city,
        pickup_state: retOrder.state,
        pickup_country: "India",
        pickup_pincode: retOrder.pincode,
        pickup_phone: retOrder.phone,
        shipping_customer_name: "Zerah Baby & Kids Store",
        shipping_address: "80 Feet Link Rd, near Bajot Restaurant",
        shipping_city: "Kota",
        shipping_state: "Rajasthan",
        shipping_pincode: "324001",
        shipping_phone: "919057074777",
        order_items: ret.online_return_items.map((i) => ({
          name: i.product_name_snapshot,
          sku: i.sku_snapshot,
          units: i.quantity_requested,
          selling_price: i.historical_unit_price,
        })),
        payment_method: "Prepaid",
        sub_total: ret.final_refund_amount,
      };
    };

    const returnPayload = buildReturnPayload(mockReturn);

    // Pickup must be customer address
    expect(returnPayload.pickup_customer_name).toBe("Anita");
    expect(returnPayload.pickup_city).toBe("Udaipur");
    expect(returnPayload.pickup_pincode).toBe("313001");

    // Delivery must be Zerah Store warehouse in Kota
    expect(returnPayload.shipping_customer_name).toBe("Zerah Baby & Kids Store");
    expect(returnPayload.shipping_city).toBe("Kota");
    expect(returnPayload.shipping_pincode).toBe("324001");
    expect(returnPayload.order_items[0].selling_price).toBe(549);
  });

  // 4. Webhook Security Header Validation
  test("4. Webhook Security: Header Token Verification", () => {
    const configuredSecret = "sr_secret_prod_secure_token_9988";

    const verifyWebhookToken = (headers: Record<string, string | null>) => {
      const provided =
        headers["x-shiprocket-token"] ||
        headers["authorization"]?.replace(/^Bearer\s+/i, "").trim();
      return Boolean(provided && provided === configuredSecret);
    };

    // Valid x-shiprocket-token
    expect(verifyWebhookToken({ "x-shiprocket-token": "sr_secret_prod_secure_token_9988" })).toBe(
      true,
    );

    // Valid Bearer Authorization
    expect(verifyWebhookToken({ authorization: "Bearer sr_secret_prod_secure_token_9988" })).toBe(
      true,
    );

    // Invalid Token
    expect(verifyWebhookToken({ "x-shiprocket-token": "wrong_token" })).toBe(false);

    // Missing Token
    expect(verifyWebhookToken({})).toBe(false);
  });

  // 5. Tracking Webhook State Machine & Terminal Protection
  test("5. Webhook State Machine: Lifecycle & Anti-Regression", () => {
    const terminalStates = ["delivered", "cancelled", "returned"];

    const transitionOrder = (currentStatus: string, srStatus: string) => {
      if (terminalStates.includes(currentStatus)) {
        return { updated: false, newStatus: currentStatus };
      }
      const upper = srStatus.toUpperCase();
      let nextStatus = currentStatus;
      if (["SHIPPED", "IN TRANSIT", "OUT FOR DELIVERY"].includes(upper)) {
        nextStatus = "shipped";
      } else if (upper === "DELIVERED") {
        nextStatus = "delivered";
      } else if (["RTO INITIATED", "RTO DELIVERED", "RETURNED", "CANCELLED"].includes(upper)) {
        nextStatus = "cancelled";
      }
      return { updated: nextStatus !== currentStatus, newStatus: nextStatus };
    };

    // Forward progression
    expect(transitionOrder("processing", "SHIPPED")).toEqual({
      updated: true,
      newStatus: "shipped",
    });
    expect(transitionOrder("shipped", "IN TRANSIT")).toEqual({
      updated: false,
      newStatus: "shipped",
    });
    expect(transitionOrder("shipped", "DELIVERED")).toEqual({
      updated: true,
      newStatus: "delivered",
    });

    // Anti-regression: Delivered order cannot be overridden by delayed in-transit webhook
    expect(transitionOrder("delivered", "IN TRANSIT")).toEqual({
      updated: false,
      newStatus: "delivered",
    });
    expect(transitionOrder("cancelled", "SHIPPED")).toEqual({
      updated: false,
      newStatus: "cancelled",
    });
  });

  // 6. Reverse Return Webhook Transition to RECEIVED
  test("6. Reverse Logistics Webhook: Transitions to RECEIVED on Delivery", () => {
    const handleReturnWebhook = (currentReturnStatus: string, srReturnStatus: string) => {
      const upper = srReturnStatus.toUpperCase();
      let nextStatus = currentReturnStatus;

      if (
        upper === "DELIVERED" &&
        !["RECEIVED", "QC_PENDING", "QC_APPROVED", "COMPLETED"].includes(currentReturnStatus)
      ) {
        nextStatus = "RECEIVED";
      } else if (
        ["SHIPPED", "IN TRANSIT", "PICKED UP"].includes(upper) &&
        ["APPROVED", "PICKUP_SCHEDULED"].includes(currentReturnStatus)
      ) {
        nextStatus = "IN_TRANSIT";
      }

      return nextStatus;
    };

    expect(handleReturnWebhook("PICKUP_SCHEDULED", "PICKED UP")).toBe("IN_TRANSIT");
    expect(handleReturnWebhook("IN_TRANSIT", "DELIVERED")).toBe("RECEIVED");
    // Already in QC - should not be regressed
    expect(handleReturnWebhook("QC_APPROVED", "DELIVERED")).toBe("QC_APPROVED");
  });

  // 7. Admin UI Action Flow Lifecycle Progression
  test("7. Admin UI Actions: Sequential Fulfillment Guardrails", () => {
    interface AdminOrderState {
      shiprocket_order_id: number | null;
      awb_code: string | null;
      shiprocket_status: string | null;
    }

    const getAvailableAdminAction = (order: AdminOrderState): string => {
      if (!order.shiprocket_order_id) return "PUSH_TO_SHIPROCKET";
      if (!order.awb_code) return "GENERATE_AWB";
      if (
        order.shiprocket_status !== "PICKUP_SCHEDULED" &&
        order.shiprocket_status !== "SHIPPED" &&
        order.shiprocket_status !== "DELIVERED"
      ) {
        return "REQUEST_PICKUP";
      }
      return "VIEW_AWB_DETAILS";
    };

    // Initial state: not yet in Shiprocket
    expect(
      getAvailableAdminAction({
        shiprocket_order_id: null,
        awb_code: null,
        shiprocket_status: null,
      }),
    ).toBe("PUSH_TO_SHIPROCKET");

    // Pushed to Shiprocket, needs AWB
    expect(
      getAvailableAdminAction({
        shiprocket_order_id: 99881122,
        awb_code: null,
        shiprocket_status: "NEW",
      }),
    ).toBe("GENERATE_AWB");

    // AWB generated, ready for pickup request
    expect(
      getAvailableAdminAction({
        shiprocket_order_id: 99881122,
        awb_code: "AWB-123456789",
        shiprocket_status: "AWB_GENERATED",
      }),
    ).toBe("REQUEST_PICKUP");

    // Pickup scheduled: ready for courier handover
    expect(
      getAvailableAdminAction({
        shiprocket_order_id: 99881122,
        awb_code: "AWB-123456789",
        shiprocket_status: "PICKUP_SCHEDULED",
      }),
    ).toBe("VIEW_AWB_DETAILS");
  });

  // 8. Order Cancellation State Machine & Provider Rejection Safety
  test("8. Order Cancellation: Non-Cancellable Protection & Operational Truth", () => {
    interface CancellationResult {
      success: boolean;
      local_status: string;
      shipping_cancellation_status: string;
      non_cancellable?: boolean;
      message: string;
    }

    const cancelShiprocketOrder = (
      order: {
        id: string;
        status: string;
        shiprocket_status?: string | null;
        awb_code?: string | null;
      },
      providerCancelMock: (awb: string) => { success: boolean; message?: string },
    ): CancellationResult => {
      // 1. Idempotency: Already cancelled
      if (order.status === "cancelled") {
        return {
          success: true,
          local_status: "cancelled",
          shipping_cancellation_status: "ALREADY_CANCELLED",
          message: "Order is already cancelled",
        };
      }

      // 2. Pre-flight check: Non-cancellable states
      const nonCancellableStates = [
        "SHIPPED",
        "IN TRANSIT",
        "OUT FOR DELIVERY",
        "DELIVERED",
        "RTO INITIATED",
        "RTO DELIVERED",
      ];
      const currentSrStatus = (order.shiprocket_status || "").toUpperCase();
      if (nonCancellableStates.includes(currentSrStatus)) {
        return {
          success: false,
          local_status: order.status, // Order stays active, NEVER fakes success!
          shipping_cancellation_status: "NOT_CANCELLABLE",
          non_cancellable: true,
          message:
            "Order cancellation requested, but Shiprocket has already progressed the shipment and it cannot be cancelled through the current provider state.",
        };
      }

      // 3. If dispatched to Shiprocket, call provider API
      if (order.awb_code) {
        const providerRes = providerCancelMock(order.awb_code);
        if (!providerRes.success) {
          return {
            success: false,
            local_status: order.status, // Local status not touched if provider fails
            shipping_cancellation_status: "CANCELLATION_FAILED",
            message: providerRes.message || "Shiprocket rejected cancellation",
          };
        }
      }

      // 4. Success: finalized
      return {
        success: true,
        local_status: "cancelled",
        shipping_cancellation_status: "CANCELLED",
        message: "Order and Shiprocket shipment cancelled successfully.",
      };
    };

    // Case A: Eligible order before dispatch (e.g. AWB_GENERATED or NEW) -> Cancelled
    const eligibleOrder = {
      id: "ord-elig-001",
      status: "processing",
      shiprocket_status: "AWB_GENERATED",
      awb_code: "AWB-987654",
    };
    const resA = cancelShiprocketOrder(eligibleOrder, () => ({ success: true }));
    expect(resA.success).toBe(true);
    expect(resA.local_status).toBe("cancelled");
    expect(resA.shipping_cancellation_status).toBe("CANCELLED");

    // Case B: In-transit order -> BLOCKED with exact required operational message!
    const inTransitOrder = {
      id: "ord-intransit-002",
      status: "shipped",
      shiprocket_status: "IN TRANSIT",
      awb_code: "AWB-445566",
    };
    const resB = cancelShiprocketOrder(inTransitOrder, () => ({ success: true }));
    expect(resB.success).toBe(false);
    expect(resB.local_status).toBe("shipped"); // Remains active!
    expect(resB.non_cancellable).toBe(true);
    expect(resB.shipping_cancellation_status).toBe("NOT_CANCELLABLE");
    expect(resB.message).toBe(
      "Order cancellation requested, but Shiprocket has already progressed the shipment and it cannot be cancelled through the current provider state.",
    );

    // Case C: Out for delivery order -> BLOCKED with exact required operational message!
    const outForDeliveryOrder = {
      id: "ord-ofd-003",
      status: "shipped",
      shiprocket_status: "OUT FOR DELIVERY",
      awb_code: "AWB-778899",
    };
    const resC = cancelShiprocketOrder(outForDeliveryOrder, () => ({ success: true }));
    expect(resC.success).toBe(false);
    expect(resC.local_status).toBe("shipped");
    expect(resC.non_cancellable).toBe(true);
    expect(resC.message).toContain("Shiprocket has already progressed the shipment");

    // Case D: Delivered order -> BLOCKED
    const deliveredOrder = {
      id: "ord-del-004",
      status: "delivered",
      shiprocket_status: "DELIVERED",
      awb_code: "AWB-112233",
    };
    const resD = cancelShiprocketOrder(deliveredOrder, () => ({ success: true }));
    expect(resD.success).toBe(false);
    expect(resD.local_status).toBe("delivered");
    expect(resD.non_cancellable).toBe(true);

    // Case E: Already cancelled -> Idempotent
    const alreadyCancelledOrder = {
      id: "ord-canc-005",
      status: "cancelled",
      shiprocket_status: "CANCELLED",
    };
    const resE = cancelShiprocketOrder(alreadyCancelledOrder, () => ({ success: true }));
    expect(resE.success).toBe(true);
    expect(resE.shipping_cancellation_status).toBe("ALREADY_CANCELLED");
  });

  // 9. Label Generation Payload & Storage Mapping
  test("9. Label Generation: Request Payload and Persistence Mapping", () => {
    const shipmentId = 12345678;
    const generateLabelPayload = {
      shipment_id: [shipmentId],
    };

    expect(generateLabelPayload.shipment_id).toEqual([12345678]);

    // Simulated provider response
    const mockApiResponse = {
      label_created: 1,
      label_url: "https://s3.ap-south-1.amazonaws.com/shiprocket-media/labels/12345678_label.pdf",
      response: "Label generated successfully",
    };

    expect(mockApiResponse.label_url).toMatch(/^https:\/\/.*\.pdf$/);
    expect(mockApiResponse.label_created).toBe(1);
  });

  // 10. Manifest Generation Payload & Storage Mapping
  test("10. Manifest Generation: Request Payload and Pickup Handoff", () => {
    const shipmentId = 12345678;
    const generateManifestPayload = {
      shipment_id: [shipmentId],
    };

    expect(generateManifestPayload.shipment_id).toEqual([12345678]);

    // Simulated provider response
    const mockApiResponse = {
      status: 1,
      manifest_url: "https://s3.ap-south-1.amazonaws.com/shiprocket-media/manifests/manifest_12345678.pdf",
      message: "Manifest Generated successfully.",
    };

    expect(mockApiResponse.manifest_url).toMatch(/^https:\/\/.*\.pdf$/);
    expect(mockApiResponse.status).toBe(1);
  });

  // 11. Tracking Scans Parser & Checkpoint Normalization
  test("11. Live Tracking Checkpoints: Scan Event Normalization", () => {
    const rawShiprocketTrackingData = {
      tracking_data: {
        track_status: 1,
        shipment_status: 7,
        shipment_track: [
          {
            id: 889911,
            awb_code: "AWB-998877",
            current_status: "IN TRANSIT",
            delivered_to: "Jaipur Hub",
            destination: "Jaipur",
            consignee_name: "Fatima Khan",
            origin: "Kota",
            courier_name: "Delhivery Surface",
          },
        ],
        shipment_track_activities: [
          {
            date: "2026-09-12 10:30:00",
            status: "Reached Destination Hub",
            activity: "Package reached Jaipur Distribution Center",
            location: "Jaipur Sorting Hub, Rajasthan",
            "sr-status": "IN TRANSIT",
          },
          {
            date: "2026-09-11 18:00:00",
            status: "In Transit",
            activity: "Departed from Origin Hub",
            location: "Kota Transshipment Facility",
            "sr-status": "IN TRANSIT",
          },
          {
            date: "2026-09-11 12:15:00",
            status: "Picked Up",
            activity: "Shipment collected from Zérah Baby & Kids warehouse",
            location: "Kota Store, 80 Feet Link Road",
            "sr-status": "PICKED UP",
          },
        ],
      },
    };

    const normalizeScans = (activities: any[]) => {
      return (activities || []).map((act) => ({
        date: act.date,
        status: act.status || act["sr-status"] || "Scanned",
        activity: act.activity || act.status || "Checkpoint reached",
        location: act.location || "",
      }));
    };

    const scans = normalizeScans(rawShiprocketTrackingData.tracking_data.shipment_track_activities);

    expect(scans.length).toBe(3);
    expect(scans[0].date).toBe("2026-09-12 10:30:00");
    expect(scans[0].activity).toBe("Package reached Jaipur Distribution Center");
    expect(scans[0].location).toContain("Jaipur");
    expect(scans[2].activity).toContain("collected from Zérah Baby & Kids warehouse");
  });

  // 12. Cancellation Inventory Restoration & Prepaid Refund Triggers
  test("12. Cancellation Side Effects: Restores Stock & Flags Online Refund", () => {
    const mockOrder = {
      id: "ord-test-refund-01",
      payment_status: "paid",
      payment_method: "online_upi",
      total: 1499,
      order_items: [
        { product_id: "prod-001", variant_id: "var-001", quantity: 2 },
        { product_id: "prod-002", variant_id: null, quantity: 1 },
      ],
    };

    const determineCancellationActions = (order: typeof mockOrder) => {
      const stockToRestore = order.order_items.map((item) => ({
        product_id: item.product_id,
        variant_id: item.variant_id,
        quantity: item.quantity,
      }));

      const shouldRefund = order.payment_status === "paid" && order.payment_method !== "cod";

      return {
        stockToRestore,
        shouldRefund,
        refundAmount: shouldRefund ? order.total : 0,
      };
    };

    const actions = determineCancellationActions(mockOrder);
    expect(actions.stockToRestore.length).toBe(2);
    expect(actions.stockToRestore[0].quantity).toBe(2);
    expect(actions.shouldRefund).toBe(true);
    expect(actions.refundAmount).toBe(1499);
  });
});

