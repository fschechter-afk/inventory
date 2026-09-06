# LGHS

Two apps for Lubavitch Girls High School, sharing one Supabase project and one
deployment:

| App | Link | What it does |
| --- | --- | --- |
| **Shopping Portal** | `.../inventory/#/shop` | Every school purchase — who bought it, where, for which department and budget, was it approved, where is the receipt |
| **Dorm Inventory** | `.../inventory/` | Weekly dorm pantry checks and the shopping list they produce |

---

# LGHS Shopping Portal

One link every staff member starts from when they buy something for the school.
Choose a department, pick a store, say what it's for, tap **Shop** — the vendor
opens and the purchase gets tracked.

- **Four taps to shop.** Department, store, purpose, go. The department is
  pre-selected from the person's home department.
- **Orders record themselves.** Tapping Shop captures who, which budget and
  what for; the vendor's confirmation email supplies the order number, total
  and — for most vendors — every line item. The portal matches the two and
  writes the purchase with no typing at all. See
  [docs/AUTOMATIC_ORDER_CAPTURE.md](docs/AUTOMATIC_ORDER_CAPTURE.md).
- **Receipts are a photo, not a project.** The uploader opens the camera, and
  saving a new order stays on the receipt step instead of closing.
- **Approvals are enforced in the database.** Anything over the limit (default
  $250, adjustable per person) waits for a department manager. An employee
  cannot approve their own purchase.
- **Budgets are visible where they matter** — the remaining balance shows on the
  Shop screen before someone spends, not in a report afterwards.
- **Administrators get the bookkeeping view**: spending by day/week/month/year,
  by department, store and person; search and filter across everything; eight
  reports, all exportable to Excel.
- **Four roles** — employee, department manager, administrator, super admin —
  enforced by Row Level Security, so an employee's browser genuinely cannot
  fetch someone else's purchases.

- **A running record of every item.** The Items tab rolls every line item up by
  name: how often it is bought, what it cost last time, and which store has
  been cheapest for it.

**Setup, roles, approvals, budgets and reports:
[docs/SHOPPING_PORTAL.md](docs/SHOPPING_PORTAL.md).** Three one-time steps are
needed before staff can sign in.

**Automatic order capture:
[docs/AUTOMATIC_ORDER_CAPTURE.md](docs/AUTOMATIC_ORDER_CAPTURE.md)** — what each
vendor's email actually contains, and how to switch the pipeline on.

---

# LGHS Dorm Inventory

Weekly dorm pantry inventory checks as an installable PWA. Tap through the
item list (everything defaults to OK), flag what's **low** or **out**, and
submit. The latest check becomes a copyable **Shopping List**, and every
submission is kept in **History** — all stored in Supabase.

This replaces the original single-file `lghsinventory_2.html` prototype with
a structure that's maintainable and doesn't silently break:

- **Item list lives in the database**, not in the code. Add, rename, retire,
  or reorder items from the Supabase Table Editor — no redeploy needed.
- **Supabase JS is bundled at build time** — no CDN `<script>` tag to fail on
  filtered school networks.
- **Real schema with Row Level Security**: the key shipped in the app can
  read the catalog + past checks and submit new checks, but can never edit
  or delete anything. Submissions are atomic (one database function writes
  the check and all its item rows in a single transaction).
- **Works offline**: the app shell and item list are cached; a check
  submitted without a connection is saved on the device and sent
  automatically when back online.
- **Deploys itself**: pushing to this repo builds and publishes to GitHub
  Pages via Actions.

## Run it

```bash
npm install
npm run dev        # local development
npm run build      # production build in dist/
```

## Deploy (one-time setup)

1. In this repo on GitHub: **Settings → Pages → Source: GitHub Actions**.
2. Re-run the *Deploy to GitHub Pages* workflow (Actions tab → latest run →
   **Re-run all jobs**), or just push again.
3. The apps appear at `https://fschechter-afk.github.io/inventory/` (dorm
   inventory) and `https://fschechter-afk.github.io/inventory/#/shop`
   (Shopping Portal). Open either on a phone and "Add to Home Screen" to
   install it.

> Until step 1 is done, the workflow's **build** job passes but **deploy**
> fails with `Failed to create deployment (status: 404) … Ensure GitHub Pages
> has been enabled`. That's expected — enabling Pages fixes it.

## Database

Everything lives in the Supabase project `aheiyytqvzxkoowykkgt`
(fschechter@lghschicago.org's Project):

| Table | Purpose |
| --- | --- |
| `inventory_items` | The item catalog: category, name, Food Program flag, ordering, `active` toggle |
| `inventory_checks` | One row per submitted check (who, when, video links, low/out counts) |
| `inventory_check_items` | Per-item status rows for each check (`ok` / `low` / `out`, qty when low) |

The Shopping Portal's tables live in the same project; they are listed in
[docs/SHOPPING_PORTAL.md](docs/SHOPPING_PORTAL.md#data-model). The project is
also shared with the dorm chat app, so table and function names added here are
prefixed or namespaced to avoid collisions.

### Editing the item list

Supabase Dashboard → Table Editor → `inventory_items`:

- **Add an item**: insert a row with `category`, `name`, `category_order`
  (order of the category section) and `sort_order` (order within it).
- **Retire an item**: set `active` to `false` (don't delete — history keeps
  its name either way).
- **Rename**: edit `name`; past checks keep the name that was current when
  they were submitted.

### Changing the Supabase project

`src/config.js` holds the URL and publishable key (overridable with
`VITE_SUPABASE_URL` / `VITE_SUPABASE_KEY` at build time).

The schema and the starting item list are checked in under
[`supabase/migrations/`](supabase/migrations), so a fresh project can be
rebuilt by running those two files in the SQL Editor, in order. The seed is
idempotent — re-running it won't duplicate or overwrite dashboard edits.

## Notes

- The original prototype pointed at a separate Supabase project
  (`ndnedcpfllgvyyzboyfx`, named "inventory"), which is currently **paused**
  by Supabase's free-tier inactivity policy — that's why saving stopped
  working. Any old submissions are still in that project; restore it from
  the Supabase dashboard if you want to export them. This app uses the
  active project instead, which is kept awake by regular use.
- Free-tier Supabase projects pause after about a week with no traffic.
  Weekly inventory checks count as traffic, so normal use keeps it alive;
  if it ever pauses over a long break, restore it from the dashboard with
  one click.
