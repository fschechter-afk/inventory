# LGHS Shopping Portal — setup and administration

The portal lives at **`https://fschechter-afk.github.io/inventory/#/shop`**.
That is the one link to give staff. On a phone, "Add to Home Screen" makes it
an app.

The dorm inventory check is unchanged and still lives at the root URL.

## Before anyone can use it: three one-time steps

### 1. Turn off email confirmation (or set up SMTP)

Supabase → **Authentication → Sign In / Providers → Email**.

By default Supabase requires a new account to click a confirmation link, and
the built-in mail service is rate-limited to a couple of messages an hour —
which will not survive a staff onboarding. Either:

- **Simplest:** turn **Confirm email** off. Access is already controlled by
  invitation (below), so an unconfirmed address cannot see anything.
- **Or:** configure a real SMTP sender under **Project Settings → Auth → SMTP**
  and leave confirmation on.

The sign-in screen handles both — it will say "check your email" when
confirmation is required.

### 2. Claim the administrator account

The migration created an invitation for `fschechter@lghschicago.org` with the
**super admin** role. Go to the portal, choose **"First time here? Set up your
account"**, and sign up with that exact address. The invitation turns into a
staff record automatically.

To use a different address instead, run this in the Supabase SQL editor first:

```sql
update public.staff_invites
set email = 'someone-else@lghschicago.org'
where email = 'fschechter@lghschicago.org';
```

### 3. Invite everyone else

From the portal: **Admin → People → Invite someone**. Enter their school email,
pick a role and a home department. They sign up with that address and are in.

> **Why invitations?** This Supabase project is shared with the dorm chat app,
> which has around 119 anonymous student accounts. Being signed in is
> deliberately *not* enough to see purchasing data — a row in the `staff` table
> is what grants access, and only an administrator can create one.

## Roles

| Role | Can do |
| --- | --- |
| **Employee** | Shop, record their own purchases, upload receipts, see only their own orders |
| **Department manager** | Everything above, plus see and approve purchases for the departments they manage |
| **Administrator** | See every purchase; manage departments, stores, budgets, people and settings; run reports |
| **Super admin** | Everything, plus promoting other people to super admin |

A manager only sees the departments assigned to them under
**Admin → Departments → Edit → Managers**. Giving someone the manager *role*
does nothing until they are attached to a department.

## Approvals

- **Admin → Settings → Approval limit** sets the school-wide threshold
  (default **$250**).
- Any individual can be given their own limit under **Admin → People**.
- A purchase over the limit is held at *Awaiting approval* and appears in the
  manager's **Approve** tab. Under the limit, it is recorded and done.
- This is enforced in the database, not in the browser: an employee cannot
  approve their own purchase even by manipulating the app.
- Raising the amount on an already-approved order sends it back for approval.

Two ways an approval happens:

- **Before shopping** — enter an estimate on the Shop screen; if it is over the
  limit the button becomes *Request approval* and the vendor site does not open
  until a manager says yes.
- **After the fact** — record a purchase over the limit and it lands in the
  approval queue for review.

## Budgets

**Admin → Budgets** sets a monthly, quarterly or yearly figure per department.
Staff see the remaining balance on the Shop screen when they pick that
department, with a warning past the threshold in **Settings → Budget warning
at** (default 80%) and a clear over-budget message past 100%.

Changing a budget closes the old figure rather than overwriting it, so an
earlier period still explains itself.

Rejected, cancelled and returned orders do not count against a budget.

## Departments and stores

- **Admin → Departments** — add, rename, reorder, assign managers, or hide a
  department from new purchases without deleting its history.
- **Admin → Stores** — add, edit or hide vendors. The **"How order data reaches
  the portal"** field records what that vendor actually offers; see
  [VENDOR_INTEGRATIONS.md](VENDOR_INTEGRATIONS.md). The **note for staff** is
  shown when someone picks that store, which is the right place for things like
  "use the school Amazon Business account".
- Staff can always pick **Other / custom vendor** and type a name, so a one-off
  local purchase never gets lost.

## Receipts

Receipts go into a **private** Supabase Storage bucket (`purchase-receipts`),
separate from the older public `receipts` bucket the chat app uses. They are
readable only by people who can already see the purchase, through short-lived
signed URLs.

Orders with no receipt are flagged in three places: the employee's own list, the
dashboard's "Needs attention" card, and the **Missing receipts** report.

## Reports

**Dashboard → Reports** covers spending by department, store, person, month and
status, plus budget vs. actual, missing receipts, and a full purchase export.
Every one exports to CSV that opens cleanly in Excel.

For ad-hoc questions — "everything ordered for the Dorm from Amazon during
September" — use **Search all purchases**, which filters on employee,
department, store, status, date range, amount range and free text, then exports
whatever is on screen.

## Data model

| Table | Holds |
| --- | --- |
| `departments` | Budget categories |
| `department_budgets` | Current and historical budget figures |
| `department_managers` | Which managers cover which departments |
| `staff` / `staff_invites` | Portal accounts and pending invitations |
| `order_sites` | The vendor catalog (shared with the dorm chat app, extended here) |
| `shopping_sessions` | Every "Shop" tap, recorded before the vendor opens |
| `purchase_orders` | The purchase record |
| `purchase_order_items` | Line items |
| `purchase_receipts` | Receipt/invoice files |
| `purchase_events` | Append-only audit trail of status and amount changes |
| `purchasing_settings` | School-wide approval limit and warning threshold |

The legacy `purchases` and `spending_entries` tables belong to the dorm chat
app and are untouched. The portal deliberately does not build on them: they are
readable by anyone holding the publishable key, which is the opposite of what
purchase records need.

Schema and seed data are checked in under
[`supabase/migrations/`](../supabase/migrations), so a fresh project can be
rebuilt by running them in order.

## Room to grow

The schema already anticipates: purchase orders, school credit cards,
automatic receipt matching, recurring purchases, return tracking, and
accounting exports. `purchase_orders.source` distinguishes `portal` / `email` /
`api` / `import`, so an automated feed can write alongside manual entry without
a migration. See [VENDOR_INTEGRATIONS.md](VENDOR_INTEGRATIONS.md) for the two
integrations worth building first.
