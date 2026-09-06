-- Carry the delivery location, expected date and item list through the two
-- ways an order gets recorded.
-- Applied to project aheiyytqvzxkoowykkgt as
-- "carry_delivery_details_through_ordering".

-- The old signatures are replaced rather than overloaded, so there is exactly
-- one of each to call.
drop function if exists public.log_purchase(text, uuid, text, numeric, text, text, date);
drop function if exists public.record_order_intent(text, uuid, text);

/* Log a purchase, now with where it is going, when it is due, and what is on
   it. */
create or replace function public.log_purchase(
  p_ordered_by text,
  p_site_id uuid,
  p_site_name text,
  p_amount numeric,
  p_spent_on text,
  p_notes text,
  p_purchased_on date,
  p_delivery_location text,
  p_expected_on date,
  p_items jsonb
) returns uuid
language plpgsql
security definer
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
  if p_delivery_location is not null and p_delivery_location not in ('Dorm', 'School', 'Shul') then
    raise exception 'delivery location must be Dorm, School or Shul';
  end if;

  v_date := coalesce(p_purchased_on, current_date);
  if v_date > current_date then
    v_date := current_date;
  end if;

  insert into purchases (
    ordered_by, site_id, site_name, amount, spent_on, notes, purchased_on,
    delivery_location, expected_on
  )
  values (
    trim(p_ordered_by),
    p_site_id,
    trim(p_site_name),
    round(p_amount, 2),
    coalesce(nullif(trim(coalesce(p_spent_on, '')), ''), 'Food'),
    nullif(trim(coalesce(p_notes, '')), ''),
    v_date,
    p_delivery_location,
    p_expected_on
  )
  returning id into v_id;

  if p_items is not null and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    perform set_purchase_items(v_id, p_items);
  end if;

  return v_id;
end;
$$;

/* Heading off to a store, and where the order should land. */
create or replace function public.record_order_intent(
  p_ordered_by text,
  p_site_id uuid,
  p_site_name text,
  p_delivery_location text
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
  if p_delivery_location is not null and p_delivery_location not in ('Dorm', 'School', 'Shul') then
    raise exception 'delivery location must be Dorm, School or Shul';
  end if;

  insert into order_intents (ordered_by, site_id, site_name, delivery_location)
  values (trim(p_ordered_by), p_site_id, trim(p_site_name), p_delivery_location)
  returning id into v_id;
  return v_id;
end;
$$;

/* An imported order takes the delivery location from the intent that claimed
   it, so an automatically-attributed order still knows where it is going. */
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
  v_location text;
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

  -- 2. Whoever set off for this store recently, when it is unambiguous.
  v_owner := nullif(trim(coalesce(p_ordered_by, '')), '');
  if v_owner is null then
    select count(distinct ordered_by) into v_distinct
    from order_intents
    where matched_purchase_id is null
      and lower(site_name) = lower(trim(p_site_name))
      and created_at >= now() - interval '3 days';

    if v_distinct = 1 then
      select id, ordered_by, delivery_location into v_intent_id, v_owner, v_location
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
    purchased_on, source, source_ref, delivery_location
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
    trim(p_source_ref),
    v_location
  )
  returning id into v_id;

  if v_intent_id is not null then
    update order_intents set matched_purchase_id = v_id where id = v_intent_id;
  end if;

  return v_id;
end;
$$;

grant execute on function public.log_purchase(text, uuid, text, numeric, text, text, date, text, date, jsonb) to anon;
grant execute on function public.record_order_intent(text, uuid, text, text) to anon;
grant execute on function public.import_purchase_from_email(text, text, numeric, text, text, date, text) to anon;
