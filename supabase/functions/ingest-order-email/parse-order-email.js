// Extracting an order from a vendor's confirmation email.
//
// Plain ESM with no dependencies so the same file runs in Deno (the Edge
// Function) and in Node (the tests in scripts/test-parsers.mjs, which run
// against real captured emails in tests/fixtures/).
//
// Deterministic parsers exist only for vendors whose real email format has
// been examined. Everything else falls back to a generic pass that still
// recovers the order number and total — and, when an extraction model is
// configured, to the model. Guessing at a format nobody has looked at
// produces parsers that fail silently, which is worse than admitting the
// email is unknown.

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

/** "$1,234.56" -> 1234.56. Returns null rather than 0 for absent values, so a
 *  missing tax line is never silently recorded as zero tax. */
export function parseMoney(text) {
  if (text == null) return null
  const cleaned = String(text).replace(/[^0-9.,-]/g, '').replace(/,/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const value = Number.parseFloat(cleaned)
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
}

/** "April 30, 2026" / "Tue, Sep 1, 2026" / "09/01/2026" -> "2026-04-30". */
export function parseDate(text) {
  if (!text) return null
  const named = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(text)
  if (named) {
    const month = MONTHS[named[1].slice(0, 3).toLowerCase()]
    if (month) {
      return `${named[3]}-${String(month).padStart(2, '0')}-${String(named[2]).padStart(2, '0')}`
    }
  }
  const numeric = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text)
  if (numeric) {
    return `${numeric[3]}-${numeric[1].padStart(2, '0')}-${numeric[2].padStart(2, '0')}`
  }
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text)
  return iso ? iso[0] : null
}

/** Strip tracking URLs and collapse the whitespace padding that marketing
 *  templates use, without destroying the line breaks the parsers key off. */
export function normalize(body) {
  return String(body || '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/&#8199;|&#847;|&zwnj;|&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
}

export function detectVendor(from = '', subject = '', body = '') {
  const haystack = `${from} ${subject}`.toLowerCase()
  if (/target\.com/.test(haystack)) return 'Target'
  if (/walmart\.com/.test(haystack)) return 'Walmart'
  if (/amazon\.(com|co)/.test(haystack)) return 'Amazon'
  if (/webstaurantstore/.test(haystack)) return 'WebstaurantStore'
  if (/instacart/.test(haystack)) return 'Instacart'
  if (/homedepot/.test(haystack)) return 'Home Depot'
  if (/samsclub/.test(haystack)) return "Sam's Club"
  if (/costco/.test(haystack)) return 'Costco'
  if (/staples/.test(haystack)) return 'Staples'
  // Fall back to the sending domain, minus the mail-service subdomain noise.
  const domain = /@([\w.-]+)/.exec(from)?.[1] || ''
  const root = domain.split('.').slice(-2, -1)[0]
  return root ? root.charAt(0).toUpperCase() + root.slice(1) : null
}

// --- Target ----------------------------------------------------------------
// Verified against a real confirmation: full item name, Qty, unit price, and
// a summary block with subtotal / delivery / taxes / total / card.

function parseTarget(text) {
  const orderNumber = /order\s*#:?\s*(\d{6,})/i.exec(text)?.[1] || null
  const orderedOn = parseDate(/Placed\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i.exec(text)?.[1])

  const items = []
  const itemRe = /^(?!Qty:)(.{4,200}?)\n+Qty:\s*(\d+(?:\.\d+)?)\n+\$([\d,.]+)\s*\/\s*ea/gim
  let match
  while ((match = itemRe.exec(text))) {
    const name = match[1].replace(/\s+/g, ' ').trim()
    if (!name || /^(order|subtotal|total|delivery|shipping)\b/i.test(name)) continue
    items.push({
      name,
      quantity: Number(match[2]),
      unit_price: parseMoney(match[3]),
    })
  }

  const subtotal = parseMoney(/Subtotal\s*\([^)]*\)\s*\n+\$([\d,.]+)/i.exec(text)?.[1])
  const deliveryRaw = /\nDelivery\s*\n+([^\n]+)/i.exec(text)?.[1] || ''
  const shipping = /free/i.test(deliveryRaw) ? 0 : parseMoney(deliveryRaw)
  const tax = parseMoney(/Estimated taxes\s*\n+(?:[^\n$]*\n+)?\$([\d,.]+)/i.exec(text)?.[1])
  const total =
    parseMoney(/\nTotal\s*\n+\$([\d,.]+)/i.exec(text)?.[1]) ??
    parseMoney(/Order total\s*\n+\$([\d,.]+)/i.exec(text)?.[1])
  const payment = /\b(Visa|Mastercard|American Express|Amex|Discover)\s*\*+\s*(\d{4})/i.exec(text)

  return {
    orderNumber,
    orderedOn,
    items,
    subtotal,
    shipping,
    tax,
    total,
    paymentMethod: payment ? `${payment[1]} ending ${payment[2]}` : null,
  }
}

// --- Walmart ---------------------------------------------------------------
// Verified against a real grocery-delivery confirmation. Walmart's app-style
// email names only the first item and hides the rest behind a login, so the
// order is recorded from the email and the items have to come from the
// receipt. `itemsComplete: false` is what tells the caller that.

function parseWalmart(text) {
  const orderNumber =
    /Order number:\s*#?\s*([\d-]{6,})/i.exec(text)?.[1] ||
    /order\s+#\s*([\d-]{6,})/i.exec(text)?.[1] ||
    null
  const orderedOn = parseDate(/Order date:\s*([^|\n]+)/i.exec(text)?.[1])
  const total =
    parseMoney(/Includes all fees, taxes and discounts\s*\|?\s*\$([\d,.]+)/i.exec(text)?.[1]) ??
    parseMoney(/Order total\s*\|?\s*\n?\s*\$([\d,.]+)/i.exec(text)?.[1])
  const payment = /Ending in\s*(\d{4})/i.exec(text)
  const declared = /(\d+)\s+items?\s+See all/i.exec(text)?.[1]

  return {
    orderNumber,
    orderedOn,
    items: [],
    itemsComplete: false,
    declaredItemCount: declared ? Number(declared) : null,
    subtotal: null,
    shipping: null,
    tax: null,
    total,
    paymentMethod: payment ? `Card ending ${payment[1]}` : null,
  }
}

// --- Generic ---------------------------------------------------------------
// Enough to create a real record for a vendor nobody has written a parser for:
// the order number and the total are the two fields that make a purchase
// reconcilable, and both follow conventional wording almost everywhere.

function parseGeneric(text) {
  const orderNumber =
    /order\s*(?:number|no\.?|#)\s*:?\s*#?\s*([A-Z0-9][A-Z0-9-]{5,})/i.exec(text)?.[1] || null
  const total =
    parseMoney(/\b(?:order\s+)?total\s*:?\s*\|?\s*\n?\s*\$\s*([\d,.]+)/i.exec(text)?.[1]) ??
    parseMoney(/\bamount\s+(?:charged|paid)\s*:?\s*\$\s*([\d,.]+)/i.exec(text)?.[1])
  const orderedOn = parseDate(
    /(?:order\s+(?:date|placed)|placed\s+on|date)\s*:?\s*([A-Za-z0-9,/ ]{6,25})/i.exec(text)?.[1]
  )
  const subtotal = parseMoney(/\bsubtotal\s*:?\s*\|?\s*\n?\s*\$\s*([\d,.]+)/i.exec(text)?.[1])
  const tax = parseMoney(/\b(?:estimated\s+)?tax(?:es)?\s*:?\s*\|?\s*\n?\s*\$\s*([\d,.]+)/i.exec(text)?.[1])
  const shipping = parseMoney(/\b(?:shipping|delivery)\s*:?\s*\|?\s*\n?\s*\$\s*([\d,.]+)/i.exec(text)?.[1])

  return {
    orderNumber,
    orderedOn,
    items: [],
    itemsComplete: false,
    subtotal,
    shipping,
    tax,
    total,
    paymentMethod: null,
  }
}

const PARSERS = { Target: parseTarget, Walmart: parseWalmart }

/** Parse a confirmation email into the shape `purchase_orders` expects.
 *
 *  Returns `{ vendor, confidence, needsExtraction, ...fields }`.
 *  `needsExtraction` is true when the email plainly describes items that were
 *  not recovered — the caller can then hand it to a model, or leave it for a
 *  receipt. */
export function parseOrderEmail({ from = '', subject = '', body = '' } = {}) {
  const text = normalize(`${subject}\n${body}`)
  const vendor = detectVendor(from, subject, body)
  const parser = PARSERS[vendor]
  const parsed = parser ? parser(text) : parseGeneric(text)

  const items = parsed.items || []
  const itemsComplete = parsed.itemsComplete ?? items.length > 0

  // Cross-check: if the line items and the stated subtotal disagree, the parse
  // is wrong somewhere and the items should not be trusted.
  const lineSum = items.reduce((sum, i) => sum + (i.quantity || 0) * (i.unit_price || 0), 0)
  const subtotalAgrees =
    parsed.subtotal == null || items.length === 0 || Math.abs(lineSum - parsed.subtotal) < 0.02

  let confidence = 'none'
  if (parsed.orderNumber && parsed.total != null) {
    confidence = itemsComplete && subtotalAgrees ? 'high' : 'partial'
  } else if (parsed.orderNumber || parsed.total != null) {
    confidence = 'low'
  }

  return {
    vendor,
    parser: parser ? vendor.toLowerCase() : 'generic',
    confidence,
    itemsComplete: itemsComplete && subtotalAgrees,
    subtotalAgrees,
    needsExtraction: !itemsComplete || !subtotalAgrees,
    ...parsed,
    items: subtotalAgrees ? items : [],
  }
}
