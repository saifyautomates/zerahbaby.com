import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const client = createClient(supabaseUrl, supabaseKey);

async function seed() {
  const { data: brand } = await client.from('brands').insert({
    name: 'Zerah Originals',
    slug: 'zerah-originals',
    description: 'In-house brand',
    active: true
  }).select('id').single();

  const brandId = brand?.id || null;

  const { data: cat } = await client.from('categories').upsert({
    name: 'Clothing',
    slug: 'clothing',
    tagline: 'Soft clothing',
    description: 'Clothing',
    active: true,
    sort_order: 1
  }).select('id').single();

  for(let i = 0; i < 4; i++) {
    const { data: product, error } = await client.from('products').insert({
        name: 'Organic Cotton Onesie ' + i,
        slug: 'onesie-' + i + '-' + Date.now(),
        brand: 'Zerah Originals',
        brand_id: brandId,
        category: 'clothing',
        category_id: cat?.id || null,
        price: 999,
        mrp: 1499,
        age_group: '0-6m',
        stock: 50,
        low_stock_at: 10,
        sku: 'ZER-ONE-' + i,
        barcode: '123000' + i,
        description: 'Premium organic cotton onesie.',
        highlights: ['100% Organic', 'Breathable'],
        is_featured: true,
        is_active: true,
        sort_order: i,
        seo_title: 'Organic Onesie',
        seo_description: 'Buy organic onesie'
    }).select('id').single();
    
    if (product) {
        await client.from('product_costs').insert({ product_id: product.id, buying_price: 400 });
        await client.from('product_images').insert({
            product_id: product.id,
            public_url: 'https://placehold.co/800x1000/f3f4f6/a1a1aa?text=Onesie+' + i,
            is_primary: true,
            sort_order: 1,
            alt_text: 'Onesie',
            storage_path: null
        });
        console.log("Seeded product:", product.id);
    }
  }
}
seed();
