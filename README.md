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

The point is that one link is easier to remember than a spreadsheet, so the
spending record fills itself in as a side effect of ordering:

1. You type your name once — it's remembered on that device.
2. You tap the store you want. It opens in a new tab, and the portal quietly
   remembers where you went.
3. When you come back to the portal tab, it asks **"Back from Costco?"** and
   takes the total. Amount, what it was for, the date, and an optional note.
4. **Spending** shows everything — by person, by date, by amount, with
   this-month / last-month / all-time totals, a per-person breakdown, and a
   **Copy as spreadsheet** button that pastes straight into Sheets or Excel.

Details worth knowing:

- **Nothing gets missed.** If you close the tab before logging, the prompt is
  waiting the next time you open the portal (up to a week later). Bought
  something in a physical store, or over the phone? **Log a purchase from
  somewhere else** takes any store name.
- **What we need is right there.** The top of the Order tab shows the items
  the last inventory check flagged as low or out, so whoever is ordering
  doesn't have to switch apps. The inventory app's Shopping List links here
  with **Order these →**.
- **Mistakes are fixable, quietly.** A wrong amount can be **struck** — it
  stays in the list, crossed out, and drops out of the totals. Nothing is
  ever deleted, so the record can't silently change.
- **Works offline.** A purchase logged with no signal is saved on the device
  and sent when you're back online.

### Editing the store list

Supabase Dashboard → Table Editor → `order_sites`. Same rules as the item
catalog — no redeploy needed:

- **Add a store**: insert a row with `name`, `url`, and optionally `blurb`
  (the small line on the tile), `emoji`, `category`, `category_order` (order
  of the section) and `sort_order` (order within it).
- **Retire a store**: set `active` to `false`. Past purchases keep the name
  they were logged under either way.

The starting list is a guess at the useful ones — kosher grocery, delivery,
warehouse, general. Trim it to what's actually used; a shorter grid is a
faster one.

## Database

Everything lives in the Supabase project `aheiyytqvzxkoowykkgt`
(fschechter@lghschicago.org's Project):

| Table | Purpose |
| --- | --- |
| `inventory_items` | The item catalog: category, name, Food Program flag, ordering, `active` toggle |
| `inventory_checks` | One row per submitted check (who, when, video links, low/out counts) |
| `inventory_check_items` | Per-item status rows for each check (`ok` / `low` / `out`, qty when low) |
| `order_sites` | The store tiles on the portal: name, url, blurb, emoji, ordering, `active` toggle |
| `purchases` | One row per purchase: who, which store, amount, what for, date, notes, `voided` flag |

Row Level Security applies to the new tables the same way: the shipped key
can read both and insert a purchase, and nothing else. Corrections go
through `void_purchase()`, which marks a row rather than rewriting it.

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
rebuilt by running those four files in the SQL Editor, in order. Both seeds
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
