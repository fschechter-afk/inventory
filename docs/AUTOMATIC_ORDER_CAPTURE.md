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

## What the vendors actually send

Checked against real confirmation emails, not assumptions:

**Target — everything.** A real confirmation contains the full item name,
quantity, unit price, subtotal, delivery, tax, total, order number, date and
the card's last four:

```
Order #902003420031683 · Placed April 30, 2026
Boys' Stretch Skinny Fit Jeans - Cat & Jack™ Black Wash 16
  Qty: 4 · $15.00 / ea
Subtotal (4 items) $60.00 · Delivery Free · Estimated taxes $6.15
Total $66.15 · Visa *1442
```

**Walmart grocery — order but not items.** Their app-style email gives order
number, date, total and card, but names only the first item: *"Kellogg's Corn
Flakes… + 15 items"*, with the rest behind a login. The order is captured; the
items have to come from the receipt.

**Everything else — generic parse.** Order number, date, subtotal, shipping,
tax and total follow conventional wording almost everywhere, so an unknown
vendor still produces a real, reconcilable record.

Deterministic parsers are written only for formats that have actually been
examined. Guessing at a vendor's layout produces a parser that fails silently,
which is worse than admitting the email is unknown.

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

## Where receipts still matter

Two gaps email cannot close:

- **Walmart grocery and similar** — the order arrives, the items do not.
- **In-store purchases** — Restaurant Depot, Costco and Sam's Club send no
  email at all; the register receipt is the only record.

The receipt photo has every line item on it in both cases, so running
extraction over receipt images is the remaining piece of full item coverage —
and the only path that works for the cash-and-carry vendors. The schema is
ready for it: `purchase_orders.source` already distinguishes `portal` /
`email` / `api` / `import`, and receipts are already attached to purchases.

## Testing the parsers

Real captured emails live in `tests/fixtures/`:

```bash
node scripts/test-parsers.mjs
```

Add a fixture whenever a vendor's format is examined for the first time — that
is what stops a parser from quietly regressing later.
