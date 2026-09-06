-- An order logged by hand and then confirmed by email is one purchase, not
-- two. Also marks which stores get imported, so the portal can stop asking
-- people to log an order that logs itself.
-- Applied to project aheiyytqvzxkoowykkgt as "match_email_imports_to_manual_logs".

alter table public.order_sites
  add column if not exists auto_import boolean not null default false;

update public.order_sites
set auto_import = true
where name in ('Amazon', 'Walmart', 'Sam''s Club', 'WebstaurantStore');

/* When an import matches a manual row -- same store, same amount, within
   three days -- it attaches itself to that row instead of inserting: the
   person who logged it keeps the credit, and the order number comes along so
   later emails about the same order dedupe against it too. */
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

  -- Already imported.
  if exists (select 1 from purchases where source_ref = trim(p_source_ref)) then
    return null;
  end if;

  v_amount := round(p_amount, 2);
  v_date := coalesce(p_purchased_on, current_date);
  if v_date > current_date then
    v_date := current_date;
  end if;

  -- Did somebody already log this one by hand?
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

  select id into v_site_id
  from order_sites
  where lower(name) = lower(trim(p_site_name))
  limit 1;

  insert into purchases (
    ordered_by, site_id, site_name, amount, spent_on, notes,
    purchased_on, source, source_ref
  )
  values (
    coalesce(nullif(trim(coalesce(p_ordered_by, '')), ''), 'Unassigned'),
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

  return v_id;
end;
$$;

grant execute on function public.import_purchase_from_email(text, text, numeric, text, text, date, text) to anon;
