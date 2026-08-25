import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const client = createClient(supabaseUrl, supabaseKey);

async function testAuth() {
  console.log("Testing Supabase Auth...");
  const testEmail = `test.user.${Date.now()}@example.com`;
  const testPassword = "TestPassword123!";

  try {
    // 1. Test Sign Up
    console.log(`Attempting to sign up: ${testEmail}`);
    const { data: signUpData, error: signUpError } = await client.auth.signUp({
      email: testEmail,
      password: testPassword,
    });

    if (signUpError) {
      console.error("❌ Sign Up Failed:", signUpError.message);
      return;
    }

    console.log("✅ Sign Up Successful!", signUpData.user ? `User ID: ${signUpData.user.id}` : "");

    // 2. Test Sign In
    console.log(`Attempting to sign in: ${testEmail}`);
    const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
      email: testEmail,
      password: testPassword,
    });

    if (signInError) {
      console.error("❌ Sign In Failed:", signInError.message);
      return;
    }

    console.log("✅ Sign In Successful! Session Token established.");

    // 3. Test Session Delete (Sign Out)
    const { error: signOutError } = await client.auth.signOut();
    if (signOutError) {
      console.error("❌ Sign Out Failed:", signOutError.message);
      return;
    }
    console.log("✅ Sign Out Successful!");

    console.log("\n🚀 COMPLETE! Supabase Auth is fully operational.");
  } catch (err) {
    console.error("Unexpected error during auth test:", err);
  }
}

testAuth();
