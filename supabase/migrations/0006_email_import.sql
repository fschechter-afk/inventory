-- Automatic imports: order confirmations landing in onlineorders@lghschicago.org
-- are read on a schedule and written straight into purchases, so nobody has to
-- log anything by hand.
-- Applied to project aheiyytqvzxkoowykkgt as "email_import".

alter table public.purchases
  add column source text not null default 'portal' check (source in ('portal', 'email')),
  add column source_ref text;

-- One row per confirmation email, however many times the importer runs.
create unique index purchases_source_ref_idx on public.purchases (source_ref)
  where source_ref is not null;

-- A shared mailbox doesn't say who placed the order, so imports land
-- unassigned and are claimed from the portal.
create index purchases_unassigned_idx on public.purchases (ordered_by)
  where ordered_by = 'Unassigned' and voided = false;

/* Insert one purchase read out of an email. Returns the new row's id, or
   null if that email was already imported — so the importer can re-run over
   the same messages without double-counting. */
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
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_site_id uuid;
  v_date date;
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

  -- Already imported: say so quietly rather than failing the whole run.
  if exists (select 1 from purchases where source_ref = trim(p_source_ref)) then
    return null;
  end if;

  select id into v_site_id
  from order_sites
  where lower(name) = lower(trim(p_site_name))
  limit 1;

  v_date := coalesce(p_purchased_on, current_date);
  if v_date > current_date then
    v_date := current_date;
  end if;

  insert into purchases (
    ordered_by, site_id, site_name, amount, spent_on, notes,
    purchased_on, source, source_ref
  )
  values (
    coalesce(nullif(trim(coalesce(p_ordered_by, '')), ''), 'Unassigned'),
    v_site_id,
    trim(p_site_name),
    round(p_amount, 2),
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

/* Put a name to an imported purchase. Only ever fills in an unassigned one,
   so claiming can't rewrite somebody else's row. Definer rights, because the
   anon key deliberately has no update permission of its own. */
create or replace function public.claim_purchase(
  p_id uuid,
  p_ordered_by text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if p_ordered_by is null or length(trim(p_ordered_by)) = 0 then
    raise exception 'ordered_by is required';
  end if;
  if lower(trim(p_ordered_by)) = 'unassigned' then
    raise exception 'pick a real name';
  end if;

  update purchases
  set ordered_by = trim(p_ordered_by)
  where id = p_id and ordered_by = 'Unassigned';

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

grant execute on function public.import_purchase_from_email(text, text, numeric, text, text, date, text) to anon;
grant execute on function public.claim_purchase(uuid, text) to anon;
