import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://wbbatgbvizhghtkvuguf.supabase.co';
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_WiczJQTx4afGJ02WAiUIUw_8YlWjkSP';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runAudit() {
  console.log("=== STARTING SECURITY AUDIT ===");

  // Test 1: Unauthenticated access to admin resources
  console.log("\n[Test 1] Anonymous Read of 'product_costs'");
  const { data: costs, error: costsErr } = await supabase.from('product_costs').select('*');
  if (costsErr) console.log("✅ Blocked: ", costsErr.message);
  else if (costs?.length > 0) console.log("❌ VULNERABLE: Product costs exposed!");
  else console.log("✅ Passed (Empty/Blocked)");

  console.log("\n[Test 2] Anonymous Read of 'offline_sales'");
  const { data: pos, error: posErr } = await supabase.from('offline_sales').select('*');
  if (posErr) console.log("✅ Blocked: ", posErr.message);
  else if (pos?.length > 0) console.log("❌ VULNERABLE: Offline sales exposed!");
  else console.log("✅ Passed (Empty/Blocked)");

  console.log("\n[Test 3] Anonymous Read of 'orders'");
  const { data: orders, error: orderErr } = await supabase.from('orders').select('*');
  if (orderErr) console.log("✅ Blocked: ", orderErr.message);
  else if (orders?.length > 0) console.log("❌ VULNERABLE: Orders exposed to anonymous users!");
  else console.log("✅ Passed (Empty/Blocked)");

  console.log("\n[Test 4] Anonymous Read of 'profiles'");
  const { data: profiles, error: profErr } = await supabase.from('profiles').select('*');
  if (profErr) console.log("✅ Blocked: ", profErr.message);
  else if (profiles?.length > 0) console.log("❌ VULNERABLE: Profiles exposed!");
  else console.log("✅ Passed (Empty/Blocked)");

  console.log("\n[Test 5] Anonymous Insert to 'orders' (IDOR/Privilege Escalation attempt)");
  const { error: insertErr } = await supabase.from('orders').insert({ 
    user_id: '00000000-0000-0000-0000-000000000000', 
    full_name: 'Hacker', 
    total: 0 
  });
  if (insertErr) console.log("✅ Blocked: ", insertErr.message);
  else console.log("❌ VULNERABLE: Anonymous insert allowed!");

  // Auth User tests
  console.log("\n=== Authenticating as Dummy Customer A ===");
  const { data: authData, error: authErr } = await supabase.auth.signUp({
    email: 'test@test.com',
    password: 'password123'
  });
  
  if (authErr && authErr.status !== 422) { // 422 means already exists, which is fine for testing
      console.log("Auth error:", authErr.message);
      // Try login
      await supabase.auth.signInWithPassword({
        email: 'test@test.com',
        password: 'password123'
      });
  }

  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) {
      console.log("Could not authenticate. Skipping authenticated tests.");
      return;
  }
  
  console.log("Authenticated as:", session.session.user.id);

  console.log("\n[Test 6] Authenticated User A Read of 'product_costs'");
  const { data: costs2, error: costsErr2 } = await supabase.from('product_costs').select('*');
  if (costsErr2) console.log("✅ Blocked: ", costsErr2.message);
  else if (costs2?.length > 0) console.log("❌ VULNERABLE: Product costs exposed to Customer!");
  else console.log("✅ Passed (Empty/Blocked)");

  console.log("\n[Test 7] Authenticated User A Read of 'profiles' (Trying to read others)");
  const { data: profilesA, error: profErrA } = await supabase.from('profiles').select('*');
  if (profErrA) console.log("✅ Blocked: ", profErrA.message);
  else if (profilesA?.length > 1) console.log("❌ VULNERABLE: IDOR - Can read other profiles! Count:", profilesA.length);
  else console.log("✅ Passed (Only can read self, count:", profilesA?.length, ")");

  console.log("\n[Test 8] Authenticated User A Read of ALL 'orders'");
  const { data: ordersA, error: orderErrA } = await supabase.from('orders').select('*');
  if (orderErrA) console.log("✅ Blocked: ", orderErrA.message);
  else {
      const otherOrders = ordersA?.filter(o => o.user_id !== session.session.user.id);
      if (otherOrders?.length > 0) console.log("❌ VULNERABLE: IDOR - Can read other users' orders! Count:", otherOrders.length);
      else console.log("✅ Passed (Can only see own orders, count:", ordersA?.length, ")");
  }

  console.log("\n=== AUDIT COMPLETE ===");
}

runAudit();
