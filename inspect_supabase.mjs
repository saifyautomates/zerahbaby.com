import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import fs from 'fs';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function inspectSupabase() {
  console.log("Starting Supabase Audit...");
  
  const report = {
    tables: [],
    storage: []
  };

  try {
    // 1. Fetch Storage Buckets
    console.log("Fetching Storage Buckets...");
    const { data: buckets, error: bucketsError } = await supabase.storage.listBuckets();
    if (bucketsError) throw bucketsError;
    report.storage = buckets;

    // 2. We can't directly query pg_class via PostgREST unless there is an RPC.
    // Instead, let's query the first row of major tables to infer the schema,
    // OR if we can't, we just log what we know.
    // A better way is to use the supabase client to fetch types, but since we're in JS,
    // let's just attempt a basic fetch on the tables the user mentioned.
    
    const tablesToAudit = [
      'products', 'product_images', 'product_videos', 'product_costs',
      'categories', 'profiles', 'user_roles', 'user_addresses',
      'wishlist_items', 'wishlists', 'reviews', 'orders', 'order_items',
      'pos_customers', 'pos_daily_token_seq', 'sms_logs', 'shiprocket_tokens',
      'site_settings', 'webhook_events', 'website_visitors'
    ];

    for (const table of tablesToAudit) {
        console.log(`Checking table: ${table}`);
        const { data, error } = await supabase.from(table).select('*').limit(1);
        if (error) {
            report.tables.push({ table, status: 'Error', error: error.message });
        } else {
            const columns = data.length > 0 ? Object.keys(data[0]) : 'Empty Table, cannot infer columns via REST';
            report.tables.push({ table, status: 'OK', columns });
        }
    }

    fs.writeFileSync('supabase_audit_report.json', JSON.stringify(report, null, 2));
    console.log("Audit report written to supabase_audit_report.json");

  } catch (err) {
    console.error("Audit failed:", err);
  }
}

inspectSupabase();
