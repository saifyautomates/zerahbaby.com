import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const envFile = fs.readFileSync('.env', 'utf-8');
const env = {};
envFile.split('\n').forEach(line => {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
});

const supabase = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);

async function run() {
  console.log("Checking DB connection & RLS...");
  const { data, error } = await supabase.from('products').select('id, name, sales_channel').limit(5);
  console.log('Select Error:', error?.message || 'None');
  console.log('Select Data Count:', data?.length || 0);

  // Try creating a test product with anon key
  const testProduct = {
    slug: 'test-offline-product-' + Date.now(),
    name: 'TEST OFFLINE PRODUCT',
    brand: 'TEST',
    category: 'Toys',
    price: 100,
    mrp: 150,
    stock: 10,
    sku: 'TEST-OFFLINE-001',
    barcode: '1234567890123',
    sales_channel: 'OFFLINE_ONLY',
    is_active: true
  };

  console.log("Attempting to insert test product...");
  const { data: insertData, error: insertError } = await supabase
    .from('products')
    .insert([testProduct])
    .select('id, name, sales_channel')
    .single();

  console.log('Insert Error:', insertError?.message || 'None');
  if (insertData) {
    console.log('✅ Created Product:', insertData);
  }
}

run();
