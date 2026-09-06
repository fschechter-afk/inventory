# Importing orders from the inbox

Every online order sends a confirmation email to **onlineorders@lghschicago.org**.
[`gmail-import.gs`](gmail-import.gs) reads those emails on a schedule and files
them in the portal, so an online order shows up in **Spending** without anyone
logging anything.

It runs as a Google Apps Script inside that mailbox's own Google account. No
new service, no server, nothing to pay for, and the mailbox's contents never
leave Google except for the four fields it files: store, total, date, order
number.

## Setting it up (about ten minutes, once)

1. **Sign in to Google as `onlineorders@lghschicago.org`.** The script reads
   mail through whichever account it belongs to, so it has to be this one.
   (See *If it isn't a real mailbox* below if that address only forwards.)
2. Go to **[script.google.com](https://script.google.com)** → **New project**.
   Name it something like *Portal order importer*.
3. Delete the sample code, paste in the whole of
   [`gmail-import.gs`](gmail-import.gs), and save.
4. In the function dropdown pick **`dryRun`** and press **Run**. Google will
   ask you to grant access — it needs to read Gmail and to make requests to
   the portal's database. Approve it. (Google shows an "unverified app"
   warning because the script is yours rather than a published add-on:
   **Advanced → Go to Portal order importer (unsafe)**.)
5. Look at the **Execution log**. You'll see one line per recent email with
   what the script made of it — store, total, order number. This writes
   nothing; it's just to confirm it's reading your mail correctly before it
   starts filing things.
6. Now pick **`importOrders`** and press **Run**. Open the portal's
   **Spending** tab — the orders it found should be there, tagged `auto`.
7. Set it to run by itself: the **clock icon** (Triggers) in the left
   sidebar → **Add trigger** → function `importOrders`, event source
   *Time-driven*, *Minutes timer*, *Every 15 minutes* → Save.

That's it. From then on, an online order appears in the portal by itself,
usually within fifteen minutes of the confirmation email arriving.

## What it does and doesn't import

- **Only the four online stores** listed at the top of the script: Amazon,
  Walmart, Sam's Club, WebstaurantStore. Add another by adding a line to
  `STORES` *and* a row in the portal's `order_sites` table.
- **Only confirmations.** Shipping notices, delivery updates, cancellations,
  refunds, review requests and marketing mail are filtered out — they quote
  the same total and would otherwise be counted twice.
- **One row per order, not per email.** The order number is the key, so a
  confirmation and the three "your package shipped" emails that follow it
  produce one purchase. If an email has no order number, the Gmail message id
  is used instead. Re-running the importer over the same mail changes
  nothing.
- **No name attached.** A shared mailbox doesn't say who placed the order, so
  imports arrive marked *no name yet*. Whoever ordered taps **that was me**
  in the Spending tab and it's theirs. Nobody can overwrite a purchase that
  already has a name.
- **Anything it can't read, it leaves alone** — unlabelled, so a later run
  picks it up if the script is improved. It never guesses a total.

In-store purchases (Jewel-Osco, Kol Tuv, Restaurant Depot, Aldi) have no
confirmation email, so those are still tapped into the portal by hand — the
in-store tiles go straight to the purchase form for exactly that.

## Checking on it

- Apps Script → **Executions** shows every run and what it logged.
- Run **`dryRun`** any time to see what it makes of recent mail without
  writing anything.
- To pause it, disable the trigger. To stop it entirely, delete the trigger.
  Nothing already imported is affected.

## If a total comes out wrong

The rules that find the total live in `findTotal` in the script, and in
`src/portal/receipt.js` for receipts pasted into the portal. The two are
deliberately the same; if you change one, change the other. A wrong amount
that already made it in can be **struck** from the portal — it stays visible,
crossed out, and drops out of the totals.

## If it isn't a real mailbox

This works when `onlineorders@lghschicago.org` is a Google account with an
actual inbox. If it's a **group or an alias** that only forwards to other
people, there's nothing for the script to read. Two ways round it:

- Make it a real Workspace account, keep the forwarding, and run the script
  there; or
- Run the script under whichever account the mail lands in, and narrow the
  search in `importOrders` to `to:onlineorders@lghschicago.org` so it only
  imports school orders and never personal ones.
