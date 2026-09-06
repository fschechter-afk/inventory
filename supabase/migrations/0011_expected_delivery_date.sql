-- The confirmation email usually says when it is arriving. Carry that in, and
-- let the person receiving correct where an order should go.
-- Applied to project aheiyytqvzxkoowykkgt as
-- "expected_delivery_date_from_email".

drop function if exists public.import_purchase_from_email(text, text, numeric, text, text, date, text);

create or replace function public.import_purchase_from_email(
  p_source_ref text,
  p_site_name text,
  p_amount numeric,
  p_spent_on text,
  p_notes text,
  p_purchased_on date,
  p_ordered_by text,
  p_expected_on date
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
  v_expected date;
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

  -- An arrival date more than a season out is a misread, not a delivery.
  v_expected := p_expected_on;
  if v_expected is not null and (v_expected < v_date - 1 or v_expected > v_date + 120) then
    v_expected := null;
  end if;

  -- 1. Already logged by hand? Attach to that row rather than adding a second,
  --    filling in an arrival date the person didn't have.
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
        notes = coalesce(nullif(trim(coalesce(notes, '')), ''), nullif(trim(coalesce(p_notes, '')), '')),
        expected_on = coalesce(expected_on, v_expected)
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
    purchased_on, source, source_ref, delivery_location, expected_on
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
    v_location,
    v_expected
  )
  returning id into v_id;

  if v_intent_id is not null then
    update order_intents set matched_purchase_id = v_id where id = v_intent_id;
  end if;

  return v_id;
end;
$$;

/* Send an order to the right place -- either because nobody said, or because
   it turned up somewhere else. */
create or replace function public.set_delivery_location(
  p_purchase_id uuid,
  p_location text,
  p_by text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_by is null or length(trim(p_by)) = 0 then
    raise exception 'who is doing this is required';
  end if;
  if p_location is not null and p_location not in ('Dorm', 'School', 'Shul') then
    raise exception 'delivery location must be Dorm, School or Shul';
  end if;
  update purchases set delivery_location = p_location where id = p_purchase_id;
end;
$$;

/* Set or correct when an order is due. */
create or replace function public.set_expected_date(
  p_purchase_id uuid,
  p_expected_on date,
  p_by text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_by is null or length(trim(p_by)) = 0 then
    raise exception 'who is doing this is required';
  end if;
  update purchases set expected_on = p_expected_on where id = p_purchase_id;
end;
$$;

grant execute on function public.import_purchase_from_email(text, text, numeric, text, text, date, text, date) to anon;
grant execute on function public.set_delivery_location(uuid, text, text) to anon;
grant execute on function public.set_expected_date(uuid, date, text) to anon;
