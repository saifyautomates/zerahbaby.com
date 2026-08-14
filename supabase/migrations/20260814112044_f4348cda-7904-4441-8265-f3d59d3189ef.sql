DELETE FROM public.order_items WHERE order_id IN (SELECT id FROM public.orders WHERE user_id = '68f02ef3-ef84-4df2-8628-a746930d5ded');
DELETE FROM public.orders WHERE user_id = '68f02ef3-ef84-4df2-8628-a746930d5ded';
UPDATE public.products SET stock = 100 WHERE slug = 'h1' AND stock = 99;
DELETE FROM public.user_roles WHERE user_id = '68f02ef3-ef84-4df2-8628-a746930d5ded';