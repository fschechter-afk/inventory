# LGHS Dorm Inventory

Two installable PWAs sharing one Supabase project:

| | Where | What it does |
| --- | --- | --- |
| **Inventory** | `/inventory/` | Weekly pantry checks → shopping list |
| **Ordering Portal** | `/inventory/portal/` | Order from the stores, log what was spent |

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
3. The app appears at `https://fschechter-afk.github.io/inventory/`, and the
   ordering portal at `https://fschechter-afk.github.io/inventory/portal/`.
   Open either on a phone and "Add to Home Screen" to install it — they
   install as two separate icons.

> Until step 1 is done, the workflow's **build** job passes but **deploy**
> fails with `Failed to create deployment (status: 404) … Ensure GitHub Pages
> has been enabled`. That's expected — enabling Pages fixes it.

## The ordering portal (`/portal`)

**Share this one link with everyone who buys anything for the school:**
`https://fschechter-afk.github.io/inventory/portal/`

Most of it fills itself in. Online orders arrive on their own; in-store trips
take about ten seconds.

### Online orders — nobody logs anything

Every confirmation email goes to `onlineorders@lghschicago.org`, and a Google
Apps Script reads that inbox every fifteen minutes and files each order in the
portal: store, total, date, order number. Setup is a one-time ten minutes and
is written up in [`automation/`](automation/README.md).

A shared mailbox doesn't say *who* ordered — but the portal does. Tapping a
store tile records that you're heading there, and an arriving order looks for
its owner in three places before giving up:

1. **A purchase you already logged by hand** — same store, same amount, within
   three days. It attaches to that row rather than adding a second, so logging
   something manually never double-counts it.
2. **Whoever tapped that store recently.** Usually nobody has to do anything:
   you tap Sam's Club, order, and the confirmation arrives already in your
   name. If two people set off for the same store, it stays unassigned rather
   than crediting the wrong one.
3. **Failing both**, it arrives marked *no name yet* with an `auto` tag, and is
   claimed with one tap of **that was me** — or by pasting the order number
   into the box in the Spending tab, which finds it for you.

A purchase that already has a name can't be overwritten by any of these. One
order makes one row however many emails a store sends about it, because the
order number is the key.

The four online stores are Amazon, Walmart, Sam's Club and WebstaurantStore.

### In store — tap the shop, put in the total

Jewel-Osco, Kol Tuv, Restaurant Depot and Aldi have no confirmation email, so
their tiles skip the website and go straight to the purchase form with the
shop already filled in. Type the total and you're done. Anywhere else goes in
through **Log a purchase from somewhere else**.

### Ordering from the portal

Tapping an online store opens it in a new tab and quietly remembers where you
went; when you come back the portal asks **"Back from Amazon?"** and takes the
total. If you close the tab first, the prompt is still waiting next time you
open the portal, up to a week later. You never have to retype the amount:
**Paste receipt** reads the confirmation email off the clipboard and fills the
form in, and on an installed phone app you can share the email straight into
the portal from Mail or Gmail. What it read is shown before anything is saved,
and every field stays editable.

### Receiving — Michelle's tab

Nothing should be able to disappear between being ordered and being put away,
so every order carries a delivery location and a status through to unpacked.

**When you order**, the portal asks one question before opening the store:
**Dorm, School or Shul?** That's the whole extra cost of the feature, and it's
what Michelle checks against when something turns up.

**The Receiving tab** shows everything still owed a delivery or a check,
wherever it was going, **grouped by the day it's due** — overdue first, then
today, then ahead, then anything with no date. Issues sit at the top under
*Needs sorting out*, and the tab carries a count of what's outstanding.

Each order shows what it is, who ordered it, the vendor, where it's going,
when it's due, the items and quantities, and how far along it is:

    Ordered → Coming → Delivered → Unpacked

**Michelle's four marks** are on every order: *Not yet received*, *Received*,
*Received & unpacked*, and *Issue*. She can also **send an order to the right
place** — the location chips on each card set or correct it, for an order
nobody labelled or one that turned up somewhere else — and change the
expected date.

**Discrepancies**: tapping *Issue* takes a note ("Ordered 15 gallons of oil,
only 12 arrived") and, where item lines exist, how much of each actually came.
A short line is highlighted against what was ordered. Closing an issue keeps
the note on the record.

**Accountability**: every mark records who made it and when — received by,
unpacked by, flagged by, and who closed it out. None of it is deleted.

An expected delivery date is read out of the confirmation email where the
store gives one ("Arriving Thursday, September 10", "Estimated delivery
09/04"), including Amazon's bare weekday, resolved forward from the order
date. Shipping notices, which used to be discarded, now move an order along
to **Coming** instead of being ignored.

Items are optional — an order tracks without them. They're worth filling in
for anything countable, because they're what turns "15 gallons ordered" into
something checkable.

> One limit worth knowing: names in the portal are typed, not logged in.
> "Received by Michelle" means someone using the portal as Michelle marked it.
> That's the same trust model as the rest of the app, and fine for a dorm — but
> it isn't an audit trail that would survive someone deliberately lying.

### Spending

Everything by person, date and amount, with this-month / last-month /
all-time totals, a per-person breakdown, a filter by person, and **Copy as
spreadsheet** to paste into Sheets or Excel. A wrong amount can be **struck**
— it stays in the list, crossed out, and drops out of the totals. Nothing is
ever deleted.

The top of the Order tab also shows what the last inventory check flagged as
low or out, so whoever's ordering doesn't have to switch apps. The inventory
app's Shopping List links here with **Order these →**.

Purchases logged with no signal wait on the device and send when you're back
online.

### Editing the store list

Supabase Dashboard → Table Editor → `order_sites`. Same rules as the item
catalog — no redeploy needed:

- **Add a store**: insert a row with `name`, `url`, `kind` (`online` or
  `in_store`), and optionally `blurb`, `emoji`, `category`, `category_order`
  and `sort_order`. To have its emails imported too, also add it to `STORES`
  in [`automation/gmail-import.gs`](automation/gmail-import.gs).
- **Retire a store**: set `active` to `false`. Past purchases keep the name
  they were logged under either way. The stores that aren't in use — Costco,
  Instacart, Target, Staples, Home Depot, Mariano's, Hungarian Kosher — are
  already sitting there inactive, one toggle from coming back.

## Database

Everything lives in the Supabase project `aheiyytqvzxkoowykkgt`
(fschechter@lghschicago.org's Project):

| Table | Purpose |
| --- | --- |
| `inventory_items` | The item catalog: category, name, Food Program flag, ordering, `active` toggle |
| `inventory_checks` | One row per submitted check (who, when, video links, low/out counts) |
| `inventory_check_items` | Per-item status rows for each check (`ok` / `low` / `out`, qty when low) |
| `order_sites` | The store tiles on the portal: name, url, blurb, emoji, ordering, `active` toggle |
| `order_intents` | "I'm off to Sam's Club" — recorded when a tile is tapped, so an imported order can find its owner |
| `purchase_items` | What was on an order: item, quantity ordered, unit, and quantity actually received |
| `purchases` | One row per purchase: who, which store, amount, what for, date, notes, `voided` flag, and `source` (`portal` or `email`) with the `source_ref` that keeps imports from doubling up |

Row Level Security applies to the new tables the same way: the shipped key
can read both and insert a purchase, and nothing else. It holds no update or
delete permission at all — the three things that change a row go through
functions that each allow exactly one change: `void_purchase()` strikes a
purchase without erasing it, `claim_purchase()` and
`claim_purchase_by_order_number()` fill in a name only where there isn't one,
`import_purchase_from_email()` refuses to insert an order it has already seen,
and the receiving functions (`set_delivery_state()`, `resolve_delivery_issue()`,
`set_delivery_location()`, `set_expected_date()`, `set_received_quantities()`)
each make one specific change and stamp who made it.

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

The schema and the starting item and store lists are checked in under
[`supabase/migrations/`](supabase/migrations), so a fresh project can be
rebuilt by running those eleven files in the SQL Editor, in order. The seeds
are idempotent — re-running them won't duplicate or overwrite dashboard
edits. (They're already applied to the project above; the files are there so
the database can be rebuilt from scratch.)

## Notes

- The original prototype pointed at a separate Supabase project
  (`ndnedcpfllgvyyzboyfx`, named "inventory"), which is currently **paused**
  by Supabase's free-tier inactivity policy — that's why saving stopped
  working. Any old submissions are still in that project; restore it from
  the Supabase dashboard if you want to export them. This app uses the
  active project instead, which is kept awake by regular use.
- Free-tier Supabase projects pause after about a week with no traffic.
  Weekly inventory checks and portal orders both count as traffic, so normal
  use keeps it alive;
  if it ever pauses over a long break, restore it from the dashboard with
  one click.
