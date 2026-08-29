-- Add missing foreign key from reviews.user_id to profiles.id
-- This allows PostgREST to properly join the reviews and profiles tables for the API query:
-- /rest/v1/reviews?select=...,profiles(full_name)

ALTER TABLE public.reviews
  ADD CONSTRAINT fk_reviews_profiles
  FOREIGN KEY (user_id) REFERENCES public.profiles(id)
  ON DELETE CASCADE;
