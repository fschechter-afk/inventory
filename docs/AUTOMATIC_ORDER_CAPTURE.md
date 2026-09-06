# Automatic order capture

Nobody types in what was ordered. Here is how the portal knows.

## The two halves

A purchase record needs seven things. No single source has all of them — but
two sources that both arrive automatically have all seven between them:

| | Who | Department | Purpose | Vendor | Order # | Total | Items |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Shopping session** (recorded when someone taps Shop) | ✅ | ✅ | ✅ | ✅ | | | |
| **Order confirmation email** | | | | ✅ | ✅ | ✅ | ✅* |

Match them on vendor and time and you have a complete record with zero typing.
The staff member's only action is the one they were already taking: tapping
**Shop** to pick a department before they buy.

\* Item detail depends on the vendor — see below.

## Online orders vs. walk-ins

Nobody prints an Amazon receipt, so the portal never asks for one. Each store
is marked `online`, `in_store` or `both`, and that decides what — if anything —
the staff member is asked to do:

| | Recorded from | Staff member does |
| --- | --- | --- |
| **Online** — Amazon, Walmart.com, Sam's Club online, WebstaurantStore | the vendor's confirmation email | nothing |
| **Walk-in** — Restaurant Depot, Sam's Club club, Costco, local grocers | the register receipt | photographs it |

## How the items get read

The first version of this had hand-written parsers per vendor. That only works
for formats somebody has actually looked at — and only until the vendor
redesigns its template. There were real Target and Walmart emails to work from
and none for Amazon, Sam's Club or WebstaurantStore, so writing regexes for
those three would have been guessing.

**The model reads the email body instead.** No per-vendor knowledge, nothing to
rewrite when a template changes, and it works the first time a vendor nobody
anticipated sends its first confirmation. The deterministic parsers survive as
a free fast path where they are proven; anything they cannot fully read goes to
the model.

### Your four common stores

| Store | Order in email | Items in email | Notes |
| --- | --- | --- | --- |
| **Amazon** | yes | yes | Confirmations list the items; the model reads them. [Amazon Business](https://developer-docs.amazon.com/amazon-business/docs/reporting-api-overview) also has a real order-reporting API if the school moves onto a Business account. |
| **WebstaurantStore** | yes | yes | Detailed confirmation per order. |
| **Sam's Club** | yes | yes | Online orders email a confirmation. Club walk-ins need the receipt photo. |
| **Walmart** | yes | **no** | Verified across all three of their email types — see below. |

### The Walmart exception, verified

Walmart's grocery emails were checked directly, not assumed:

| Email | Contains |
| --- | --- |
| "Thanks for your delivery order" | order #, date, total, card — **one item name**, "+15 items" behind a login |
| "Delivered: …" | `15 items arrived`, `Substituted`, `1 item unavailable`, bare quantities — **no names, no prices**; the items are image tiles |
| "Review your order updates" | substitution counts only |

There is no item text in any of them to read. For Walmart items the answer is
the **Walmart Business itemized export**: Purchase History → All Purchases →
Download → tick *itemized purchase history data for individual items in each
order* → CSV, org-wide for an admin
([docs](https://business.walmart.com/help/article/purchase-history/2da60627489141b998179eb048524de1)).
Walmart Business accounts are free, and this is the single highest-value
account change available.

Vendors are marked `items_in_email = false` when their email is known to
withhold the items, so the portal can say so rather than pretending.

## The pipeline

```
vendor sends confirmation
        ↓
orders@lghschicago.org        (Google Workspace mailbox)
        ↓                      integrations/gmail-order-watcher.gs
Apps Script, every 15 min      reads new mail, POSTs it
        ↓
Edge Function                  supabase/functions/ingest-order-email/
  ├─ dedupe on Message-ID      a retry can never create a second purchase
  ├─ is this an order?         shipping and marketing mail → 'ignored'
  ├─ parse                     vendor-specific, else generic
  ├─ match a shopping session  same vendor, within 12 hours, exactly one
  └─ create purchase + items   source = 'email'
        ↓
appears in the portal
```

Everything raw is kept in `inbound_emails`, so a parser improvement can be
re-run over past mail rather than the order being lost forever.

### Why Apps Script rather than an inbound-email provider

The school already has Google Workspace. Apps Script means no MX records, no
DNS changes, no third-party mail vendor, no monthly bill, and the mail never
leaves Google except to reach the school's own Supabase project.

## Matching, and when it declines to guess

A confident match is **exactly one** open shopping session for that vendor in
the last 12 hours. If two people shopped Amazon that morning, the email goes to
the unmatched queue instead of being attributed to a coin flip — a purchase
charged to the wrong department is worse than one that waits for a person.

Unmatched orders keep their parsed detail; an administrator assigns the person
and department in one step and the items come across with it.

## Setup

**1. Create the mailbox.** `orders@lghschicago.org` in Google Workspace.

**2. Set the ingestion secret.** Generate one, then in the Supabase dashboard →
Edge Functions → `ingest-order-email` → Secrets, add `INGEST_SECRET`. Until
this is set the function rejects everything with 401, which is the safe
default.

**3. Install the watcher.** Follow the header comment in
[`integrations/gmail-order-watcher.gs`](../integrations/gmail-order-watcher.gs).

**4. Point the vendors at it.** Per vendor, once — never per order:
- set that address as the account email on the school's vendor accounts, or
- add it as a notification address in the vendor account, or
- add a Gmail filter on a staff member's account that auto-forwards order
  confirmations there.

## The receipt photo, read automatically

Email cannot close two gaps: **Walmart grocery** (the order arrives, the items
do not) and **in-store purchases** at Restaurant Depot, Costco and Sam's Club,
which send no email at all. The receipt has every line item on it in both
cases, so the portal reads the photo.

Uploading a receipt calls the `extract-receipt` function, which sends the image
to Claude and gets back the merchant, order number, date, every line item with
quantity and unit price, subtotal, tax, total and payment method — then writes
them onto the purchase. The staff member's whole contribution is the photo.

Three rules keep it honest:

- **It only fills blanks.** A value a person typed always wins, and re-running
  extraction can never quietly rewrite a corrected total. Line items are
  written only when the purchase has none.
- **It never guesses.** The prompt says to return null for anything not
  printed, and the result is coerced and validated before it reaches the
  database — malformed items are dropped, and a result that read nothing at all
  is discarded rather than written as an empty purchase.
- **It says when it is unsure.** A `low` confidence reading tells the staff
  member to check the total rather than silently accepting it.

To switch it on, set `ANTHROPIC_API_KEY` as a secret on the `extract-receipt`
function. Without it the function returns 503, the app quietly falls back to
the manual fields, and nothing breaks.

## Testing the parsers

Real captured emails live in `tests/fixtures/`:

```bash
node scripts/test-parsers.mjs
```

Add a fixture whenever a vendor's format is examined for the first time — that
is what stops a parser from quietly regressing later.
