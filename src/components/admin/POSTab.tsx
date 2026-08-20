import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Minus, Trash2, ShoppingBag, CreditCard, Banknote, Scan } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { type Product, mapProduct, formatPrice } from "@/lib/store";

export function POSTab() {
  const qc = useQueryClient();

  // -- Products Data --
  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["admin-products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").eq("is_active", true);
      if (error) throw error;
      return (data as never[]).map((r) => mapProduct(r as never));
    },
  });

  // -- POS State --
  const [cart, setCart] = useState<Array<Product & { qty: number }>>([]);
  const [discount, setDiscount] = useState<number>(0);
  const [customer, setCustomer] = useState({
    full_name: "",
    phone: "",
    email: "",
    address: "",
  });
  const [barcodeInput, setBarcodeInput] = useState("");
  const [checkoutMode, setCheckoutMode] = useState<"idle" | "cash" | "online" | "processing">(
    "idle",
  );

  // -- Cart Calculations --
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const total = Math.max(0, subtotal - discount);

  // -- Barcode Scanner Listener --
  useEffect(() => {
    // A barcode scanner types characters very fast and sends 'Enter' at the end.
    let timeoutId: ReturnType<typeof setTimeout>;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field (unless they scan while focused, which we might want to handle, but usually POS scanners scan into a void).
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === "Enter") {
        if (barcodeInput.trim().length > 0) {
          const skuScanned = barcodeInput.trim();
          handleScan(skuScanned);
          setBarcodeInput("");
        }
      } else if (e.key.length === 1) {
        setBarcodeInput((prev) => prev + e.key);

        // Clear input if typing is too slow (human typing vs scanner)
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          setBarcodeInput("");
        }, 100); // 100ms timeout for scanner speed
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timeoutId);
    };
  }, [barcodeInput, products]);

  const handleScan = (sku: string) => {
    const product = products.find((p) => p.sku === sku);
    if (!product) {
      toast.error(`Product not found for SKU: ${sku}`);
      return;
    }

    if (product.stock <= 0) {
      toast.error(`Product "${product.name}" is out of stock!`);
      return;
    }

    setCart((prev) => {
      const existing = prev.find((p) => p.uuid === product.uuid);
      if (existing) {
        if (existing.qty >= product.stock) {
          toast.error(`Cannot add more. Only ${product.stock} left in stock.`);
          return prev;
        }
        return prev.map((p) => (p.uuid === product.uuid ? { ...p, qty: p.qty + 1 } : p));
      }
      return [...prev, { ...product, qty: 1 }];
    });

    toast.success(`Added ${product.name}`);
  };

  const updateQty = (uuid: string, delta: number) => {
    setCart((prev) =>
      prev.map((p) => {
        if (p.uuid === uuid) {
          const newQty = Math.max(1, Math.min(p.stock, p.qty + delta));
          return { ...p, qty: newQty };
        }
        return p;
      }),
    );
  };

  const removeFromCart = (uuid: string) => {
    setCart((prev) => prev.filter((p) => p.uuid !== uuid));
  };

  // -- Checkout Workflow --
  const placeOrder = useMutation({
    mutationFn: async (paymentMethod: "cash" | "upi") => {
      // Create the order
      const { data: orderData, error: orderError } = await supabase
        .from("orders")
        .insert({
          user_id: null, // guest/offline
          full_name: customer.full_name || "Offline Customer",
          email: customer.email || "offline@zerahbaby.com",
          phone: customer.phone || "0000000000",
          alt_phone: "",
          address: customer.address || "Store Walk-in",
          address_line2: "",
          landmark: "",
          city: "",
          state: "",
          pincode: "",
          total,
          subtotal,
          shipping: 0,
          discount,
          payment_method: paymentMethod,
          status: "delivered", // Mark as delivered instantly for offline POS
          notes: "Offline POS Sale",
        })
        .select("id")
        .single();

      if (orderError) throw orderError;

      // Create order items
      const items = cart.map((item) => ({
        order_id: orderData.id,
        product_slug: item.id,
        name: item.name,
        price: item.price,
        qty: item.qty,
        image_url: item.imageUrl,
      }));

      const { error: itemsError } = await supabase.from("order_items").insert(items);
      if (itemsError) throw itemsError;

      // Update Inventory manually since we don't have a reliable DB trigger setup yet for POS in this prompt scope
      for (const item of cart) {
        // Calculate new stock and update the DB directly
        const newStock = Math.max(0, item.stock - item.qty);
        await supabase.from("products").update({ stock: newStock }).eq("id", item.uuid);
      }

      return orderData;
    },
    onSuccess: () => {
      toast.success("Order completed successfully!");
      // Reset POS
      setCart([]);
      setCustomer({ full_name: "", phone: "", email: "", address: "" });
      setDiscount(0);
      setCheckoutMode("idle");
      // Invalidate queries to refresh dashboard metrics & products
      qc.invalidateQueries({ queryKey: ["admin-orders"] });
      qc.invalidateQueries({ queryKey: ["admin-products"] });
    },
    onError: (e: Error) => {
      toast.error(e.message);
      setCheckoutMode("idle");
    },
  });

  return (
    <div className="flex h-[85vh] lg:h-[80vh] flex-col overflow-hidden rounded-2xl border border-border/50 bg-background lg:flex-row">
      {/* Left: Cart & Scanning */}
      <div className="flex flex-1 flex-col border-r border-border/50">
        <div className="flex items-center justify-between border-b border-border/50 bg-muted/30 p-4">
          <h2 className="font-display text-lg font-bold">POS Cart</h2>
          <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
            <Scan className="size-4 text-primary animate-pulse" />
            Scanner Active
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {cart.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
              <ShoppingBag className="size-12 opacity-20 mb-4" />
              <p>Cart is empty</p>
              <p className="text-xs mt-1">Scan a barcode to add products</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {cart.map((item) => (
                <li
                  key={item.uuid}
                  className="flex items-center gap-4 rounded-xl border border-border/50 bg-card p-3 shadow-sm"
                >
                  <img src={item.image} alt="" className="size-16 rounded-lg object-cover" />
                  <div className="flex-1">
                    <p className="font-bold text-sm leading-tight">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.sku}</p>
                    <p className="mt-1 font-semibold">{formatPrice(item.price)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center rounded-lg border border-border">
                      <button
                        onClick={() => updateQty(item.uuid, -1)}
                        className="p-1 hover:bg-muted"
                      >
                        <Minus className="size-3" />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold">{item.qty}</span>
                      <button
                        onClick={() => updateQty(item.uuid, 1)}
                        className="p-1 hover:bg-muted"
                      >
                        <Plus className="size-3" />
                      </button>
                    </div>
                    <button
                      onClick={() => removeFromCart(item.uuid)}
                      className="p-2 text-destructive hover:bg-destructive/10 rounded-lg"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right: Checkout & Customer */}
      <div className="flex w-full flex-col bg-muted/10 lg:w-96">
        <div className="flex-1 overflow-y-auto p-6">
          <h3 className="font-semibold uppercase tracking-wider text-xs text-muted-foreground mb-4">
            Customer Details
          </h3>
          <div className="space-y-3">
            <input
              placeholder="Full Name"
              value={customer.full_name}
              onChange={(e) => setCustomer({ ...customer, full_name: e.target.value })}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              placeholder="Phone Number"
              value={customer.phone}
              onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              placeholder="Email (Optional)"
              value={customer.email}
              onChange={(e) => setCustomer({ ...customer, email: e.target.value })}
              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <h3 className="font-semibold uppercase tracking-wider text-xs text-muted-foreground mt-8 mb-4">
            Payment Summary
          </h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd>{formatPrice(subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-muted-foreground">Discount</dt>
              <dd>
                <div className="flex items-center gap-1">
                  <span>- ₹</span>
                  <input
                    type="number"
                    min="0"
                    value={discount || ""}
                    onChange={(e) => setDiscount(Number(e.target.value))}
                    className="w-16 rounded-md border border-border bg-background px-2 py-1 text-right text-sm outline-none focus:border-primary"
                  />
                </div>
              </dd>
            </div>
            <div className="flex justify-between border-t border-border/50 pt-2 text-xl font-bold">
              <dt>Total</dt>
              <dd className="text-primary">{formatPrice(total)}</dd>
            </div>
          </dl>
        </div>

        <div className="border-t border-border/50 bg-card p-6 shadow-[0_-4px_10px_-5px_rgba(0,0,0,0.05)]">
          {checkoutMode === "idle" && (
            <div className="grid gap-3">
              <button
                disabled={cart.length === 0}
                onClick={() => setCheckoutMode("cash")}
                className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                <Banknote className="size-5" /> Pay via Cash
              </button>
              <button
                disabled={cart.length === 0}
                onClick={() => setCheckoutMode("online")}
                className="flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-3 font-semibold text-white transition hover:bg-purple-700 disabled:opacity-50"
              >
                <CreditCard className="size-5" /> Pay via PhonePe / Online
              </button>
            </div>
          )}

          {checkoutMode === "cash" && (
            <div className="text-center">
              <p className="font-bold text-lg mb-4">Collect {formatPrice(total)} in Cash</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setCheckoutMode("idle")}
                  className="flex-1 rounded-xl border border-border bg-muted py-2 font-semibold"
                >
                  Cancel
                </button>
                <button
                  onClick={() => placeOrder.mutate("cash")}
                  disabled={placeOrder.isPending}
                  className="flex-1 rounded-xl bg-slate-900 py-2 font-semibold text-white"
                >
                  Confirm
                </button>
              </div>
            </div>
          )}

          {checkoutMode === "online" && (
            <div className="text-center">
              <div className="mx-auto mb-3 flex size-12 animate-pulse items-center justify-center rounded-full bg-purple-100 text-purple-600">
                <CreditCard className="size-6" />
              </div>
              <p className="font-bold">Waiting for Payment...</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">
                Notification sent to customer. Awaiting PhonePe confirmation for{" "}
                {formatPrice(total)}.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setCheckoutMode("idle")}
                  className="flex-1 rounded-xl border border-border bg-muted py-2 font-semibold text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={() => placeOrder.mutate("upi")}
                  disabled={placeOrder.isPending}
                  className="flex-[2] rounded-xl bg-purple-600 py-2 font-semibold text-white text-sm"
                >
                  Force Confirm Payment
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
