-- Receiving: where an order was going, whether it turned up, who checked, and
-- what was wrong with it. An order can no longer quietly disappear after it
-- is placed.
-- Applied to project aheiyytqvzxkoowykkgt as
-- "delivery_verification_and_receiving".

alter table public.purchases
  add column delivery_location text
    check (delivery_location is null or delivery_location in ('Dorm', 'School', 'Shul')),
  add column expected_on date,
  add column delivery_status text not null default 'ordered'
    check (delivery_status in ('ordered', 'shipped', 'received', 'unpacked')),
  add column has_issue boolean not null default false,
  add column issue_note text,
  add column shipped_at timestamptz,
  add column received_at timestamptz,
  add column received_by text,
  add column unpacked_at timestamptz,
  add column unpacked_by text,
  add column issue_at timestamptz,
  add column issue_by text,
  add column issue_resolved_at timestamptz,
  add column issue_resolved_by text;

-- Michelle's queue: anything still owed a delivery or a check.
create index purchases_open_delivery_idx
  on public.purchases (delivery_status, expected_on)
  where voided = false and delivery_status <> 'unpacked';

alter table public.order_intents
  add column delivery_location text
    check (delivery_location is null or delivery_location in ('Dorm', 'School', 'Shul'));

-- What was actually on the order, so "15 gallons ordered, 12 arrived" is a
-- fact rather than a memory.
create table public.purchase_items (
  id bigint generated always as identity primary key,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  name text not null,
  qty_ordered numeric check (qty_ordered is null or qty_ordered >= 0),
  unit text,
  qty_received numeric check (qty_received is null or qty_received >= 0),
  sort_order int not null default 0
);

create index purchase_items_purchase_idx on public.purchase_items (purchase_id, sort_order);

alter table public.purchase_items enable row level security;
create policy "anon read purchase items" on public.purchase_items for select using (true);
create policy "anon insert purchase items" on public.purchase_items for insert with check (true);

/* Replace the item list on an order. Definer, because the anon key holds no
   update or delete of its own. */
create or replace function public.set_purchase_items(
  p_purchase_id uuid,
  p_items jsonb
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if p_purchase_id is null then
    raise exception 'purchase_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array';
  end if;
  if jsonb_array_length(p_items) > 200 then
    raise exception 'too many items';
  end if;

  delete from purchase_items where purchase_id = p_purchase_id;

  insert into purchase_items (purchase_id, name, qty_ordered, unit, sort_order)
  select
    p_purchase_id,
    trim(x.name),
    x.qty_ordered,
    nullif(trim(coalesce(x.unit, '')), ''),
    row_number() over ()
  from jsonb_to_recordset(p_items) as x(name text, qty_ordered numeric, unit text)
  where nullif(trim(coalesce(x.name, '')), '') is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/* How much of each line actually turned up. */
create or replace function public.set_received_quantities(
  p_purchase_id uuid,
  p_items jsonb
) returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  if p_purchase_id is null then
    raise exception 'purchase_id is required';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be an array';
  end if;

  update purchase_items pi
  set qty_received = x.qty_received
  from jsonb_to_recordset(p_items) as x(id bigint, qty_received numeric)
  where pi.id = x.id and pi.purchase_id = p_purchase_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/* Michelle's four marks. 'awaiting' puts an order back in the queue;
   'issue' means it arrived with something wrong and keeps the note. Every
   state change records who made it and when. */
create or replace function public.set_delivery_state(
  p_purchase_id uuid,
  p_state text,
  p_by text,
  p_note text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_by text;
begin
  if p_purchase_id is null then
    raise exception 'purchase_id is required';
  end if;
  if p_by is null or length(trim(p_by)) = 0 then
    raise exception 'who is doing this is required';
  end if;
  v_by := trim(p_by);

  if p_state = 'awaiting' then
    update purchases
    set delivery_status = case when shipped_at is not null then 'shipped' else 'ordered' end,
        received_at = null, received_by = null,
        unpacked_at = null, unpacked_by = null
    where id = p_purchase_id;

  elsif p_state = 'received' then
    update purchases
    set delivery_status = 'received',
        received_at = coalesce(received_at, now()),
        received_by = coalesce(received_by, v_by),
        unpacked_at = null, unpacked_by = null
    where id = p_purchase_id;

  elsif p_state = 'unpacked' then
    update purchases
    set delivery_status = 'unpacked',
        received_at = coalesce(received_at, now()),
        received_by = coalesce(received_by, v_by),
        unpacked_at = now(),
        unpacked_by = v_by
    where id = p_purchase_id;

  elsif p_state = 'issue' then
    if p_note is null or length(trim(p_note)) = 0 then
      raise exception 'say what was wrong';
    end if;
    update purchases
    set delivery_status = case when delivery_status = 'unpacked' then 'unpacked' else 'received' end,
        received_at = coalesce(received_at, now()),
        received_by = coalesce(received_by, v_by),
        has_issue = true,
        issue_note = trim(p_note),
        issue_at = now(),
        issue_by = v_by,
        issue_resolved_at = null,
        issue_resolved_by = null
    where id = p_purchase_id;

  else
    raise exception 'unknown state: %', p_state;
  end if;
end;
$$;

/* Close out a discrepancy. The note stays on the record. */
create or replace function public.resolve_delivery_issue(
  p_purchase_id uuid,
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
  update purchases
  set has_issue = false,
      issue_resolved_at = now(),
      issue_resolved_by = trim(p_by)
  where id = p_purchase_id and has_issue = true;
end;
$$;

/* A shipping notice is not a second order -- it moves the one we have along
   to "coming". */
create or replace function public.mark_shipped_by_ref(
  p_source_ref text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if p_source_ref is null or length(trim(p_source_ref)) = 0 then
    return false;
  end if;
  update purchases
  set delivery_status = 'shipped',
      shipped_at = coalesce(shipped_at, now())
  where source_ref = trim(p_source_ref)
    and delivery_status = 'ordered'
    and voided = false;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

grant execute on function public.set_purchase_items(uuid, jsonb) to anon;
grant execute on function public.set_received_quantities(uuid, jsonb) to anon;
grant execute on function public.set_delivery_state(uuid, text, text, text) to anon;
grant execute on function public.resolve_delivery_issue(uuid, text) to anon;
grant execute on function public.mark_shipped_by_ref(text) to anon;
