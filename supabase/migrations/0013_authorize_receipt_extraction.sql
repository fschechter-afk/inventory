-- pp_apply_receipt_extraction could be called by anyone.
--
-- It is SECURITY DEFINER (it has to be — it writes across purchase_orders,
-- purchase_order_items and purchase_receipts in one transaction) and granted
-- to `authenticated`, but it never checked who was calling. This project has
-- anonymous sign-in enabled for the dorm chat app, so `authenticated` is not a
-- trust boundary here: anyone holding a receipt id could have overwritten a
-- purchase's order number, vendor, totals and line items.
--
-- It now applies the same rule as the row policies — you must already be able
-- to see the purchase the receipt belongs to.

create or replace function public.pp_apply_receipt_extraction(
  p_receipt_id uuid,
  p_data jsonb
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt public.purchase_receipts;
  v_purchase public.purchase_orders;
  v_item jsonb;
  v_index int := 0;
  v_has_items boolean;
begin
  select * into v_receipt from public.purchase_receipts where id = p_receipt_id;
  if not found then
    raise exception 'Receipt not found';
  end if;

  select * into v_purchase from public.purchase_orders where id = v_receipt.purchase_id;
  if not found then
    raise exception 'Receipt not found';
  end if;

  -- Same rule as "read visible purchases": your own, or a department you
  -- manage, or administrator.
  if not (v_purchase.staff_id = auth.uid()
          or public.pp_manages_department(v_purchase.department_id)) then
    raise exception 'Not authorized to read this receipt';
  end if;

  select exists (select 1 from public.purchase_order_items where purchase_id = v_purchase.id)
    into v_has_items;

  update public.purchase_orders set
    order_number = coalesce(order_number, nullif(p_data ->> 'orderNumber', '')),
    ordered_on   = coalesce(ordered_on, (nullif(p_data ->> 'orderedOn', ''))::date),
    subtotal     = coalesce(subtotal, (p_data ->> 'subtotal')::numeric),
    shipping     = case when shipping = 0 then coalesce((p_data ->> 'shipping')::numeric, 0) else shipping end,
    tax          = case when tax = 0 then coalesce((p_data ->> 'tax')::numeric, 0) else tax end,
    total        = case when total = 0 then coalesce((p_data ->> 'total')::numeric, 0) else total end,
    payment_method = coalesce(payment_method, nullif(p_data ->> 'paymentMethod', '')),
    vendor_name  = case
                     when vendor_name in ('', 'Unknown vendor')
                       then coalesce(nullif(p_data ->> 'vendor', ''), vendor_name)
                     else vendor_name
                   end
  where id = v_purchase.id
  returning * into v_purchase;

  if not v_has_items then
    for v_item in select * from jsonb_array_elements(coalesce(p_data -> 'items', '[]'::jsonb))
    loop
      if nullif(trim(v_item ->> 'name'), '') is not null then
        insert into public.purchase_order_items (purchase_id, name, quantity, unit_price, sort_order)
        values (
          v_purchase.id,
          left(trim(v_item ->> 'name'), 500),
          greatest(coalesce((v_item ->> 'quantity')::numeric, 1), 0.001),
          greatest(coalesce((v_item ->> 'unit_price')::numeric, 0), 0),
          v_index
        );
        v_index := v_index + 1;
      end if;
    end loop;
  end if;

  update public.purchase_receipts
  set extraction_status = 'extracted', extracted = p_data, extracted_at = now(), extraction_error = null
  where id = p_receipt_id;

  insert into public.purchase_events (purchase_id, actor_id, kind, detail)
  values (v_purchase.id, auth.uid(), 'receipt_extracted',
          jsonb_build_object('items', v_index, 'total', v_purchase.total));

  return v_purchase;
end;
$$;

-- Aldi was added to the catalogue after the channel column shipped, so it took
-- the 'online' default while sitting under "Shop in store" — which would have
-- told staff the confirmation email records it, for a store you walk into.
update public.order_sites set channel = 'in_store'
where name = 'Aldi' and channel = 'online';
