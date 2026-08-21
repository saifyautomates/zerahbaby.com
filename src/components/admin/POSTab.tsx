import { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Minus,
  Trash2,
  ShoppingBag,
  CreditCard,
  Banknote,
  Scan,
  Package,
  Star,
  Send,
} from "lucide-react";
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
        product_slug: item.id, // the slug or "custom-xxx"
        qty: item.qty,
        name: item.name,
        custom_price: item.sku === "CUSTOM" ? item.price : undefined,
      }));

      const { data, error } = await (supabase.rpc as any)("place_offline_sale", {
        _customer_name: customer.full_name || "POS Customer",
        _customer_email: customer.email || "offline@zerahbaby.com",
        _customer_phone: customer.phone || "0000000000",
        _payment_method: paymentMethod,
        _notes: "POS Order",
        _discount: discount || 0,
        _items: rpcItems,
      });

      if (error) throw error;
      const result = data as { sale_id: string; sale_number: string } | null;
      return { id: result?.sale_id ?? "", invoice_no: result?.sale_number ?? "" };
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
                  <img
                    src={item.image}
                    alt=""
                    className="size-16 rounded-lg object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.opacity = "0";
                    }}
                  />
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
      {selectedItem && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 sm:p-6">
          <div className="relative flex flex-col w-full max-w-lg max-h-full rounded-3xl bg-background shadow-2xl overflow-hidden">
            <button
              onClick={() => setSelectedItem(null)}
              className="absolute right-4 top-4 z-10 flex size-8 items-center justify-center rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              ×
            </button>
            <div className="h-64 w-full shrink-0 bg-muted">
              <img
                src={selectedItem.image}
                alt={selectedItem.name}
                className="h-full w-full object-cover"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.opacity = "0";
                }}
              />
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-6">
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
        </div>,
        document.body
      )}

      {/* Right: Checkout & Customer styled exactly like the screenshot */}
      <div className="flex w-full flex-col bg-gradient-to-b from-[#fdf2f7] to-white lg:w-[32rem] items-center justify-start overflow-y-auto p-8 relative border-l border-border/40 shadow-[-10px_0_30px_-15px_rgba(0,0,0,0.05)]">
        {/* Logo Section */}
        <div className="flex flex-col items-center mt-2 mb-8">
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#fce4ef] mb-3 shadow-sm">
            <span className="text-[28px] leading-none">👶</span>
          </div>
          <div className="text-center space-y-1.5">
            <h1 className="text-[26px] tracking-tight text-[#1a1a1a] flex items-center justify-center gap-1.5 font-bold">
              Zerah{" "}
              <span className="text-[#d85c88] font-serif italic font-medium">Baby & Kids</span>
            </h1>
            <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#8a8a8a]">
              Premium Children's Clothing
            </p>
          </div>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-1 mb-10 text-xs font-medium">
          <div className="flex h-7 w-7 items-center justify-center rounded-full border-[1.5px] border-[#d85c88] bg-[#fdf2f7] text-[#d85c88]">
            1
          </div>
          <div className="h-[1px] w-6 bg-gray-200"></div>
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400">
            2
          </div>
          <div className="h-[1px] w-6 bg-gray-200"></div>
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400">
            3
          </div>
          <div className="h-[1px] w-6 bg-gray-200"></div>
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-400">
            <Star className="h-3 w-3" />
          </div>
        </div>

        {/* Form Card */}
        <div className="w-full max-w-md rounded-[20px] bg-white p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100/80">
          <h2 className="font-serif text-[22px] font-bold text-[#2a2a2a] tracking-tight">
            Customer Details
          </h2>
          <p className="text-[13px] text-[#6b6b6b] mt-1 mb-7">
            Fill in your information to place an order
          </p>

          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-[#8a8a8a] mb-1.5 block">
                Full Name <span className="text-[#d85c88]">*</span>
              </label>
              <input
                placeholder="Enter your full name"
                value={customer.full_name}
                onChange={(e) => setCustomer({ ...customer, full_name: e.target.value })}
                className="w-full rounded-xl border border-gray-200/80 bg-[#fbfbfb] px-3.5 py-2.5 text-[13px] outline-none focus:border-[#d85c88] focus:bg-white transition-colors placeholder:text-gray-400"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-[#8a8a8a] mb-1.5 block">
                WhatsApp Number <span className="text-[#d85c88]">*</span>
              </label>
              <div className="flex gap-2">
                <div className="flex items-center justify-center gap-1.5 rounded-xl border border-gray-200/80 bg-[#fbfbfb] px-3 py-2.5 text-[13px] text-gray-600 font-medium min-w-[70px]">
                  <span>🇮🇳</span>
                  <span>+91</span>
                </div>
                <input
                  placeholder="9XXXXXXXXX"
                  value={customer.phone}
                  onChange={(e) => setCustomer({ ...customer, phone: e.target.value })}
                  className="flex-1 rounded-xl border border-gray-200/80 bg-[#fbfbfb] px-3.5 py-2.5 text-[13px] outline-none focus:border-[#d85c88] focus:bg-white transition-colors placeholder:text-gray-400"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-[#8a8a8a] mb-1.5 block">
                Product Name <span className="text-[#d85c88]">*</span>
              </label>
              <div className="relative">
                <Package className="absolute left-3.5 top-3 h-4 w-4 text-gray-400" />
                <input
                  placeholder="What would you like to order?"
                  value={lastScanned.name}
                  onChange={(e) => setLastScanned({ ...lastScanned, name: e.target.value })}
                  className="w-full rounded-xl border border-gray-200/80 bg-[#fbfbfb] pl-10 pr-4 py-2.5 text-[13px] outline-none focus:border-[#d85c88] focus:bg-white transition-colors placeholder:text-gray-400"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-[#8a8a8a] mb-1.5 block">
                Price (₹) <span className="text-[#d85c88]">*</span>
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-2.5 text-gray-400 text-sm">₹</span>
                <input
                  type="number"
                  placeholder="0"
                  value={lastScanned.price}
                  onChange={(e) => setLastScanned({ ...lastScanned, price: e.target.value })}
                  className="w-full rounded-xl border border-gray-200/80 bg-[#fbfbfb] pl-8 pr-4 py-2.5 text-[13px] outline-none focus:border-[#d85c88] focus:bg-white transition-colors placeholder:text-gray-400"
                />
                <div className="absolute right-3 top-2.5 flex flex-col -space-y-[2px]">
                  {/* Custom arrows placeholder to match design */}
                  <div className="h-4 w-4 bg-gray-200 rounded-sm flex items-center justify-center cursor-pointer opacity-70">
                    <span className="text-[8px] transform -rotate-90">›</span>
                    <span className="text-[8px] transform rotate-90 -ml-[1px]">›</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-3">
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
                        description: "",
                        highlights: [],
                        isFeatured: false,
                        isActive: true,
                        images: [],
                      } as Product & { qty: number },
                    ]);
                    setCheckoutMode("cash"); // Move forward to checkout step logically
                  } else if (cart.length > 0) {
                    setCheckoutMode("cash");
                  } else {
                    toast.error("Please enter product name and price");
                  }
                }}
                className="w-full rounded-[14px] bg-[#cc4b7a] py-3.5 text-[14px] font-semibold text-white shadow-sm hover:bg-[#b83b68] transition-colors flex items-center justify-center gap-2"
              >
                <Send className="h-4 w-4" /> Continue to Payment
              </button>
            </div>
          </div>
        </div>

        {/* Checkout Confirmations (only show when moving past step 1) */}
        {checkoutMode !== "idle" && (
          <div className="w-full max-w-md mt-6 rounded-[20px] bg-white p-7 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100/80">
            <h3 className="font-serif text-xl font-bold text-[#2a2a2a] mb-4">
              Payment Confirmation
            </h3>

            {checkoutMode === "cash" && (
              <div className="text-center">
                <p className="font-bold text-lg mb-4 text-slate-800">
                  Collect {formatPrice(total)} in Cash
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCheckoutMode("idle")}
                    className="flex-1 rounded-xl border border-gray-200 bg-[#fbfbfb] py-2.5 font-semibold text-sm text-gray-600"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => placeOrder.mutate("cash")}
                    disabled={placeOrder.isPending}
                    className="flex-[2] rounded-xl bg-slate-900 py-2.5 font-semibold text-white text-sm"
                  >
                    Confirm Order
                  </button>
                </div>
              </div>
            )}

            {checkoutMode === "online" && (
              <div className="text-center">
                <div className="mx-auto mb-3 flex size-12 animate-pulse items-center justify-center rounded-full bg-purple-100 text-purple-600">
                  <CreditCard className="size-6" />
                </div>
                <p className="font-bold text-slate-800">Waiting for Payment...</p>
                <p className="text-xs text-muted-foreground mt-1 mb-4">
                  Notification sent to customer. Awaiting confirmation for {formatPrice(total)}.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setCheckoutMode("idle")}
                    className="flex-1 rounded-xl border border-gray-200 bg-[#fbfbfb] py-2.5 font-semibold text-xs text-gray-600"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => placeOrder.mutate("upi")}
                    disabled={placeOrder.isPending}
                    className="flex-[2] rounded-xl bg-purple-600 py-2.5 font-semibold text-white text-sm"
                  >
                    Force Confirm Payment
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer Text */}
        <div className="mt-auto pt-12 flex items-center justify-center gap-4 w-full max-w-sm opacity-50">
          <div className="h-[1px] flex-1 bg-gray-300"></div>
          <span className="text-[9px] font-bold tracking-[0.1em] text-gray-500 uppercase">
            Made with ♥ for tiny humans
          </span>
          <div className="h-[1px] flex-1 bg-gray-300"></div>
        </div>
      </div>
    </div>
  );
}
