-- Ordering portal: the list of stores people order from, and a log of every
-- purchase made for the school (who, when, how much).
-- Applied to project aheiyytqvzxkoowykkgt as "create_ordering_portal_schema".

create table public.order_sites (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  url text not null,
  blurb text,                                  -- one line shown on the tile
  emoji text,                                  -- tile icon
  category text not null default 'Other',
  category_order int not null default 0,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  ordered_by text not null,
  site_id uuid references public.order_sites(id) on delete set null,
  site_name text not null,                     -- snapshot: renaming a site
                                               -- never rewrites past spending
  amount numeric(10, 2) not null check (amount >= 0 and amount <= 100000),
  spent_on text not null default 'Food',       -- what the money went to
  notes text,
  purchased_on date not null default current_date,
  voided boolean not null default false,
  void_reason text,
  created_at timestamptz not null default now()
);

create index purchases_purchased_on_idx on public.purchases (purchased_on desc);
create index purchases_ordered_by_idx on public.purchases (ordered_by);

alter table public.order_sites enable row level security;
alter table public.purchases enable row level security;

-- Same trust model as the inventory checks: anyone with the publishable key
-- can read the site list and the purchase log, and add a purchase. Editing
-- and deleting are not granted -- the log is append-only, and the site list
-- is only editable from the Supabase dashboard. Corrections go through
-- void_purchase() below, which marks a row instead of rewriting it.
create policy "anon read order sites" on public.order_sites for select using (true);
create policy "anon read purchases" on public.purchases for select using (true);
create policy "anon insert purchases" on public.purchases for insert with check (true);

-- Log one purchase. Validation lives here so a bad amount or a missing name
-- can't reach the table no matter what the client sends.
create or replace function public.log_purchase(
  p_ordered_by text,
  p_site_id uuid,
  p_site_name text,
  p_amount numeric,
  p_spent_on text,
  p_notes text,
  p_purchased_on date
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_date date;
begin
  if p_ordered_by is null or length(trim(p_ordered_by)) = 0 then
    raise exception 'ordered_by is required';
  end if;
  if p_site_name is null or length(trim(p_site_name)) = 0 then
    raise exception 'site_name is required';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'amount must be zero or more';
  end if;

  -- Default to today, and don't accept a date from the future (a mistyped
  -- year would otherwise sit at the top of the list forever).
  v_date := coalesce(p_purchased_on, current_date);
  if v_date > current_date then
    v_date := current_date;
  end if;

  insert into purchases (ordered_by, site_id, site_name, amount, spent_on, notes, purchased_on)
  values (
    trim(p_ordered_by),
    p_site_id,
    trim(p_site_name),
    round(p_amount, 2),
    coalesce(nullif(trim(coalesce(p_spent_on, '')), ''), 'Food'),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_date
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Corrections: a mistyped amount gets struck from the totals, but the row
-- (and who logged it) stays visible. Definer rights, because the anon key
-- deliberately has no update permission of its own.
create or replace function public.void_purchase(
  p_id uuid,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update purchases
  set voided = true,
      void_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_id and voided = false;
end;
$$;

grant execute on function public.log_purchase(text, uuid, text, numeric, text, text, date) to anon;
grant execute on function public.void_purchase(uuid, text) to anon;
