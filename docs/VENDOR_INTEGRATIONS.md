# Getting order data out of vendors

The single most important technical question for this portal is: **when a staff
member buys something at Amazon or Restaurant Depot, how does that purchase get
into our database?**

The honest answer for most vendors is *it doesn't, automatically*. This
document records what each vendor actually offers, so nobody spends a month
building an integration that was never possible.

**The short version:** almost no consumer retailer lets a *buyer* pull their own
order history through an API. Seller-side APIs are plentiful and irrelevant to
us. The paths that do work are (1) a business account with a reporting API —
essentially only Amazon Business, (2) a business account with a dashboard export,
and (3) forwarding the order-confirmation email. Everything else is a person
typing in an order number and photographing a receipt, which the portal makes as
fast as possible.

## What the portal captures regardless

Even with zero vendor cooperation, tapping **Shop** records a *shopping session*
before the vendor site opens: who is shopping, which department's budget they
picked, what it's for, and when. That row exists whether or not the person ever
comes back to record the order, which is what makes the "you started at Amazon
two hours ago — record it?" nudge possible. It is also, on its own, more
tracking than the school has today.

## Per-vendor findings

`integration` in the `order_sites` table records the best available path. It
describes what the vendor offers, not what is wired up yet.

| Vendor | Path | What is actually available |
| --- | --- | --- |
| **Amazon** | `api` | **The one real integration.** [Amazon Business Reporting API](https://developer-docs.amazon.com/amazon-business/docs/reporting-api-overview) exposes `getOrderReports` over the last year of orders, with totals, status and tracking. Amazon Business also has [six built-in order fields](https://business.amazon.com/en/learn/business-order-info) — Cost Center, Department Code, GL Code, Location Code, Account Number, Project Code — plus 13 custom ones, which map directly onto this portal's departments. **Requires an Amazon Business account.** Consumer `amazon.com` has no buyer order API at all. |
| **Walmart** | `export` | Walmart's [developer APIs](https://developer.walmart.com/us-marketplace/docs/order-management-api-overview) are all seller-side — Marketplace and Supplier — and expose nothing about a buyer's own orders. Walmart Business accounts show order history and spend reporting in the web dashboard, which an administrator can export. |
| **Instacart** | `export` | [Instacart Business](https://www.instacart.com/business) supports bulk receipt export (PDF + CSV) and *scheduled automated report emails* to an admin — the closest thing to automation outside Amazon. [Instacart Connect](https://docs.instacart.com/connect/) is for building a storefront, not for reading your own orders. |
| **Staples** | `export` | Staples Business Advantage accounts provide order history and spend reporting for administrators. Consumer staples.com does not. No public buyer API either way. |
| **Costco** | `manual` | No buyer order API and [no cXML punchout](https://punchoutcatalogs.com/). Online orders appear in the account; warehouse purchases exist only on the paper receipt. |
| **Sam's Club** | `manual` | Same as Costco — no buyer API, no punchout. Club receipts are in the Sam's Club app, which is the fastest way to photograph one. |
| **Restaurant Depot** | `manual` | Cash-and-carry, no online ordering, no API. The register receipt is the only record — which is why the portal tells staff to photograph it before leaving the lot. |
| **WebstaurantStore** | `email` | No buyer API, but sends a detailed order-confirmation email per order — a good candidate for the forwarding pipeline below. |
| **Target** | `email` | Public APIs are partner/seller-side. Confirmation emails and in-app receipts are the practical record. |
| **Home Depot** | `email` | No buyer API. Pro Xtra accounts keep a searchable purchase history and email receipts. |
| **Jewel-Osco, Mariano's, Kol Tuv, Hungarian Kosher** | `manual` | Local and regional grocers. Receipts only. |

### A note on scraping

Logging into a vendor's site as the user and scraping order history is
technically possible and a bad idea: it violates the terms of service of every
vendor above, breaks whenever the site changes, and would require the school to
store staff members' retail passwords. The portal does not do this and should
not.

## Recommended next integrations, in order of payoff

### 1. Amazon Business (highest value, genuinely automatic)

If the school moves its Amazon buying to an Amazon Business account:

- Set each staff member's default **Department Code** to their portal
  department, so the two systems agree without anyone retyping anything.
- Register for the Reporting API, then run a scheduled job (a Supabase Edge
  Function on a cron, or a Google Apps Script) that calls `getOrderReports`
  nightly and upserts rows into `purchase_orders` with `source = 'api'`,
  matching on `order_number`.
- The schema is already shaped for this: `source`, `order_number`,
  `vendor_id` and `purchase_order_items` all exist, and `reference` stays
  unique per row.

### 2. Receipt forwarding (works for every vendor that emails a confirmation)

This is the highest-coverage option and does not need vendor cooperation:

1. Create an address like `receipts@lghschicago.org`.
2. Point it at an inbound-email webhook.
3. The webhook posts to a Supabase Edge Function that stores the raw message,
   attaches the PDF/HTML to Storage, and tries to match it to an existing
   `purchase_orders` row by order number, then by vendor + amount + date.
4. Unmatched messages become a small "unmatched receipts" queue for an
   administrator.

Staff then just forward the confirmation email — no typing. Add
`source = 'email'` rows and the rest of the portal works unchanged.

### 3. Business-account exports (Walmart, Instacart, Staples)

Lower effort, lower payoff: an administrator downloads the monthly CSV and
imports it. Worth building an importer once the volume justifies it; the
`source = 'import'` value exists for exactly this.

## What this means for the design

Because automatic capture is the exception, the portal is built so the *manual*
path is fast enough that people actually use it:

- The order form pre-fills department, vendor and purpose from the shopping
  session, so recording an order is an order number, a total, and a photo.
- The receipt uploader opens the phone camera directly.
- Saving a new order keeps the form open on the receipt step, because "I'll
  add the receipt later" is how receipts go missing.
- Orders with no receipt are flagged on the employee's own list, on the
  dashboard, and in a dedicated report — so chasing them is somebody's visible
  job rather than an archaeology project at year end.

## Sources

- [Amazon Business Reporting API overview](https://developer-docs.amazon.com/amazon-business/docs/reporting-api-overview)
- [Retrieving order reports (Amazon Business)](https://docs.business.amazon.com/docs/retrieving-order-reports)
- [Business Order Info — Amazon Business](https://business.amazon.com/en/learn/business-order-info)
- [Walmart Orders Management API overview](https://developer.walmart.com/us-marketplace/docs/order-management-api-overview)
- [Introduction to Walmart Marketplace APIs](https://developer.walmart.com/us-marketplace/docs/introduction-to-marketplace-apis)
- [Instacart Business](https://www.instacart.com/business)
- [Instacart Business — manage business orders](https://www.instacart.com/help/section/3375565582/3216676979)
- [Instacart Connect APIs](https://docs.instacart.com/connect/)
- [Punchout Catalogs — which suppliers support punchout](https://punchoutcatalogs.com/)
- [cXML PunchOut explained (TradeCentric)](https://tradecentric.com/blog/cxml-punchout/)
