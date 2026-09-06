-- A running record of every item ordered.
--
-- The line items already exist per purchase; what was missing is the view
-- across them — "when did we last buy paper towels, what did we pay, who from,
-- how often." `name_key` is the normalisation used to group the same item
-- recorded with different capitalisation or stray spacing.
--
-- security_invoker so the purchase policies still decide what is visible: an
-- employee sees the items on their own orders, a manager their departments',
-- an administrator everything.

create view public.v_purchase_items with (security_invoker = on) as
select
  i.id,
  i.purchase_id,
  i.name,
  lower(btrim(regexp_replace(i.name, '\s+', ' ', 'g'))) as name_key,
  i.quantity,
  i.unit_price,
  i.line_total,
  i.sku,
  i.url,
  po.reference,
  po.order_number,
  po.effective_date,
  po.status,
  po.staff_id,
  s.full_name as staff_name,
  po.department_id,
  d.name as department_name,
  d.emoji as department_emoji,
  po.vendor_id,
  po.vendor_name
from public.purchase_order_items i
join public.purchase_orders po on po.id = i.purchase_id
join public.staff s on s.id = po.staff_id
join public.departments d on d.id = po.department_id;

comment on view public.v_purchase_items is
  'Every line item ever recorded, with its purchase context. Grouped by name_key this is the school''s running item history: price over time, which store was cheapest, how often something is reordered.';

-- Item names are searched with ILIKE across the whole history, which is a
-- sequential scan without this.
create index if not exists purchase_order_items_name_idx
  on public.purchase_order_items (lower(btrim(name)));
