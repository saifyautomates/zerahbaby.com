CREATE TABLE contact_messages (
    id uuid default uuid_generate_v4() primary key,
    created_at timestamp with time zone default now() not null,
    name text not null,
    email text not null,
    order_number text,
    message text not null
);

ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert contact messages" ON contact_messages FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Admins can view contact messages" ON contact_messages FOR SELECT TO authenticated USING (has_role(auth.uid(), 'admin'));