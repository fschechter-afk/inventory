-- Tapping a store tile says "I am about to order from here". Recording that
-- lets an imported confirmation find its owner without anyone claiming it.
-- Applied to project aheiyytqvzxkoowykkgt as
-- "attribute_imports_from_order_intents".

create table public.order_intents (
  id uuid primary key default gen_random_uuid(),
  ordered_by text not null,
  site_id uuid references public.order_sites(id) on delete set null,
  site_name text not null,
  matched_purchase_id uuid references public.purchases(id) on delete set null,
  created_at timestamptz not null default now()
);

create index order_intents_open_idx on public.order_intents (site_name, created_at desc)
  where matched_purchase_id is null;

alter table public.order_intents enable row level security;

create policy "anon read order intents" on public.order_intents for select using (true);
create policy "anon insert order intents" on public.order_intents for insert with check (true);

/* Record that someone is heading off to a store. */
create or replace function public.record_order_intent(
  p_ordered_by text,
  p_site_id uuid,
  p_site_name text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_ordered_by is null or length(trim(p_ordered_by)) = 0 then
    raise exception 'ordered_by is required';
  end if;
  if p_site_name is null or length(trim(p_site_name)) = 0 then
    raise exception 'site_name is required';
  end if;
  if lower(trim(p_ordered_by)) = 'unassigned' then
    raise exception 'pick a real name';
  end if;

  insert into order_intents (ordered_by, site_id, site_name)
  values (trim(p_ordered_by), p_site_id, trim(p_site_name))
  returning id into v_id;
  return v_id;
end;
$$;

/* An import now looks for its owner in three places, in order: a purchase
   already logged by hand, an open intent for that store, and failing both it
   arrives unassigned for someone to claim. */
create or replace function public.import_purchase_from_email(
  p_source_ref text,
  p_site_name text,
  p_amount numeric,
  p_spent_on text,
  p_notes text,
  p_purchased_on date,
  p_ordered_by text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_site_id uuid;
  v_date date;
  v_amount numeric;
  v_owner text;
  v_intent_id uuid;
  v_distinct int;
begin
  if p_source_ref is null or length(trim(p_source_ref)) = 0 then
    raise exception 'source_ref is required';
  end if;
  if p_site_name is null or length(trim(p_site_name)) = 0 then
    raise exception 'site_name is required';
  end if;
  if p_amount is null or p_amount < 0 then
    raise exception 'amount must be zero or more';
  end if;

  if exists (select 1 from purchases where source_ref = trim(p_source_ref)) then
    return null;
  end if;

  v_amount := round(p_amount, 2);
  v_date := coalesce(p_purchased_on, current_date);
  if v_date > current_date then
    v_date := current_date;
  end if;

  -- 1. Already logged by hand? Attach to that row rather than adding a second.
  select id into v_id
  from purchases
  where source = 'portal'
    and source_ref is null
    and voided = false
    and lower(site_name) = lower(trim(p_site_name))
    and amount = v_amount
    and purchased_on between v_date - 3 and v_date + 3
  order by abs(purchased_on - v_date), created_at
  limit 1;

  if v_id is not null then
    update purchases
    set source_ref = trim(p_source_ref),
        notes = coalesce(nullif(trim(coalesce(notes, '')), ''), nullif(trim(coalesce(p_notes, '')), ''))
    where id = v_id;
    return v_id;
  end if;

  -- 2. Did somebody set off for this store recently? Only when it's
  --    unambiguous: two people shopping the same store leaves it unassigned
  --    rather than crediting the wrong one.
  v_owner := nullif(trim(coalesce(p_ordered_by, '')), '');
  if v_owner is null then
    select count(distinct ordered_by) into v_distinct
    from order_intents
    where matched_purchase_id is null
      and lower(site_name) = lower(trim(p_site_name))
      and created_at >= now() - interval '3 days';

    if v_distinct = 1 then
      select id, ordered_by into v_intent_id, v_owner
      from order_intents
      where matched_purchase_id is null
        and lower(site_name) = lower(trim(p_site_name))
        and created_at >= now() - interval '3 days'
      order by created_at
      limit 1;
    end if;
  end if;

  select id into v_site_id
  from order_sites
  where lower(name) = lower(trim(p_site_name))
  limit 1;

  insert into purchases (
    ordered_by, site_id, site_name, amount, spent_on, notes,
    purchased_on, source, source_ref
  )
  values (
    coalesce(v_owner, 'Unassigned'),
    v_site_id,
    trim(p_site_name),
    v_amount,
    coalesce(nullif(trim(coalesce(p_spent_on, '')), ''), 'Food'),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_date,
    'email',
    trim(p_source_ref)
  )
  returning id into v_id;

  -- An intent is spent once it has found its order.
  if v_intent_id is not null then
    update order_intents set matched_purchase_id = v_id where id = v_intent_id;
  end if;

  return v_id;
end;
$$;

/* Claim by order number, for when the portal couldn't work out whose it was.
   Matches the number against the dedupe key or the notes. */
create or replace function public.claim_purchase_by_order_number(
  p_order_number text,
  p_ordered_by text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_needle text;
begin
  if p_ordered_by is null or length(trim(p_ordered_by)) = 0 then
    raise exception 'ordered_by is required';
  end if;
  if lower(trim(p_ordered_by)) = 'unassigned' then
    raise exception 'pick a real name';
  end if;

  v_needle := trim(coalesce(p_order_number, ''));
  if length(v_needle) < 4 then
    raise exception 'that order number is too short to match';
  end if;

  select id into v_id
  from purchases
  where voided = false
    and ordered_by = 'Unassigned'
    and (source_ref ilike '%' || v_needle or notes ilike '%' || v_needle || '%')
  order by created_at desc
  limit 1;

  if v_id is null then
    return null;
  end if;

  update purchases set ordered_by = trim(p_ordered_by) where id = v_id;
  return v_id;
end;
$$;

grant execute on function public.record_order_intent(text, uuid, text) to anon;
grant execute on function public.import_purchase_from_email(text, text, numeric, text, text, date, text) to anon;
grant execute on function public.claim_purchase_by_order_number(text, text) to anon;
