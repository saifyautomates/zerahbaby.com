import { useState, useEffect, useMemo, useCallback } from "react";
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
  const [lastScanned, setLastScanned] = useState({ name: "", price: "" });
  const [selectedItem, setSelectedItem] = useState<Product | null>(null);

  // -- Cart Calculations --
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const total = Math.max(0, subtotal - discount);

  // -- Barcode Scan Handler --
  const handleScan = useCallback(
    (sku: string) => {
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

      setLastScanned({ name: product.name, price: product.price.toString() });
      toast.success(`Added ${product.name}`);
    },
    [products],
  );

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
  }, [barcodeInput, handleScan]);

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
      // Build items payload for the RPC
      const rpcItems = cart.map((item) => ({
        product_slug: item.id, // the slug
        qty: item.qty,
      }));

      // Calculate subtotal from cart (this is just for the payload, RPC computes actual)
      const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);

      const { data, error } = await supabase.rpc("place_order", {
        _full_name: customer.full_name || "POS Customer",
        _email: customer.email || "offline@zerahbaby.com",
        _phone: customer.phone || "0000000000",
        _payment_method: paymentMethod,
        _notes: "POS Order",
        _subtotal: subtotal,
        _shipping: 0,
        _discount: discount || 0,
        _items: rpcItems,
      });

      if (error) throw error;
      const result = data as { order_id: string; invoice_no: string } | null;
      return { id: result?.order_id ?? "", invoice_no: result?.invoice_no ?? "" };
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
    <div className="flex min-h-[80dvh] flex-col rounded-2xl border border-border/50 bg-background lg:flex-row">
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
                  onClick={() => setSelectedItem(item)}
                  className="flex cursor-pointer items-center gap-4 rounded-xl border border-border/50 bg-card p-3 shadow-sm hover:border-primary transition-colors"
                >
                  <img src={item.image} alt="" className="size-16 rounded-lg object-cover" />
                  <div className="flex-1">
                    <p className="font-bold text-sm leading-tight">{item.name}</p>
                    <p className="text-xs text-muted-foreground">{item.sku}</p>
                    <p className="mt-1 font-semibold">{formatPrice(item.price)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div
                      className="flex items-center rounded-lg border border-border"
                      onClick={(e) => e.stopPropagation()}
                    >
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
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromCart(item.uuid);
                      }}
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

      {/* Product Details Modal */}
      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-lg max-h-[90dvh] overflow-y-auto overflow-x-hidden rounded-3xl bg-background shadow-2xl flex flex-col">
            <button
              onClick={() => setSelectedItem(null)}
              className="absolute right-4 top-4 z-10 flex size-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              ×
            </button>
            <div className="h-64 w-full bg-muted">
              <img
                src={selectedItem.image}
                alt={selectedItem.name}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="p-6">
              <div className="mb-2 flex items-center justify-between">
                <span className="rounded-md bg-muted px-2 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {selectedItem.brand}
                </span>
                <span className="text-sm font-bold text-primary">{selectedItem.sku}</span>
              </div>
              <h2 className="mb-1 font-display text-2xl font-bold">{selectedItem.name}</h2>
              <div className="mb-4 text-xl font-bold text-primary">
                {formatPrice(selectedItem.price)}
              </div>

              <div className="mb-6 space-y-2 text-sm text-muted-foreground">
                <p>
                  <strong>Category:</strong> {selectedItem.category}
                </p>
                <p>
                  <strong>Age Group:</strong> {selectedItem.ageGroup}
                </p>
                <p>
                  <strong>Stock:</strong> {selectedItem.stock} remaining
                </p>
                {selectedItem.description && (
                  <div className="mt-4 border-t pt-4">
                    <strong>Description:</strong>
                    <p className="mt-1">{selectedItem.description}</p>
                  </div>
                )}
              </div>

              <button
                onClick={() => setSelectedItem(null)}
                className="w-full rounded-xl bg-slate-900 py-3 font-bold text-white transition hover:bg-slate-800"
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Right: Checkout & Customer */}
      <div className="flex w-full flex-col bg-muted/10 lg:w-96">
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm border border-border/50">
            <h2 className="font-display text-xl font-bold">Customer Details</h2>
            <p className="text-sm text-muted-foreground mb-6">
              Fill in information to place an order
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                  Full Name <span className="text-destructive">*</span>
                </label>
                <input
                  placeholder="Enter full name"
                  value={customer.full_name}
                  onChange={(e) => setCustomer({ ...customer, full_name: e.target.value })}
                  className="w-full rounded-xl border border-border bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-primary focus:bg-white transition-colors"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                  WhatsApp Number <span className="text-destructive">*</span>
                </label>
                <div className="flex gap-2">
                  <div className="flex items-center gap-1 rounded-xl border border-border bg-slate-50 px-3 py-2.5 text-sm">
                    <span>🇮🇳</span>
                    <span>+91</span>
                  </div>
                  <input
                    placeholder="9XXXXXXXXX"
                    value={customer.phone}
                    onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                    className="flex-1 rounded-xl border border-border bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-primary focus:bg-white transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                  Product Name <span className="text-destructive">*</span>
                </label>
                <input
                  placeholder="What would you like to order?"
                  value={lastScanned.name}
                  onChange={(e) => setLastScanned({ ...lastScanned, name: e.target.value })}
                  className="w-full rounded-xl border border-border bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-primary focus:bg-white transition-colors"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                  Price (₹) <span className="text-destructive">*</span>
                </label>
                <input
                  type="number"
                  placeholder="0"
                  value={lastScanned.price}
                  onChange={(e) => setLastScanned({ ...lastScanned, price: e.target.value })}
                  className="w-full rounded-xl border border-border bg-slate-50 px-4 py-2.5 text-sm outline-none focus:border-primary focus:bg-white transition-colors"
                />
              </div>

              {/* Manual Add Button for custom items not in DB */}
              <button
                onClick={() => {
                  if (lastScanned.name && lastScanned.price) {
                    setCart((prev) => [
                      ...prev,
                      {
                        uuid: crypto.randomUUID(),
                        id: `custom-${Date.now()}`,
                        name: lastScanned.name,
                        sku: "CUSTOM",
                        price: Number(lastScanned.price),
                        mrp: Number(lastScanned.price),
                        stock: 999,
                        qty: 1,
                        image: "https://via.placeholder.com/150",
                        brand: "Custom",
                        category: "custom",
                        ageGroup: "all",
                        rating: 5,
                        reviews: 0,
                        sortOrder: 0,
                        imageUrl: "https://via.placeholder.com/150",
                        lowStockAt: 5,
                      } as unknown as Product & { qty: number },
                    ]);
                    toast.success(`Added ${lastScanned.name}`);
                    setLastScanned({ name: "", price: "" });
                  } else {
                    toast.error("Please enter product name and price");
                  }
                }}
                className="w-full rounded-xl bg-pink-100 py-2 text-sm font-bold text-pink-700 hover:bg-pink-200 transition-colors"
              >
                Add Custom Item to Cart
              </button>
            </div>
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
