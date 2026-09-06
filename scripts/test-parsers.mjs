// Parser tests against real vendor emails captured in tests/fixtures/.
// Run with: node scripts/test-parsers.mjs
import { readFileSync } from 'node:fs'
import { parseOrderEmail, parseMoney, parseDate } from '../supabase/functions/ingest-order-email/parse-order-email.js'

let failures = 0
const fixture = (name) => readFileSync(new URL(`../tests/fixtures/${name}`, import.meta.url), 'utf8')

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures++
    console.log(`  ✗ ${label}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`)
  } else {
    console.log(`  ✓ ${label}`)
  }
}

console.log('\nparseMoney / parseDate')
check('money with comma', parseMoney('$1,234.56'), 1234.56)
check('money absent is null, not zero', parseMoney(''), null)
check('money from "Free"', parseMoney('Free'), null)
check('named date', parseDate('April 30, 2026'), '2026-04-30')
check('abbreviated date with weekday', parseDate('Tue, Sep 1, 2026'), '2026-09-01')
check('numeric date', parseDate('09/02/2026'), '2026-09-02')

console.log('\nTarget — real confirmation email')
{
  const r = parseOrderEmail({
    from: 'orders@oe1.target.com',
    subject: "Thanks for shopping with us! Here's your order #:902003420031683.",
    body: fixture('target-order-confirmation.txt'),
  })
  check('vendor', r.vendor, 'Target')
  check('order number', r.orderNumber, '902003420031683')
  check('order date', r.orderedOn, '2026-04-30')
  check('subtotal', r.subtotal, 60)
  check('shipping (Free -> 0)', r.shipping, 0)
  check('tax', r.tax, 6.15)
  check('total', r.total, 66.15)
  check('payment method', r.paymentMethod, 'Visa ending 1442')
  check('item count', r.items.length, 1)
  check('item name', r.items[0].name, "Boys' Stretch Skinny Fit Jeans - Cat & Jack™ Black Wash 16: Adjustable Waistband, Mid Rise Denim")
  check('item quantity', r.items[0].quantity, 4)
  check('item unit price', r.items[0].unit_price, 15)
  check('line items reconcile with subtotal', r.subtotalAgrees, true)
  check('items complete', r.itemsComplete, true)
  check('confidence', r.confidence, 'high')
  check('no model extraction needed', r.needsExtraction, false)
  check('marketing "Perfect pairings" prices not picked up as items', r.items.length, 1)
}

console.log('\nWalmart — real grocery confirmation (items withheld by the vendor)')
{
  const r = parseOrderEmail({
    from: 'help@walmart.com',
    subject: 'Thanks for your delivery order, Menachem',
    body: fixture('walmart-order-confirmation.txt'),
  })
  check('vendor', r.vendor, 'Walmart')
  check('order number', r.orderNumber, '2000152-87275995')
  check('order date', r.orderedOn, '2026-09-01')
  check('total', r.total, 40.61)
  check('payment method', r.paymentMethod, 'Card ending 1001')
  check('items absent', r.items.length, 0)
  check('knows the vendor said 16 items', r.declaredItemCount, 16)
  check('flagged incomplete', r.itemsComplete, false)
  check('asks for extraction', r.needsExtraction, true)
  check('confidence partial', r.confidence, 'partial')
}

console.log('\nUnknown vendor — generic fallback')
{
  const r = parseOrderEmail({
    from: 'orders@webstaurantstore.com',
    subject: 'Your WebstaurantStore order',
    body: fixture('generic-order-confirmation.txt'),
  })
  check('vendor detected from sender', r.vendor, 'WebstaurantStore')
  check('used the generic parser', r.parser, 'generic')
  check('order number', r.orderNumber, 'WS-4471902')
  check('order date', r.orderedOn, '2026-09-02')
  check('subtotal', r.subtotal, 412.8)
  check('shipping', r.shipping, 38.25)
  check('total', r.total, 451.05)
  check('still reconcilable', r.confidence, 'partial')
}

console.log('\nJunk input does not throw or invent data')
{
  const r = parseOrderEmail({ from: 'noreply@newsletter.test', subject: 'Weekly deals', body: 'Shop now!' })
  check('no order number', r.orderNumber, null)
  check('no total', r.total, null)
  check('confidence none', r.confidence, 'none')
  check('no items', r.items.length, 0)
}
check('empty input is safe', parseOrderEmail().confidence, 'none')

console.log(failures ? `\n${failures} FAILED\n` : '\nAll parser tests passed\n')
process.exit(failures ? 1 : 0)
