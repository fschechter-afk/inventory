-- Strip the typing out of recording a purchase.
--
-- A form nobody fills in is worse than no form, so the only thing a staff
-- member does now is tap a store and, when the vendor's email can't supply the
-- items, photograph the receipt. Everything the portal used to ask for is
-- either derived, defaulted, or extracted.

-- 1. Purpose was required, which made it a mandatory text field in the middle
--    of the shop flow. It is now optional and defaults to the department.
alter table public.purchase_orders alter column purpose drop not null;
alter table public.shopping_sessions alter column purpose drop not null;

-- 2. Receipt extraction: what the model read off the photo, kept next to the
--    file so a re-run can be compared against what was applied.
alter table public.purchase_receipts
  add column if not exists extraction_status text not null default 'pending'
    check (extraction_status in ('pending', 'extracted', 'failed', 'skipped')),
  add column if not exists extracted jsonb,
  add column if not exists extracted_at timestamptz,
  add column if not exists extraction_error text;

create index if not exists purchase_receipts_pending_idx
  on public.purchase_receipts (created_at)
  where extraction_status = 'pending';

/** Fill a purchase in from what was read off its receipt.
 *
 *  Only fills blanks — a value a person typed always wins over the model, and
 *  re-running extraction can never quietly rewrite a corrected total. Line
 *  items are written only when the purchase has none, for the same reason. */
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

  select exists (select 1 from public.purchase_order_items where purchase_id = v_purchase.id)
    into v_has_items;

  update public.purchase_orders set
    order_number = coalesce(order_number, nullif(p_data ->> 'orderNumber', '')),
    ordered_on   = coalesce(ordered_on, (nullif(p_data ->> 'orderedOn', ''))::date),
    subtotal     = coalesce(subtotal, (p_data ->> 'subtotal')::numeric),
    -- shipping and tax default to 0, so "unset" is indistinguishable from a
    -- real zero; only fill them when they are still exactly 0.
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

revoke all on function public.pp_apply_receipt_extraction(uuid, jsonb) from public, anon;
grant execute on function public.pp_apply_receipt_extraction(uuid, jsonb) to authenticated;
