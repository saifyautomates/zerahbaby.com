-- Migration: 20260928000059_complete_storage_containers.sql
-- Ensure all application storage buckets and policies exist in Supabase

-- 1. Insert missing storage buckets with public access
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('product-images', 'product-images', true, 52428800, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime']),
  ('hero-media', 'hero-media', true, 104857600, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm','video/quicktime']),
  ('reviews', 'reviews', true, 20971520, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/avif','video/mp4','video/webm']),
  ('brand-assets', 'brand-assets', true, 20971520, ARRAY['image/jpeg','image/png','image/webp','image/gif','image/svg+xml']),
  ('avatars', 'avatars', true, 10485760, ARRAY['image/jpeg','image/png','image/webp','image/gif']),
  ('invoices', 'invoices', true, 20971520, ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT (id) DO UPDATE SET 
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- 2. Storage Objects RLS Policies for all buckets
-- Public read for all public buckets
DROP POLICY IF EXISTS "Public Read Access All Buckets" ON storage.objects;
CREATE POLICY "Public Read Access All Buckets"
ON storage.objects FOR SELECT
TO public
USING (
  bucket_id IN ('product-images', 'hero-media', 'reviews', 'brand-assets', 'avatars', 'invoices')
);

-- Authenticated and Admin Upload for all buckets
DROP POLICY IF EXISTS "Authenticated Upload All Buckets" ON storage.objects;
CREATE POLICY "Authenticated Upload All Buckets"
ON storage.objects FOR INSERT
TO authenticated, anon
WITH CHECK (
  bucket_id IN ('product-images', 'hero-media', 'reviews', 'brand-assets', 'avatars', 'invoices')
);

-- Authenticated and Admin Update for all buckets
DROP POLICY IF EXISTS "Authenticated Update All Buckets" ON storage.objects;
CREATE POLICY "Authenticated Update All Buckets"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id IN ('product-images', 'hero-media', 'reviews', 'brand-assets', 'avatars', 'invoices')
);

-- Admin and Owner Delete for all buckets
DROP POLICY IF EXISTS "Authenticated Delete All Buckets" ON storage.objects;
CREATE POLICY "Authenticated Delete All Buckets"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id IN ('product-images', 'hero-media', 'reviews', 'brand-assets', 'avatars', 'invoices')
);
