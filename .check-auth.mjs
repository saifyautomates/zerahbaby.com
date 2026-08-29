import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://wbbatgbvizhghtkvuguf.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY; // We'll need to load this from .env

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load env from .env.local if it exists
try {
  const envFile = readFileSync(resolve('.env'), 'utf-8');
  envFile.split('\n').forEach(line => {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
    }
  });
} catch (e) {
  console.log("No .env found", e);
}

const url = process.env.VITE_SUPABASE_URL || 'https://wbbatgbvizhghtkvuguf.supabase.co';
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key);

async function testAuth() {
  const testEmail = `testuser_${Date.now()}@example.com`;
  console.log(`Testing auth sign up with ${testEmail}...`);
  
  const { data, error } = await supabase.auth.signUp({
    email: testEmail,
    password: 'Password123!',
  });

  if (error) {
    console.error("❌ Sign Up Failed:", error.message);
  } else {
    console.log("✅ Sign Up Succeeded!", data.user?.id);
    
    console.log("Testing sign in...");
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: testEmail,
      password: 'Password123!',
    });
    
    if (signInError) {
      console.error("❌ Sign In Failed:", signInError.message);
    } else {
      console.log("✅ Sign In Succeeded!", signInData.user?.id);
    }
  }
}

testAuth();
