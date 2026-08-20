-- Spending tracker: replaces the Google Form counselors used to log dorm
-- purchases. No receipt scanning/AI — just amount, category, and an
-- optional photo of the receipt attached as proof.

create table public.spending_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order int not null default 0,
  active boolean not null default true
);

insert into public.spending_categories (name, sort_order) values
  ('Food Program', 10),
  ('Food & Snacks', 20),
  ('Activities & Programming', 30),
  ('Supplies', 40),
  ('Maintenance & Repairs', 50),
  ('Transportation', 60),
  ('Other', 70);

create table public.spending_entries (
  id uuid primary key default gen_random_uuid(),
  filled_by text not null,
  spent_on date not null default current_date,
  category text not null,
  amount numeric(10,2) not null check (amount > 0),
  vendor text,
  note text,
  receipt_url text,
  created_at timestamptz not null default now()
);

create index spending_entries_created_at_idx on public.spending_entries (created_at desc);
create index spending_entries_spent_on_idx on public.spending_entries (spent_on desc);

alter table public.spending_categories enable row level security;
alter table public.spending_entries enable row level security;

-- Same policy shape as the inventory tables: the publishable key can read
-- the category list and past entries, and insert new entries, but never
-- edit or delete. History stays immutable; categories are dashboard-only.
create policy "anon read spending categories" on public.spending_categories for select using (true);
create policy "anon read spending entries" on public.spending_entries for select using (true);
create policy "anon insert spending entries" on public.spending_entries for insert with check (true);

-- Public bucket for receipt photos. It's just a photo attached as proof of
-- purchase (no OCR/AI parsing) so a public URL is fine to store alongside
-- the entry, same as the inventory app's video links.
insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', true)
on conflict (id) do nothing;

create policy "anon upload receipts" on storage.objects for insert
  with check (bucket_id = 'receipts');

create policy "public read receipts" on storage.objects for select
  using (bucket_id = 'receipts');
