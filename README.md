# LGHS Dorm Inventory

Weekly dorm pantry inventory checks as an installable PWA. Tap through the
item list (everything defaults to OK), flag what's **low** or **out**, and
submit. The latest check becomes a copyable **Shopping List**, and every
submission is kept in **History** — all stored in Supabase.

It also replaces the Google Form counselors used to log dorm purchases: the
**Spending** tab is a short form (date, amount, category, optional
store/note, optional receipt photo) — no receipt scanning or AI, the photo
is just attached as proof — plus a running list of what's been logged.

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
3. The app appears at `https://fschechter-afk.github.io/inventory/`. Open it
   on a phone and "Add to Home Screen" to install it.

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
| `spending_categories` | The spending category list, dashboard-editable like the item catalog |
| `spending_entries` | One row per logged purchase (who, date, category, amount, vendor/note, receipt photo URL) |

Receipt photos go in the `receipts` Storage bucket (public — the URL is just
attached to the entry as proof, nothing reads or parses the image).

### Editing the item list

Supabase Dashboard → Table Editor → `inventory_items`:

- **Add an item**: insert a row with `category`, `name`, `category_order`
  (order of the category section) and `sort_order` (order within it).
- **Retire an item**: set `active` to `false` (don't delete — history keeps
  its name either way).
- **Rename**: edit `name`; past checks keep the name that was current when
  they were submitted.

### Editing spending categories

Supabase Dashboard → Table Editor → `spending_categories`: add a row, set
`active` to `false` to retire one (past entries keep their category name),
or edit `sort_order` to reorder the dropdown. Same no-redeploy pattern as
the item catalog.

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
