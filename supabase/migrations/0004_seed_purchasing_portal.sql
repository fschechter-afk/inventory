-- Starting data for the LGHS Shopping Portal.
--
-- Idempotent: safe to re-run. Departments and vendor metadata are matched by
-- name so an administrator's later edits in the app are never overwritten.

-- ---------------------------------------------------------------------------
-- Departments / budget categories
-- ---------------------------------------------------------------------------

insert into public.departments (name, code, emoji, sort_order) values
  ('Dorm',               'DORM',  '🛏️',  10),
  ('Kitchen / Food',     'FOOD',  '🍽️',  20),
  ('School',             'SCH',   '🏫',  30),
  ('Classroom',          'CLASS', '📚',  40),
  ('Maintenance',        'MAINT', '🔧',  50),
  ('Office',             'OFF',   '🖇️',  60),
  ('Technology',         'TECH',  '💻',  70),
  ('Events',             'EVENT', '🎉',  80),
  ('Student Activities', 'STUACT','⚽',  90),
  ('Transportation',     'TRANS', '🚐', 100),
  ('Admissions',         'ADM',   '📨', 110),
  ('Marketing',          'MKT',   '📣', 120),
  ('Other',              'OTHER', '📦', 130)
on conflict (name) do nothing;

-- ---------------------------------------------------------------------------
-- Vendor integration capability
-- ---------------------------------------------------------------------------
-- `integration` records the best path order data can take from the vendor into
-- this database. It is a statement about what the vendor offers, not about
-- what is wired up yet — every vendor falls back to manual entry plus a
-- receipt upload, which always works. See docs/VENDOR_INTEGRATIONS.md for the
-- research behind each value.

update public.order_sites set
  integration = v.integration,
  integration_note = v.note,
  account_hint = v.account_hint,
  requires_receipt = v.requires_receipt
from (values
  ('Amazon', 'api',
   'Amazon Business offers a Reporting API (getOrderReports) plus six built-in order fields — Cost Center, Department Code, GL Code and others — that map cleanly onto this portal''s departments. Requires the school to be on an Amazon Business account, not a consumer amazon.com account. Consumer Amazon has no order API.',
   'Order from the school Amazon Business account so the purchase shows up in Business Analytics.', true),

  ('Walmart', 'export',
   'Walmart''s public developer APIs are seller-side (Marketplace/Supplier) and expose nothing about a buyer''s own orders. Walmart Business accounts do provide order history and spend reporting in the web dashboard, which an administrator can export and reconcile.',
   'Use the school Walmart Business account.', true),

  ('Instacart', 'export',
   'Instacart Business supports bulk receipt export (PDF + CSV) and scheduled automated report emails to an administrator. No buyer-side order API.',
   'Order through Instacart Business, not a personal Instacart account.', true),

  ('Costco', 'manual',
   'No buyer-facing order API and no cXML punchout. Online order history is visible in the account; warehouse purchases exist only on the paper receipt.',
   'Membership card is at the front office.', true),

  ('Sam''s Club', 'manual',
   'No buyer-facing order API and no punchout catalog. Club receipts are available in the Sam''s Club app, which is the easiest way to photograph one.',
   'Membership card is at the front office.', true),

  ('Restaurant Depot', 'manual',
   'Cash-and-carry warehouse with no online ordering and no public API. The paper receipt at the register is the only record.',
   'Photograph the receipt before leaving the parking lot — this is the only copy.', true),

  ('WebstaurantStore', 'email',
   'No public buyer API. Sends a detailed order-confirmation email per order, which is a good candidate for the receipt-forwarding pipeline described in docs/VENDOR_INTEGRATIONS.md.',
   null, true),

  ('Target', 'email',
   'Target''s public APIs are partner/seller-side. Order confirmation emails and in-app receipts are the practical record.',
   null, true),

  ('Staples', 'export',
   'Staples Business Advantage accounts provide order history and spend reporting for administrators; consumer staples.com does not. No public buyer API either way.',
   null, true),

  ('Home Depot', 'email',
   'No public buyer order API. Pro Xtra accounts keep a searchable purchase history and email receipts.',
   null, true),

  ('Jewel-Osco', 'manual',
   'No public buyer order API. Store receipts and the app''s purchase history are the record.', null, true),

  ('Mariano''s', 'manual',
   'No public buyer order API. Store receipts and the Kroger/Mariano''s app history are the record.', null, true),

  ('Kol Tuv Kosher Foods', 'manual',
   'Local kosher grocer. No API; order confirmations and paper receipts only.', null, true),

  ('Hungarian Kosher Foods', 'manual',
   'Local kosher grocer. No API; paper receipts only.', null, true)
) as v(name, integration, note, account_hint, requires_receipt)
where public.order_sites.name = v.name;

-- Any vendor added later starts at 'manual' (the column default) until someone
-- researches it, which is the honest default.

-- ---------------------------------------------------------------------------
-- Bootstrap administrator
-- ---------------------------------------------------------------------------
-- A staff row is what authorizes someone to use the portal; this project's
-- auth.users is shared with the dorm chat app, whose ~119 accounts must not
-- get access. Signing up with an invited email address creates the staff row
-- (see pp_accept_staff_invite). This is the first invite; everyone else is
-- invited from the portal's Admin screen.
--
-- Change the address below if the school's portal owner is someone else, then
-- have them sign up at the portal with that exact email.

insert into public.staff_invites (email, full_name, role)
values ('fschechter@lghschicago.org', null, 'super_admin')
on conflict (email) do nothing;

-- If that person already has a Supabase Auth account, promote it now rather
-- than waiting for a signup that will never happen.
insert into public.staff (id, email, full_name, role, home_department_id)
select u.id,
       u.email,
       coalesce(nullif(trim(i.full_name), ''),
                nullif(trim(u.raw_user_meta_data ->> 'full_name'), ''),
                split_part(u.email, '@', 1)),
       i.role,
       i.home_department_id
from auth.users u
join public.staff_invites i on lower(i.email) = lower(u.email)
where i.accepted_at is null
on conflict (id) do nothing;

update public.staff_invites i set accepted_at = now()
from public.staff s
where lower(s.email) = lower(i.email) and i.accepted_at is null;
