-- Purchases recorded after the fact have no `ordered_on`, so every date filter
-- had to say "ordered_on in range, OR ordered_on is null and created_at in
-- range". Expressed through PostgREST that becomes stacked `or=` parameters
-- that cannot use an index and are easy to get subtly wrong.
--
-- One maintained column instead: the date a purchase actually counts on.
-- A generated column will not do — casting timestamptz to date depends on the
-- session time zone, so it is not immutable.

alter table public.purchase_orders add column effective_date date;

create or replace function public.pp_set_effective_date()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.effective_date := coalesce(new.ordered_on, (new.created_at at time zone 'UTC')::date);
  return new;
end;
$$;

revoke all on function public.pp_set_effective_date() from anon, authenticated;

create trigger purchase_orders_effective_date
  before insert or update on public.purchase_orders
  for each row execute function public.pp_set_effective_date();

update public.purchase_orders
set effective_date = coalesce(ordered_on, (created_at at time zone 'UTC')::date);

alter table public.purchase_orders alter column effective_date set not null;

create index purchase_orders_effective_date_idx
  on public.purchase_orders (effective_date desc);

drop index if exists public.purchase_orders_ordered_on_idx;

-- Republish the view with the new column. Dropped and recreated rather than
-- replaced, because CREATE OR REPLACE VIEW can only append columns.
drop view if exists public.v_purchase_orders;
create view public.v_purchase_orders with (security_invoker = on) as
select
  po.id, po.reference, po.staff_id, s.full_name as staff_name,
  po.department_id, d.name as department_name, d.emoji as department_emoji,
  po.vendor_id, po.vendor_name, po.purpose, po.status, po.order_number,
  po.ordered_on, po.effective_date,
  po.subtotal, po.shipping, po.tax, po.total, po.payment_method,
  po.tracking_carrier, po.tracking_number, po.tracking_url, po.delivered_on,
  po.notes, po.source, po.approved_by, a.full_name as approved_by_name,
  po.approved_at, po.decision_note, po.created_at, po.updated_at,
  (select count(*) from public.purchase_receipts r where r.purchase_id = po.id) as receipt_count,
  (select count(*) from public.purchase_order_items i where i.purchase_id = po.id) as item_count
from public.purchase_orders po
join public.staff s on s.id = po.staff_id
join public.departments d on d.id = po.department_id
left join public.staff a on a.id = po.approved_by;

-- Budget windows use the same column, so a budget bar and a date-ranged report
-- can never disagree about which period a purchase falls in.
create or replace function public.pp_budget_status()
returns table (
  department_id uuid, department_name text, period text, amount numeric,
  spent numeric, remaining numeric, pct int, period_start date, period_end date
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not public.pp_is_staff() then
    raise exception 'Not authorized';
  end if;

  return query
  with current_budget as (
    select b.department_id, b.period, b.amount
    from public.department_budgets b
    where b.ends_on is null and b.starts_on <= current_date
  ),
  windowed as (
    select cb.*,
      case cb.period
        when 'monthly' then date_trunc('month', current_date)::date
        when 'quarterly' then date_trunc('quarter', current_date)::date
        else date_trunc('year', current_date)::date
      end as p_start,
      case cb.period
        when 'monthly' then (date_trunc('month', current_date) + interval '1 month')::date
        when 'quarterly' then (date_trunc('quarter', current_date) + interval '3 months')::date
        else (date_trunc('year', current_date) + interval '1 year')::date
      end as p_end
    from current_budget cb
  )
  select
    w.department_id, d.name, w.period, w.amount,
    coalesce(sp.spent, 0)::numeric,
    (w.amount - coalesce(sp.spent, 0))::numeric,
    least(999, round(coalesce(sp.spent, 0) / w.amount * 100))::int,
    w.p_start, (w.p_end - 1)
  from windowed w
  join public.departments d on d.id = w.department_id
  left join lateral (
    select sum(po.total) as spent
    from public.purchase_orders po
    where po.department_id = w.department_id
      and po.status not in ('rejected', 'cancelled', 'returned')
      and po.effective_date >= w.p_start
      and po.effective_date < w.p_end
  ) sp on true
  order by d.name;
end;
$$;
