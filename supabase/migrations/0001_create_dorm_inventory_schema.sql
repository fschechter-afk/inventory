-- Dorm inventory: item catalog, weekly checks, per-item results.
-- Applied to project aheiyytqvzxkoowykkgt as "create_dorm_inventory_schema".

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  name text not null,
  food_program boolean not null default false,
  category_order int not null default 0,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (category, name)
);

create table public.inventory_checks (
  id uuid primary key default gen_random_uuid(),
  filled_by text not null,
  pantry_video_url text,
  closet_video_url text,
  low_count int not null default 0,
  out_count int not null default 0,
  created_at timestamptz not null default now()
);

create table public.inventory_check_items (
  id bigint generated always as identity primary key,
  check_id uuid not null references public.inventory_checks(id) on delete cascade,
  item_id uuid references public.inventory_items(id) on delete set null,
  item_name text not null,
  category text not null,
  status text not null check (status in ('ok','low','out')),
  qty numeric check (qty is null or qty >= 0)
);

create index inventory_check_items_check_id_idx on public.inventory_check_items (check_id);
create index inventory_checks_created_at_idx on public.inventory_checks (created_at desc);

alter table public.inventory_items enable row level security;
alter table public.inventory_checks enable row level security;
alter table public.inventory_check_items enable row level security;

-- Anyone with the publishable key may read the catalog and past checks, and
-- submit new checks. No update/delete policies -> history is immutable, and
-- the catalog can only be edited from the Supabase dashboard.
create policy "anon read items" on public.inventory_items for select using (true);
create policy "anon read checks" on public.inventory_checks for select using (true);
create policy "anon read check items" on public.inventory_check_items for select using (true);
create policy "anon insert checks" on public.inventory_checks for insert with check (true);
create policy "anon insert check items" on public.inventory_check_items for insert with check (true);

-- Atomic submit: header + item rows in one transaction, with the low/out
-- counts derived server-side so history can't disagree with its own rows.
create or replace function public.submit_inventory_check(
  p_filled_by text,
  p_pantry_video_url text,
  p_closet_video_url text,
  p_items jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_check_id uuid;
  v_low int;
  v_out int;
begin
  if p_filled_by is null or length(trim(p_filled_by)) = 0 then
    raise exception 'filled_by is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'items must be a non-empty array';
  end if;
  if jsonb_array_length(p_items) > 500 then
    raise exception 'too many items';
  end if;

  select
    count(*) filter (where x.status = 'low'),
    count(*) filter (where x.status = 'out')
  into v_low, v_out
  from jsonb_to_recordset(p_items) as x(status text);

  insert into inventory_checks (filled_by, pantry_video_url, closet_video_url, low_count, out_count)
  values (
    trim(p_filled_by),
    nullif(trim(coalesce(p_pantry_video_url,'')), ''),
    nullif(trim(coalesce(p_closet_video_url,'')), ''),
    v_low,
    v_out
  )
  returning id into v_check_id;

  insert into inventory_check_items (check_id, item_id, item_name, category, status, qty)
  select v_check_id, x.item_id, x.item_name, x.category, x.status, x.qty
  from jsonb_to_recordset(p_items)
    as x(item_id uuid, item_name text, category text, status text, qty numeric);

  return v_check_id;
end;
$$;

grant execute on function public.submit_inventory_check(text, text, text, jsonb) to anon;
