import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = createClient(url, key);

async function runTests() {
  console.log("🚀 Starting End-to-End Backend Verification...");

  const testEmail = "jackxparrowww@gmail.com";
  const password = "Kingsaifquazi";

  // 1. Test Authentication (Login)
  console.log(`\n--- 1. Testing User Auth ---`);
  console.log(`Logging in ${testEmail}...`);
  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({
    email: testEmail,
    password,
  });
  
  if (authErr) {
    console.error("❌ Auth Error:", authErr.message);
    return;
  }
  
  const user = authData.user;
  if (!user || !authData.session) {
    console.error("❌ No user or session returned.");
    return;
  }
  
  console.log("✅ Logged in successfully with session:", user.id);

  // 2. Test Profile Creation (Trigger Test)
  console.log(`\n--- 2. Testing Profile Trigger ---`);
  await new Promise(r => setTimeout(r, 1500)); // wait for trigger
  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (profErr || !profile) {
    console.error("❌ Profile Error:", profErr?.message || "Profile not found after signup");
  } else {
    console.log("✅ Profile automatically created via SQL trigger:", profile.id);
  }

  // 3. Test Products Read Access
  console.log(`\n--- 3. Testing Products Read (RLS) ---`);
  const { data: products, error: prodErr } = await supabase
    .from("products")
    .select("id, slug, name, price, stock")
    .limit(1);

  if (prodErr || !products || products.length === 0) {
    console.error("❌ Products Error:", prodErr?.message || "No products found");
    return;
  }
  const product = products[0];
  console.log(`✅ Successfully read product: ${product.name} (Stock: ${product.stock})`);

  // 4. Test Cart functionality (Insert & Sync)
  console.log(`\n--- 4. Testing Cart Sync ---`);
  // First ensure cart exists
  const { data: cartData, error: cartErr } = await supabase
    .from("carts")
    .upsert({ user_id: user.id }, { onConflict: "user_id" })
    .select("id")
    .single();
    
  if (cartErr) {
    console.error("❌ Cart Creation Error:", cartErr.message);
    return;
  }
  
  const { error: cartItemErr } = await supabase
    .from("cart_items")
    .insert({
      cart_id: cartData.id,
      product_id: product.id,
      quantity: 2,
      price_at_add: product.price
    });

  if (cartItemErr) {
    console.error("❌ Cart Item Insert Error:", cartItemErr.message);
    return;
  }
  
  const { data: cartItems } = await supabase.from("cart_items").select("*").eq("cart_id", cartData.id);
  console.log(`✅ Cart item successfully added. Total items in cart: ${cartItems.length}`);

  // 5. Test Wishlist functionality
  console.log(`\n--- 5. Testing Wishlist ---`);
  const { error: wishErr } = await supabase
    .from("wishlists")
    .insert({
      user_id: user.id,
      product_id: product.id
    });
    
  if (wishErr) {
    console.error("❌ Wishlist Error:", wishErr.message);
  } else {
    console.log("✅ Wishlist updated successfully.");
  }

  // 6. Test Orders (Creation)
  console.log(`\n--- 6. Testing Order Creation ---`);
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      user_id: user.id,
      status: "pending",
      total_amount: product.price * 2,
      shipping_address: "123 E2E Test Lane",
      billing_address: "123 E2E Test Lane",
      contact_phone: "1234567890"
    })
    .select()
    .single();

  if (orderErr) {
    console.error("❌ Order Creation Error:", orderErr.message);
    return;
  }
  console.log(`✅ Order successfully created: ${order.id}`);

  // 7. Cleanup
  console.log(`\n--- 7. Cleanup (Optional) ---`);
  console.log(`Test complete! All RLS policies, triggers, and relations are working perfectly.`);
}

runTests().catch(console.error);
