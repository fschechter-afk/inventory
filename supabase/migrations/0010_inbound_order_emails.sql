-- Automatic order capture from vendor confirmation emails.
--
-- Every message the mailbox watcher forwards lands here first, raw, then gets
-- parsed and — where it can be matched to the person who went shopping —
-- turned into a purchase automatically. Keeping the raw message means a
-- parser bug is fixable after the fact by re-running, rather than being a
-- permanently lost order.

create table public.inbound_emails (
  id uuid primary key default gen_random_uuid(),
  -- RFC822 Message-ID. The watcher is at-least-once, so this is what stops a
  -- retry from creating a second purchase.
  message_id text not null unique,
  received_at timestamptz not null default now(),
  from_address text,
  to_address text,
  subject text,
  body text,
  vendor_guess text,
  parser text,
  confidence text,
  parsed jsonb,
  status text not null default 'pending' check (status in (
    'pending',     -- received, not yet parsed
    'matched',     -- became a purchase
    'unmatched',   -- parsed, but nobody to attribute it to yet
    'ignored',     -- not an order (shipping notice, marketing)
    'failed'       -- parser or insert error; see `error`
  )),
  purchase_id uuid references public.purchase_orders(id) on delete set null,
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index inbound_emails_status_idx on public.inbound_emails (status, received_at desc);
create index inbound_emails_purchase_idx on public.inbound_emails (purchase_id);

alter table public.inbound_emails enable row level security;

-- Raw mail can contain a delivery address and a card's last four, so it is
-- administrators only. The ingestion function uses the service role and
-- bypasses these policies.
create policy "admin read inbound email" on public.inbound_emails
  for select to authenticated using (public.pp_is_admin());
create policy "admin update inbound email" on public.inbound_emails
  for update to authenticated using (public.pp_is_admin()) with check (public.pp_is_admin());
create policy "admin delete inbound email" on public.inbound_emails
  for delete to authenticated using (public.pp_is_admin());

-- Where an ingested order came from, for the audit trail and so re-running a
-- parser can find what it already created.
comment on column public.inbound_emails.parsed is
  'Extracted fields as parsed: order number, date, items, subtotal, shipping, tax, total, payment method.';

/** Attribute an ingested order that could not be matched automatically.
 *  Creates the purchase, its items, and links the email — in one transaction,
 *  so a half-assigned order is not possible. */
create or replace function public.pp_assign_inbound_email(
  p_email_id uuid,
  p_staff_id uuid,
  p_department_id uuid,
  p_purpose text
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email public.inbound_emails;
  v_parsed jsonb;
  v_purchase public.purchase_orders;
  v_item jsonb;
  v_index int := 0;
begin
  if not public.pp_is_admin() then
    raise exception 'Not authorized';
  end if;

  select * into v_email from public.inbound_emails where id = p_email_id;
  if not found then
    raise exception 'Email not found';
  end if;
  if v_email.purchase_id is not null then
    raise exception 'This email is already recorded as a purchase';
  end if;

  v_parsed := coalesce(v_email.parsed, '{}'::jsonb);

  insert into public.purchase_orders (
    staff_id, department_id, vendor_name, purpose, order_number, ordered_on,
    subtotal, shipping, tax, total, payment_method, source, status
  ) values (
    p_staff_id,
    p_department_id,
    coalesce(v_email.vendor_guess, 'Unknown vendor'),
    coalesce(nullif(trim(p_purpose), ''), v_email.subject, 'Recorded from order email'),
    v_parsed ->> 'orderNumber',
    (v_parsed ->> 'orderedOn')::date,
    (v_parsed ->> 'subtotal')::numeric,
    coalesce((v_parsed ->> 'shipping')::numeric, 0),
    coalesce((v_parsed ->> 'tax')::numeric, 0),
    coalesce((v_parsed ->> 'total')::numeric, 0),
    v_parsed ->> 'paymentMethod',
    'email',
    'ordered'
  )
  returning * into v_purchase;

  for v_item in select * from jsonb_array_elements(coalesce(v_parsed -> 'items', '[]'::jsonb))
  loop
    insert into public.purchase_order_items (purchase_id, name, quantity, unit_price, sort_order)
    values (
      v_purchase.id,
      v_item ->> 'name',
      coalesce((v_item ->> 'quantity')::numeric, 1),
      coalesce((v_item ->> 'unit_price')::numeric, 0),
      v_index
    );
    v_index := v_index + 1;
  end loop;

  update public.inbound_emails
  set purchase_id = v_purchase.id, status = 'matched', processed_at = now()
  where id = p_email_id;

  return v_purchase;
end;
$$;

revoke all on function public.pp_assign_inbound_email(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.pp_assign_inbound_email(uuid, uuid, uuid, text) to authenticated;
