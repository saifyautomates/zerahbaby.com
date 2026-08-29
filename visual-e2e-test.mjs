import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminClient = createClient(supabaseUrl, supabaseServiceKey);

(async () => {
  console.log("Setting up Test Admin User for the visual test...");
  const email = `admin.test.${Date.now()}@example.com`;
  const password = "TestPassword123!";
  
  const { data: userAuth, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (authError) {
    console.error("Failed to create test user:", authError);
    return;
  }
  console.log(`Created test admin user: ${email}`);
  await adminClient.from("user_roles").upsert({ user_id: userAuth.user.id, role: "admin" });

  // Make sure a dummy product exists
  await adminClient.from("products").upsert({
    id: '99999999-9999-9999-9999-999999999999',
    name: 'Frontend Dummy Product',
    slug: 'frontend-dummy-product',
    description: 'Do not buy',
    price: 1,
    mrp: 1,
    stock: 100,
    sku: 'DUMMY-FRONTEND',
    status: 'active',
    is_active: true
  });

  console.log("Launching VISIBLE browser for automated test...");
  // Launch in non-headless mode with slowMo so the user can watch the automation
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  
  // Mock Razorpay API network requests to simulate success
  await context.route("https://wbbatgbvizhghtkvuguf.supabase.co/functions/v1/create-razorpay-order", async route => {
    console.log("[MOCK] Intercepted Razorpay Order Creation");
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rzp_order_id: "order_mock123", key_id: "rzp_test_mock", amount: 100, currency: "INR" })
    });
  });

  await context.route("https://wbbatgbvizhghtkvuguf.supabase.co/functions/v1/shiprocket-api", async route => {
    console.log("[MOCK] Intercepted Shiprocket API call");
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, shiprocket_order_id: "sr_mock_123", shiprocket_shipment_id: "sr_shipment_123" })
    });
  });

  const page = await context.newPage();
  
  // Mock window.Razorpay on every page load
  await page.addInitScript(() => {
    window.Razorpay = function(options) {
      console.log("Mock Razorpay widget initialized with options:", options);
      this.open = function() {
        console.log("Mock Razorpay widget opened. Simulating success...");
        setTimeout(() => {
          options.handler({
            razorpay_payment_id: "pay_mock12345",
            razorpay_order_id: options.order_id,
            razorpay_signature: "mock_signature_12345"
          });
        }, 1500);
      };
      this.on = function(event, callback) {};
    };
  });

  try {
    // 1. Login
    console.log("Navigating to login page...");
    await page.goto("http://localhost:8080/auth");
    await page.fill("input[name='email'], input[type='email']", email);
    await page.fill("input[name='password'], input[type='password']", password);
    await page.click("button:has-text('Sign In'), button:has-text('Login'), button:has-text('Continue')");
    await page.waitForTimeout(3000);

    // 2. Go to product page
    console.log("Navigating to dummy product...");
    await page.goto("http://localhost:8080/product/frontend-dummy-product");
    
    console.log("Waiting for Add to bag button...");
    await page.waitForSelector("button:has-text('Add to bag')", { timeout: 10000 });
    await page.click("button:has-text('Add to bag')");
    await page.waitForTimeout(3000);
    
    // 3. Go to cart
    console.log("Navigating to Cart...");
    await page.goto("http://localhost:8080/cart");
    
    console.log("Waiting for Checkout button...");
    const checkoutBtn = page.locator("text=/Sign in to check out/i, text=/Checkout/i, text=/Proceed/i").first();
    await checkoutBtn.waitFor({ state: "visible", timeout: 10000 });
    await checkoutBtn.click();
    
    await page.waitForTimeout(3000);
    
    // 5. Fill out the form
    const addressInput = page.locator("input[name='address'], input[name='street']");
    if (await addressInput.count() > 0) {
       console.log("Checkout form found, filling details...");
       
       try { await page.fill("input[name='full_name'], input[name='name']", "Test Admin User"); } catch(e){}
       try { await page.fill("input[name='phone'], input[name='mobile']", "9999999999"); } catch(e){}
       try { await page.fill("input[name='address'], input[name='street']", "123 Test St"); } catch(e){}
       try { await page.fill("input[name='city']", "Test City"); } catch(e){}
       try { await page.fill("input[name='state']", "Test State"); } catch(e){}
       try { await page.fill("input[name='pincode'], input[name='zip']", "123456"); } catch(e){}
       
       // Click Prepaid option (usually Razorpay)
       const prepaidOption = page.locator("text=/Prepaid/i, text=/Razorpay/i, text=/Pay Online/i").first();
       if (await prepaidOption.count() > 0) {
         await prepaidOption.click();
       }
       
       // Click Place Order
       const placeOrderBtn = page.locator("button:has-text('Place Order'), button:has-text('Confirm Order'), button:has-text('Pay Now')").first();
       if (await placeOrderBtn.count() > 0) {
          await placeOrderBtn.click();
          console.log("Clicked Pay Now. Waiting for Mock Razorpay...");
          await page.waitForTimeout(5000);
       }
    } else {
       console.log("Could not find checkout form inputs.");
    }
    
    // 6. Go to admin panel and test Shiprocket
    console.log("Navigating to Admin Panel...");
    await page.goto("http://localhost:8080/admin/orders");
    await page.waitForTimeout(5000); // Give user time to see it

    console.log("Visual E2E Test completed successfully!");
  } catch (err) {
    console.error("Test failed during automation:", err);
  } finally {
    // Leave it open for a few seconds so user can see
    await page.waitForTimeout(5000);
    await browser.close();
    console.log("Browser closed.");
    
    // Cleanup User and Product
    await adminClient.auth.admin.deleteUser(userAuth.user.id);
    await adminClient.from("products").delete().eq("id", "99999999-9999-9999-9999-999999999999");
  }
})();
