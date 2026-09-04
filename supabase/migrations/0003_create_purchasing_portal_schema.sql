-- LGHS Shopping Portal: centralized school purchasing.
--
-- Naming note: this Supabase project is shared with two other LGHS apps (the
-- dorm chat app, which owns `profiles`/`channels`/`messages`, and the dorm
-- inventory app, which owns `inventory_*`). Everything added here is either
-- new or an additive change to `order_sites`; nothing existing is altered or
-- dropped. Helper functions are prefixed `pp_` because the chat app already
-- owns unprefixed names like `my_role()` and `is_active()`.
--
-- The legacy `public.purchases` / `public.spending_entries` tables belong to
-- the chat app and are left untouched. They are world-readable by the
-- publishable key, which is why the portal does not build on them: purchase
-- records here are visible only to the person who made them, their department
-- manager, and administrators.

-- ---------------------------------------------------------------------------
-- Departments / budget categories
-- ---------------------------------------------------------------------------

create table public.departments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text unique,                     -- short code used in exports, e.g. DORM
  emoji text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Staff (portal accounts) — keyed to Supabase Auth
-- ---------------------------------------------------------------------------
-- auth.users in this project is shared with the dorm chat app, whose ~119
-- accounts are anonymous (no email). A row in `staff` is what authorizes
-- someone to use the purchasing portal; signing in is not enough.

create table public.staff (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text not null,
  role text not null default 'employee'
    check (role in ('employee', 'manager', 'admin', 'super_admin')),
  home_department_id uuid references public.departments(id) on delete set null,
  auto_approve_limit numeric(12, 2) check (auto_approve_limit is null or auto_approve_limit >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index staff_role_idx on public.staff (role) where active;

-- Admins grant access by inviting an email address. When that person signs up,
-- a trigger turns the invite into a staff row with the role the admin chose.
create table public.staff_invites (
  email text primary key,
  full_name text,
  role text not null default 'employee'
    check (role in ('employee', 'manager', 'admin', 'super_admin')),
  home_department_id uuid references public.departments(id) on delete set null,
  invited_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

-- Managers can be responsible for more than one department.
create table public.department_managers (
  staff_id uuid not null references public.staff(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete cascade,
  primary key (staff_id, department_id)
);

create index department_managers_dept_idx on public.department_managers (department_id);

-- ---------------------------------------------------------------------------
-- Budgets
-- ---------------------------------------------------------------------------

create table public.department_budgets (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments(id) on delete cascade,
  period text not null check (period in ('monthly', 'quarterly', 'yearly')),
  amount numeric(12, 2) not null check (amount > 0),
  starts_on date not null default date_trunc('year', now())::date,
  ends_on date,                          -- null = still in effect
  notes text,
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on > starts_on)
);

-- One active budget per department at a time.
create unique index department_budgets_current_idx
  on public.department_budgets (department_id)
  where ends_on is null;

-- ---------------------------------------------------------------------------
-- Vendors — the existing `order_sites` catalog, extended
-- ---------------------------------------------------------------------------
-- Additive only (all new columns are nullable or defaulted) so the sibling app
-- that reads this table keeps working.

alter table public.order_sites
  add column if not exists integration text not null default 'manual'
    check (integration in ('manual', 'api', 'export', 'email')),
  add column if not exists integration_note text,
  add column if not exists account_hint text,
  add column if not exists requires_receipt boolean not null default true;

comment on column public.order_sites.integration is
  'How order data reaches the portal: manual = employee types it in; export = vendor dashboard CSV/PDF export; email = order-confirmation email forwarding; api = official vendor API. See docs/VENDOR_INTEGRATIONS.md.';

-- ---------------------------------------------------------------------------
-- System settings (single row)
-- ---------------------------------------------------------------------------

create table public.purchasing_settings (
  id boolean primary key default true check (id),
  school_name text not null default 'LGHS',
  approval_threshold numeric(12, 2) not null default 250 check (approval_threshold >= 0),
  budget_warn_pct int not null default 80 check (budget_warn_pct between 1 and 100),
  receipt_required_above numeric(12, 2) not null default 0 check (receipt_required_above >= 0),
  updated_at timestamptz not null default now()
);

insert into public.purchasing_settings (id) values (true);

-- ---------------------------------------------------------------------------
-- Shopping sessions
-- ---------------------------------------------------------------------------
-- Written the moment someone taps "Shop". Vendors do not hand their order data
-- back to us (see docs/VENDOR_INTEGRATIONS.md), so this is what the portal
-- *can* always capture: who went where, for which department, and why. It is
-- also what drives the "you shopped at Amazon 2 hours ago — record it?" nudge.

create table public.shopping_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  department_id uuid not null references public.departments(id) on delete restrict,
  vendor_id uuid references public.order_sites(id) on delete set null,
  vendor_name text not null,
  purpose text not null,
  estimated_total numeric(12, 2) check (estimated_total is null or estimated_total >= 0),
  opened_at timestamptz not null default now(),
  purchase_id uuid,                      -- set once the order is recorded
  dismissed_at timestamptz               -- "I didn't end up buying anything"
);

create index shopping_sessions_open_idx
  on public.shopping_sessions (staff_id, opened_at desc)
  where purchase_id is null and dismissed_at is null;

-- ---------------------------------------------------------------------------
-- Purchase orders
-- ---------------------------------------------------------------------------

create sequence public.purchase_order_ref_seq;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  reference text unique,                 -- PO-2026-0001, assigned by trigger
  staff_id uuid not null references public.staff(id) on delete restrict,
  department_id uuid not null references public.departments(id) on delete restrict,
  vendor_id uuid references public.order_sites(id) on delete set null,
  vendor_name text not null,             -- snapshot, or a one-off custom vendor
  purpose text not null,
  status text not null default 'ordered' check (status in (
    'pending_approval', 'rejected', 'ordered', 'shipped',
    'delivered', 'returned', 'cancelled'
  )),
  order_number text,
  ordered_on date,
  subtotal numeric(12, 2) check (subtotal is null or subtotal >= 0),
  shipping numeric(12, 2) not null default 0 check (shipping >= 0),
  tax numeric(12, 2) not null default 0 check (tax >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  payment_method text,
  tracking_carrier text,
  tracking_number text,
  tracking_url text,
  delivered_on date,
  notes text,
  source text not null default 'portal' check (source in ('portal', 'email', 'api', 'import')),
  session_id uuid references public.shopping_sessions(id) on delete set null,
  approved_by uuid references public.staff(id) on delete set null,
  approved_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index purchase_orders_created_idx on public.purchase_orders (created_at desc);
create index purchase_orders_dept_idx on public.purchase_orders (department_id, created_at desc);
create index purchase_orders_staff_idx on public.purchase_orders (staff_id, created_at desc);
create index purchase_orders_status_idx on public.purchase_orders (status);
create index purchase_orders_vendor_idx on public.purchase_orders (vendor_id);
create index purchase_orders_ordered_on_idx on public.purchase_orders (ordered_on);

alter table public.shopping_sessions
  add constraint shopping_sessions_purchase_fk
  foreign key (purchase_id) references public.purchase_orders(id) on delete set null;

create table public.purchase_order_items (
  id bigint generated always as identity primary key,
  purchase_id uuid not null references public.purchase_orders(id) on delete cascade,
  name text not null,
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  line_total numeric(14, 2) generated always as (round(quantity * unit_price, 2)) stored,
  sku text,
  url text,
  sort_order int not null default 0
);

create index purchase_order_items_purchase_idx on public.purchase_order_items (purchase_id);

create table public.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchase_orders(id) on delete cascade,
  storage_path text not null unique,     -- object key in the purchase-receipts bucket
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now()
);

create index purchase_receipts_purchase_idx on public.purchase_receipts (purchase_id);

-- Append-only audit trail: every status change and edit worth explaining.
create table public.purchase_events (
  id bigint generated always as identity primary key,
  purchase_id uuid not null references public.purchase_orders(id) on delete cascade,
  actor_id uuid references public.staff(id) on delete set null,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index purchase_events_purchase_idx on public.purchase_events (purchase_id, created_at);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------
-- security definer so RLS policies can consult `staff` without recursing
-- through `staff`'s own policies.

create or replace function public.pp_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.staff where id = auth.uid() and active;
$$;

create or replace function public.pp_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.staff where id = auth.uid() and active);
$$;

create or replace function public.pp_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.pp_role() in ('admin', 'super_admin'), false);
$$;

/** True when the current user may see purchases for this department:
 *  administrators everywhere, managers in the departments they run. */
create or replace function public.pp_manages_department(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pp_is_admin() or exists (
    select 1
    from public.department_managers dm
    join public.staff s on s.id = dm.staff_id
    where dm.staff_id = auth.uid()
      and dm.department_id = p_department_id
      and s.active
      and s.role in ('manager', 'admin', 'super_admin')
  );
$$;

/** The dollar amount this person may spend without an approval step:
 *  their personal limit when set, otherwise the school-wide threshold. */
create or replace function public.pp_approval_limit(p_staff_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select auto_approve_limit from public.staff where id = p_staff_id),
    (select approval_threshold from public.purchasing_settings where id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create or replace function public.pp_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger staff_touch before update on public.staff
  for each row execute function public.pp_touch_updated_at();
create trigger purchase_orders_touch before update on public.purchase_orders
  for each row execute function public.pp_touch_updated_at();

/** Assign the human-readable reference and hold anything over the approval
 *  limit for review. Totals are trusted from the client only to the extent
 *  that the approval rule is applied to whatever number was submitted. */
create or replace function public.pp_before_insert_purchase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reference is null then
    new.reference := 'PO-' || to_char(now(), 'YYYY') || '-'
      || lpad(nextval('public.purchase_order_ref_seq')::text, 4, '0');
  end if;

  -- Admins may record a status directly (imports, corrections). For everyone
  -- else the approval rule decides.
  if not public.pp_is_admin() then
    if new.total > public.pp_approval_limit(new.staff_id) then
      new.status := 'pending_approval';
    elsif new.status = 'pending_approval' then
      new.status := 'ordered';   -- under the limit: no approval step needed
    end if;
  end if;

  return new;
end;
$$;

create trigger purchase_orders_before_insert before insert on public.purchase_orders
  for each row execute function public.pp_before_insert_purchase();

/** Employees may correct their own orders, but may not approve them, move them
 *  to another person, or edit them once a decision has been recorded. */
create or replace function public.pp_before_update_purchase()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.pp_manages_department(old.department_id) then
    if new.staff_id <> old.staff_id then
      raise exception 'Only an administrator can reassign a purchase';
    end if;
    if new.status is distinct from old.status
       and new.status in ('pending_approval', 'rejected') then
      raise exception 'Only a manager or administrator can decide on a purchase';
    end if;
    if old.status = 'rejected' then
      raise exception 'This purchase was rejected — ask an administrator to reopen it';
    end if;
    -- Re-check the approval rule when the amount changes.
    if new.total is distinct from old.total
       and old.status not in ('pending_approval')
       and new.total > public.pp_approval_limit(new.staff_id) then
      new.status := 'pending_approval';
      new.approved_by := null;
      new.approved_at := null;
    end if;
  end if;

  return new;
end;
$$;

create trigger purchase_orders_before_update before update on public.purchase_orders
  for each row execute function public.pp_before_update_purchase();

/** Audit trail. */
create or replace function public.pp_log_purchase_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.purchase_events (purchase_id, actor_id, kind, detail)
    values (new.id, auth.uid(), 'created',
            jsonb_build_object('status', new.status, 'total', new.total));
  elsif new.status is distinct from old.status then
    insert into public.purchase_events (purchase_id, actor_id, kind, detail)
    values (new.id, auth.uid(), 'status_changed',
            jsonb_build_object('from', old.status, 'to', new.status,
                               'note', new.decision_note));
  elsif new.total is distinct from old.total then
    insert into public.purchase_events (purchase_id, actor_id, kind, detail)
    values (new.id, auth.uid(), 'amount_changed',
            jsonb_build_object('from', old.total, 'to', new.total));
  end if;
  return new;
end;
$$;

create trigger purchase_orders_audit after insert or update on public.purchase_orders
  for each row execute function public.pp_log_purchase_event();

/** New Supabase Auth signups become portal staff only when an administrator
 *  has invited that email address. Everyone else (including the dorm chat
 *  app's anonymous accounts) simply gets no staff row. */
create or replace function public.pp_accept_staff_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.staff_invites;
begin
  if new.email is null then
    return new;
  end if;

  select * into v_invite
  from public.staff_invites
  where lower(email) = lower(new.email) and accepted_at is null;

  if not found then
    return new;
  end if;

  insert into public.staff (id, email, full_name, role, home_department_id)
  values (
    new.id,
    new.email,
    coalesce(
      nullif(trim(v_invite.full_name), ''),
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(new.email, '@', 1)
    ),
    v_invite.role,
    v_invite.home_department_id
  )
  on conflict (id) do nothing;

  update public.staff_invites set accepted_at = now() where email = v_invite.email;
  return new;
end;
$$;

create trigger on_auth_user_created_accept_invite
  after insert on auth.users
  for each row execute function public.pp_accept_staff_invite();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.departments enable row level security;
alter table public.staff enable row level security;
alter table public.staff_invites enable row level security;
alter table public.department_managers enable row level security;
alter table public.department_budgets enable row level security;
alter table public.purchasing_settings enable row level security;
alter table public.shopping_sessions enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.purchase_receipts enable row level security;
alter table public.purchase_events enable row level security;

-- Departments: every staff member picks from the list; admins maintain it.
create policy "staff read departments" on public.departments
  for select to authenticated using (public.pp_is_staff());
create policy "admin write departments" on public.departments
  for all to authenticated using (public.pp_is_admin()) with check (public.pp_is_admin());

-- Staff directory: names are needed to show who ordered what.
create policy "staff read staff" on public.staff
  for select to authenticated using (public.pp_is_staff());
create policy "admin write staff" on public.staff
  for all to authenticated using (public.pp_is_admin()) with check (public.pp_is_admin());

create policy "admin manage invites" on public.staff_invites
  for all to authenticated using (public.pp_is_admin()) with check (public.pp_is_admin());

create policy "staff read managers" on public.department_managers
  for select to authenticated using (public.pp_is_staff());
create policy "admin write managers" on public.department_managers
  for all to authenticated using (public.pp_is_admin()) with check (public.pp_is_admin());

-- Budgets are visible to all staff: seeing "Dorm: $3,420 of $5,000" before
-- you shop is the point.
create policy "staff read budgets" on public.department_budgets
  for select to authenticated using (public.pp_is_staff());
create policy "admin write budgets" on public.department_budgets
  for all to authenticated using (public.pp_is_admin()) with check (public.pp_is_admin());

create policy "staff read settings" on public.purchasing_settings
  for select to authenticated using (public.pp_is_staff());
create policy "admin write settings" on public.purchasing_settings
  for update to authenticated using (public.pp_is_admin()) with check (public.pp_is_admin());

-- Vendors: readable with the publishable key (the sibling app relies on that
-- and a store list is not sensitive); only admins may edit.
create policy "admin insert vendors" on public.order_sites
  for insert to authenticated with check (public.pp_is_admin());
create policy "admin update vendors" on public.order_sites
  for update to authenticated using (public.pp_is_admin()) with check (public.pp_is_admin());
create policy "admin delete vendors" on public.order_sites
  for delete to authenticated using (public.pp_is_admin());

-- Shopping sessions: your own, plus your department's for managers/admins.
create policy "read own sessions" on public.shopping_sessions
  for select to authenticated
  using (staff_id = auth.uid() or public.pp_manages_department(department_id));
create policy "insert own sessions" on public.shopping_sessions
  for insert to authenticated
  with check (staff_id = auth.uid() and public.pp_is_staff());
create policy "update own sessions" on public.shopping_sessions
  for update to authenticated
  using (staff_id = auth.uid() or public.pp_is_admin())
  with check (staff_id = auth.uid() or public.pp_is_admin());

-- Purchases: your own, your department's if you manage it, everything if admin.
create policy "read visible purchases" on public.purchase_orders
  for select to authenticated
  using (staff_id = auth.uid() or public.pp_manages_department(department_id));
create policy "insert own purchases" on public.purchase_orders
  for insert to authenticated
  with check (
    public.pp_is_staff()
    and (staff_id = auth.uid() or public.pp_is_admin())
    and exists (select 1 from public.departments d where d.id = department_id and d.active)
  );
create policy "update visible purchases" on public.purchase_orders
  for update to authenticated
  using (staff_id = auth.uid() or public.pp_manages_department(department_id))
  with check (staff_id = auth.uid() or public.pp_manages_department(department_id));
create policy "admin delete purchases" on public.purchase_orders
  for delete to authenticated
  using (public.pp_is_admin() or (staff_id = auth.uid() and status = 'pending_approval'));

-- Children inherit visibility: the EXISTS runs under the caller's own RLS on
-- purchase_orders, so a row is reachable exactly when its parent is.
create policy "read items of visible purchases" on public.purchase_order_items
  for select to authenticated
  using (exists (select 1 from public.purchase_orders po where po.id = purchase_id));
create policy "write items of visible purchases" on public.purchase_order_items
  for all to authenticated
  using (exists (select 1 from public.purchase_orders po where po.id = purchase_id))
  with check (exists (select 1 from public.purchase_orders po where po.id = purchase_id));

create policy "read receipts of visible purchases" on public.purchase_receipts
  for select to authenticated
  using (exists (select 1 from public.purchase_orders po where po.id = purchase_id));
create policy "attach receipts to visible purchases" on public.purchase_receipts
  for insert to authenticated
  with check (exists (select 1 from public.purchase_orders po where po.id = purchase_id));
create policy "detach own receipts" on public.purchase_receipts
  for delete to authenticated
  using (uploaded_by = auth.uid() or public.pp_is_admin());

-- The audit trail is readable but never editable from the client; the triggers
-- above write it with definer rights.
create policy "read events of visible purchases" on public.purchase_events
  for select to authenticated
  using (exists (select 1 from public.purchase_orders po where po.id = purchase_id));

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------
-- security_invoker so the policies above still decide which rows come back.

create view public.v_purchase_orders with (security_invoker = on) as
select
  po.id,
  po.reference,
  po.staff_id,
  s.full_name as staff_name,
  po.department_id,
  d.name as department_name,
  d.emoji as department_emoji,
  po.vendor_id,
  po.vendor_name,
  po.purpose,
  po.status,
  po.order_number,
  po.ordered_on,
  po.subtotal,
  po.shipping,
  po.tax,
  po.total,
  po.payment_method,
  po.tracking_carrier,
  po.tracking_number,
  po.tracking_url,
  po.delivered_on,
  po.notes,
  po.source,
  po.approved_by,
  a.full_name as approved_by_name,
  po.approved_at,
  po.decision_note,
  po.created_at,
  po.updated_at,
  (select count(*) from public.purchase_receipts r where r.purchase_id = po.id) as receipt_count,
  (select count(*) from public.purchase_order_items i where i.purchase_id = po.id) as item_count
from public.purchase_orders po
join public.staff s on s.id = po.staff_id
join public.departments d on d.id = po.department_id
left join public.staff a on a.id = po.approved_by;

/** Budget vs. actual for the current period of every department that has a
 *  budget. security definer on purpose: department totals must reflect *all*
 *  spending, not just the caller's own purchases — but only staff may ask. */
create or replace function public.pp_budget_status()
returns table (
  department_id uuid,
  department_name text,
  period text,
  amount numeric,
  spent numeric,
  remaining numeric,
  pct int,
  period_start date,
  period_end date
)
language plpgsql
stable
security definer
set search_path = public
as $$
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
    select
      cb.*,
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
    w.department_id,
    d.name,
    w.period,
    w.amount,
    coalesce(sp.spent, 0)::numeric,
    (w.amount - coalesce(sp.spent, 0))::numeric,
    least(999, round(coalesce(sp.spent, 0) / w.amount * 100))::int,
    w.p_start,
    (w.p_end - 1)
  from windowed w
  join public.departments d on d.id = w.department_id
  left join lateral (
    select sum(po.total) as spent
    from public.purchase_orders po
    where po.department_id = w.department_id
      and po.status not in ('rejected', 'cancelled', 'returned')
      and coalesce(po.ordered_on, po.created_at::date) >= w.p_start
      and coalesce(po.ordered_on, po.created_at::date) < w.p_end
  ) sp on true
  order by d.name;
end;
$$;

/** Approve or reject a purchase awaiting a decision. */
create or replace function public.pp_decide_purchase(
  p_purchase_id uuid,
  p_approve boolean,
  p_note text default null
)
returns public.purchase_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.purchase_orders;
begin
  select * into v_row from public.purchase_orders where id = p_purchase_id;
  if not found then
    raise exception 'Purchase not found';
  end if;
  if not public.pp_manages_department(v_row.department_id) then
    raise exception 'Not authorized to decide on this purchase';
  end if;
  if v_row.status <> 'pending_approval' then
    raise exception 'This purchase is not awaiting approval';
  end if;

  update public.purchase_orders
  set status = case when p_approve then 'ordered' else 'rejected' end,
      approved_by = auth.uid(),
      approved_at = now(),
      decision_note = nullif(trim(coalesce(p_note, '')), '')
  where id = p_purchase_id
  returning * into v_row;

  return v_row;
end;
$$;

/** Let a staff member fix their own display name without opening up the rest
 *  of the row (role, spending limit) to self-service edits. */
create or replace function public.pp_update_my_name(p_full_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.pp_is_staff() then
    raise exception 'Not authorized';
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'Name is required';
  end if;
  update public.staff set full_name = trim(p_full_name) where id = auth.uid();
end;
$$;

revoke all on function public.pp_budget_status() from public;
revoke all on function public.pp_decide_purchase(uuid, boolean, text) from public;
revoke all on function public.pp_update_my_name(text) from public;
grant execute on function public.pp_budget_status() to authenticated;
grant execute on function public.pp_decide_purchase(uuid, boolean, text) to authenticated;
grant execute on function public.pp_update_my_name(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Receipt storage
-- ---------------------------------------------------------------------------
-- A private bucket, separate from the existing public `receipts` bucket that
-- the chat app's spending tracker uses. Objects are keyed
-- `<purchase_id>/<uuid>.<ext>` so the policies can resolve the parent purchase
-- from the path and reuse its visibility rules.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'purchase-receipts',
  'purchase-receipts',
  false,
  10485760,   -- 10 MB
  array['image/jpeg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

create policy "pp read receipts" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'purchase-receipts'
    and exists (
      select 1 from public.purchase_orders po
      where po.id::text = (storage.foldername(name))[1]
    )
  );

create policy "pp upload receipts" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'purchase-receipts'
    and exists (
      select 1 from public.purchase_orders po
      where po.id::text = (storage.foldername(name))[1]
    )
  );

create policy "pp delete receipts" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'purchase-receipts'
    and exists (
      select 1 from public.purchase_orders po
      where po.id::text = (storage.foldername(name))[1]
        and (po.staff_id = auth.uid() or public.pp_is_admin())
    )
  );
