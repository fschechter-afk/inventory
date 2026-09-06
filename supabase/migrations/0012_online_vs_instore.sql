-- Nobody prints an Amazon receipt.
--
-- The receipt photo was being asked for on every purchase, but it only exists
-- for a purchase somebody physically walked out of a store with. For an online
-- order the record has to come from the vendor's confirmation email, and the
-- staff member should do nothing at all.
--
-- `channel` is what lets the portal ask the right thing — or nothing.

alter table public.order_sites
  add column if not exists channel text not null default 'online'
    check (channel in ('online', 'in_store', 'both')),
  add column if not exists items_in_email boolean;

comment on column public.order_sites.channel is
  'online = ordered on a website, recorded from the confirmation email; in_store = walked in, recorded from the receipt photo; both = either.';
comment on column public.order_sites.items_in_email is
  'Whether this vendor''s confirmation email actually lists the line items. Null = not established yet. False means the order is captured but the items need another source.';

update public.order_sites set
  channel = v.channel,
  items_in_email = v.items_in_email
from (values
  -- Verified against real confirmation emails.
  ('Target',                 'both',     true),
  ('Walmart',                'both',     false),  -- names one item, hides the rest
  -- Ordered online; the confirmation lists line items. Extraction reads them.
  ('Amazon',                 'online',   true),
  ('WebstaurantStore',       'online',   true),
  ('Instacart',              'online',   true),
  ('Staples',                'online',   true),
  ('Home Depot',             'both',     true),
  -- Membership warehouses: mostly walk-in, and the register receipt is the record.
  ('Sam''s Club',            'both',     true),
  ('Costco',                 'both',     true),
  -- Cash and carry, no online ordering at all.
  ('Restaurant Depot',       'in_store', null),
  ('Jewel-Osco',             'both',     null),
  ('Mariano''s',             'both',     null),
  ('Kol Tuv Kosher Foods',   'in_store', null),
  ('Hungarian Kosher Foods', 'in_store', null)
) as v(name, channel, items_in_email)
where public.order_sites.name = v.name;
