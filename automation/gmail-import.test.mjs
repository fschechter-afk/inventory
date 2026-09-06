// Run with: npm test
// Loads the Apps Script in a sandbox so its parsing runs for real here.
import fs from 'node:fs'
import vm from 'node:vm'

const src = fs.readFileSync(new URL('./gmail-import.gs', import.meta.url), 'utf8')
const ctx = {
  Logger: { log: () => {} },
  Session: { getScriptTimeZone: () => 'America/Chicago' },
  Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
  GmailApp: {}, UrlFetchApp: {},
}
vm.createContext(ctx)
vm.runInContext(src, ctx)

const CONFIRMATION = /order\s*(confirmation|receipt|placed|summary|#|number)|thanks?\s+(you\s+)?for\s+your\s+order|your\s+order|we\s+received\s+your\s+order/i

const CASES = [
  {
    name: 'Amazon confirmation',
    from: '"Amazon.com" <auto-confirm@amazon.com>',
    subject: 'Your Amazon.com order of "Bounty Paper Towels"',
    body: `Order Placed: September 2, 2026
Order # 114-2537011-3234609
Item(s) Subtotal: $51.46
Shipping & Handling: $0.00
Total before tax: $51.46
Estimated tax to be collected: $4.63
Grand Total: $56.09`,
    want: { store: 'Amazon', total: 56.09, order: '114-2537011-3234609', gate: true },
  },
  {
    name: 'Walmart confirmation',
    from: 'Walmart <help@walmart.com>',
    subject: 'Thanks for your order!',
    body: `We received your order.
Order # 200012345678901
Subtotal $58.21
Shipping $0.00
Tax $4.91
Order total $63.12`,
    want: { store: 'Walmart', total: 63.12, order: '200012345678901', gate: true },
  },
  {
    name: "Sam's Club, thousands + label on line above",
    from: "Sam's Club <orders@samsclub.com>",
    subject: 'Your Sam\'s Club order confirmation',
    body: `Order Number
9988776655
Subtotal
$1,180.22
Order Total
$1,284.77`,
    want: { store: "Sam's Club", total: 1284.77, order: '9988776655', gate: true },
  },
  {
    name: 'WebstaurantStore invoice',
    from: 'WebstaurantStore <noreply@webstaurantstore.com>',
    subject: 'Order Confirmation #WS-4471902',
    body: `Thank you for your order.
Merchandise Subtotal: $402.10
Shipping: $89.99
Order Total: $492.09`,
    want: { store: 'WebstaurantStore', total: 492.09, gate: true },
  },
  {
    name: 'Amazon SHIPPING notice — same order, must not become a second row',
    from: '"Amazon.com" <shipment-tracking@amazon.com>',
    subject: 'Shipped: "Bounty Paper Towels"',
    body: `Your package is on the way.
Order # 114-2537011-3234609
Order Total: $56.09`,
    // the query excludes it, and even if seen the order number dedupes it
    want: { store: 'Amazon', total: 56.09, order: '114-2537011-3234609', gate: true },
    note: 'same source_ref as the confirmation -> import_purchase_from_email returns null',
  },
  {
    name: 'Amazon marketing mail — gate rejects it',
    from: '"Amazon.com" <store-news@amazon.com>',
    subject: 'Deals of the day: up to 40% off',
    body: `Save big today. Paper towels from $12.99. Shop now.`,
    want: { gate: false },
  },
  {
    name: 'sender wins over a store mentioned in the body',
    from: 'Walmart <help@walmart.com>',
    subject: 'Your order',
    body: `Price matched against Amazon.
Order total: $19.99`,
    want: { store: 'Walmart', total: 19.99, gate: true },
  },
]

let pass = 0, fail = 0
for (const c of CASES) {
  const text = c.subject + '\n' + c.from + '\n' + c.body
  const store = ctx.matchStore(c.from, text)
  const got = {
    store: store ? store.name : null,
    total: ctx.findTotal(c.body),
    order: ctx.findOrderNumber(text),
    gate: CONFIRMATION.test(c.subject + '\n' + c.body),
  }
  const bad = []
  for (const [k, v] of Object.entries(c.want)) {
    if (got[k] !== v) bad.push(`${k}: got ${JSON.stringify(got[k])}, want ${JSON.stringify(v)}`)
  }
  if (bad.length) { fail++; console.log(`FAIL  ${c.name}\n      ${bad.join('\n      ')}`) }
  else console.log(`ok    ${c.name}${c.note ? '  (' + c.note + ')' : ''}`), pass++
}

// dedupe key behaviour
const key = (store, order, id) => (order ? store + '#' + order : 'gmail:' + id)
const a = key('Amazon', '114-2537011-3234609', 'msg1')
const b = key('Amazon', '114-2537011-3234609', 'msg2')
a === b ? (pass++, console.log('ok    confirmation and shipping email produce the same key: ' + a))
        : (fail++, console.log('FAIL  dedupe key differs: ' + a + ' vs ' + b))
const c1 = key('Amazon', null, 'msgA'), c2 = key('Amazon', null, 'msgB')
c1 !== c2 ? (pass++, console.log('ok    two unnumbered receipts stay distinct')) : (fail++, console.log('FAIL  unnumbered collide'))

console.log(`\n${pass} passed, ${fail} failed`)
process.exitCode = fail ? 1 : 0
