// Run with: npm test
import { parseReceipt } from './receipt.js'

const SITES = [
  { id: 's1', name: 'Kol Tuv Kosher Foods', url: 'https://shop.koltuvkosher.com/' },
  { id: 's2', name: 'Hungarian Kosher Foods', url: 'https://www.hungariankosher.com/' },
  { id: 's3', name: 'Instacart', url: 'https://www.instacart.com/' },
  { id: 's4', name: 'Jewel-Osco', url: 'https://www.jewelosco.com/' },
  { id: 's5', name: 'Costco', url: 'https://www.costco.com/' },
  { id: 's6', name: "Sam's Club", url: 'https://www.samsclub.com/' },
  { id: 's7', name: 'Restaurant Depot', url: 'https://www.restaurantdepot.com/' },
  { id: 's8', name: 'Amazon', url: 'https://www.amazon.com/' },
  { id: 's11', name: 'Walmart', url: 'https://www.walmart.com/' },
  { id: 's12', name: 'WebstaurantStore', url: 'https://www.webstaurantstore.com/' },
  { id: 's13', name: 'Aldi', url: 'https://www.aldi.us/' },
  { id: 's9', name: 'Target', url: 'https://www.target.com/' },
  { id: 's10', name: 'Home Depot', url: 'https://www.homedepot.com/' },
]

const CASES = [
  {
    name: 'Amazon: order date and a separate "Arriving" date',
    text: `Amazon.com order confirmation
Order Placed: September 2, 2026
Order # 114-000
Arriving: Thursday, September 10, 2026
Grand Total: $56.09`,
    want: { siteName: 'Amazon', amount: 56.09, purchasedOn: '2026-09-02', expectedOn: '2026-09-10' },
  },
  {
    name: 'Amazon: bare weekday resolves forward from the order date',
    text: `Amazon order placed September 2, 2026
Order # 114-001
Arriving Thursday
Order Total: $22.00`,
    // 2 Sep 2026 is a Wednesday, so Thursday is the 3rd
    want: { purchasedOn: '2026-09-02', expectedOn: '2026-09-03' },
  },
  {
    name: 'Walmart: estimated delivery',
    text: `Walmart
Thanks for your order! Order # 200-1
Order date 09/01/2026
Estimated delivery: 09/04/2026
Order total $63.12`,
    want: { siteName: 'Walmart', purchasedOn: '2026-09-01', expectedOn: '2026-09-04' },
  },
  {
    name: 'no arrival wording at all leaves it blank rather than guessing',
    text: `Costco
Order Date 08/28/2026
Order Total $212.40`,
    want: { purchasedOn: '2026-08-28', expectedOn: null },
  },
  {
    name: 'arrival date is not mistaken for the order date',
    text: `Sam's Club
Order #77
Arriving Sep 12, 2026
Order Total: $40.00`,
    want: { expectedOn: '2026-09-12' },
  },
  {
    name: 'Amazon confirmation',
    text: `From: "Amazon.com" <auto-confirm@amazon.com>
Subject: Your Amazon.com order of "Bounty Paper Towels, 12..."

Hello Faige,
Thank you for shopping with us. Order Placed: September 2, 2026
Order # 114-2537011-3234609

Items Ordered  Price
2 of: Bounty Select-A-Size Paper Towels    $32.99
1 of: Hefty Party Cups, 200 count           $18.47

Item(s) Subtotal: $51.46
Shipping & Handling: $0.00
Total before tax: $51.46
Estimated tax to be collected: $4.63
Grand Total: $56.09`,
    want: { siteName: 'Amazon', amount: 56.09, purchasedOn: '2026-09-02', orderNumber: '114-2537011-3234609' },
  },
  {
    name: 'Costco, label on line above the amount',
    text: `Costco Wholesale
Your order has been received

Order Number
1234567890

Order Date
08/28/2026

Subtotal
$198.40
Tax
$14.00
Order Total
$212.40`,
    want: { siteName: 'Costco', amount: 212.4, purchasedOn: '2026-08-28', orderNumber: '1234567890' },
  },
  {
    name: 'Instacart, chatty wording',
    text: `Your Instacart order from Jewel-Osco was delivered on Sep 3, 2026.
You saved $12.40 with your membership.
Subtotal $71.18
Service fee $5.34
Tip $8.00
Total charged to your card ending in 4412: $84.52`,
    want: { amount: 84.52, purchasedOn: '2026-09-03' },
  },
  {
    name: 'Kol Tuv, plain text',
    text: `Kol Tuv Kosher Foods — order confirmation
shop.koltuvkosher.com
Order #KT-88213 placed on 2026-09-01
Items: 14
Order Total: $347.86`,
    want: { siteName: 'Kol Tuv Kosher Foods', amount: 347.86, purchasedOn: '2026-09-01', orderNumber: 'KT-88213' },
  },
  {
    name: "Sam's Club with apostrophe + comma thousands",
    text: `Sam's Club
Thanks for your order!
Order date: 8/15/2026
Subtotal: $1,180.22
Order total: $1,284.77`,
    want: { siteName: "Sam's Club", amount: 1284.77, purchasedOn: '2026-08-15' },
  },
  {
    name: 'Home Depot, "Total" only',
    text: `THE HOME DEPOT
Order confirmation for homedepot.com
Placed on September 4, 2026
Total $63.12`,
    want: { siteName: 'Home Depot', amount: 63.12, purchasedOn: '2026-09-04' },
  },
  {
    name: 'Restaurant Depot, two-word store name',
    text: `Restaurant Depot invoice
Invoice date 09/03/2026
Invoice Total: $902.15`,
    want: { siteName: 'Restaurant Depot', amount: 902.15, purchasedOn: '2026-09-03' },
  },
  {
    name: 'unknown store — leaves the store blank rather than guessing',
    text: `Bob's Hardware
Receipt 9/2/2026
Total: $19.99`,
    want: { siteName: null, amount: 19.99, purchasedOn: '2026-09-02' },
  },
  {
    name: 'future date gets clamped to today',
    text: `Amazon order placed January 4, 2099
Order Total: $10.00`,
    want: { siteName: 'Amazon', amount: 10.0, purchasedOn: new Date().toISOString().slice(0, 10) },
  },
  {
    name: 'no total at all — amount left null',
    text: `Amazon: your package is arriving today. Nothing else here.`,
    want: { siteName: 'Amazon', amount: null },
  },
  {
    name: 'empty paste',
    text: '   ',
    want: { amount: undefined },
  },
]

let pass = 0, fail = 0
for (const c of CASES) {
  const got = parseReceipt(c.text, SITES)
  const bad = []
  for (const [k, v] of Object.entries(c.want)) {
    if (got[k] !== v) bad.push(`${k}: got ${JSON.stringify(got[k])}, want ${JSON.stringify(v)}`)
  }
  if (bad.length) { fail++; console.log(`FAIL  ${c.name}\n      ${bad.join('\n      ')}`) }
  else { pass++; console.log(`ok    ${c.name}  ->  ${got.found ? got.found.join(' · ') : ''}`) }
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
