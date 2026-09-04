// Read an order confirmation and pull out the store, the total and the date,
// so nobody has to retype what the email already says. Deliberately forgiving:
// anything it can't find is left for the person to fill in, and everything it
// does find is shown before it's saved.

const MONEY = /(?:\$|USD\s*)\s?(\d[\d,]*\.\d{2})(?![\d.])/gi

// Labels that mark the number we actually want, strongest first.
const TOTAL_LABELS = [
  { re: /(order|grand|payment|invoice|purchase)\s+total/i, score: 5 },
  { re: /total\s+(charged|paid|billed|due|for\s+this\s+order)/i, score: 5 },
  { re: /(amount|total)\s+(charged|billed|paid)/i, score: 5 },
  { re: /you\s+(paid|were\s+charged)/i, score: 5 },
  { re: /charged\s+to|card\s+ending/i, score: 4 },
  { re: /\btotal\b/i, score: 3 },
]

// Lines that carry a number we don't want mistaken for the total.
const NOT_TOTAL =
  /sub-?total|before\s+tax|savings|you\s+saved|discount|coupon|shipping|delivery\s+fee|service\s+fee|\btax\b|\btip\b|gift\s+card|balance|each\b|\bper\b|item\s+price/i

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

const DATE_HINT = /order(ed)?\s*(date|placed|on)?|placed\s+on|purchase[d]?\s+on|date\b/i

function pad(n) {
  return String(n).padStart(2, '0')
}

function iso(y, m, d) {
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** The label sitting next to an amount: the text before it on its own line,
 *  plus the line above (receipts often put the label in the previous cell). */
function contextFor(text, index) {
  const lineStart = text.lastIndexOf('\n', index) + 1
  const before = text.slice(Math.max(lineStart, index - 70), index)
  const prevStart = lineStart > 1 ? text.lastIndexOf('\n', lineStart - 2) + 1 : 0
  const prevLine = lineStart > 0 ? text.slice(prevStart, Math.max(prevStart, lineStart - 1)) : ''
  return `${prevLine} ${before}`
}

function findTotal(text) {
  let best = null
  MONEY.lastIndex = 0
  let m
  while ((m = MONEY.exec(text)) !== null) {
    const amount = Number.parseFloat(m[1].replace(/,/g, ''))
    if (!Number.isFinite(amount)) continue
    const ctx = contextFor(text, m.index)
    let score = 0
    for (const label of TOTAL_LABELS) {
      if (label.re.test(ctx)) {
        score = label.score
        break
      }
    }
    // A weakly-labelled number sitting next to "subtotal" or "tax" is one of
    // those, not the total.
    if (score < 5 && NOT_TOTAL.test(ctx)) continue
    if (score === 0) continue
    // Highest-priority label wins; between equals, the largest number is the
    // one that includes the others.
    if (!best || score > best.score || (score === best.score && amount > best.amount)) {
      best = { amount, score }
    }
  }
  return best ? best.amount : null
}

/** Compare on letters and digits only, so "Jewel-Osco" matches "jewelosco". */
function squash(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function hostToken(url) {
  try {
    return new URL(url).hostname
      .replace(/^(www|shop|store|orders?|mail|email)\./, '')
      .split('.')[0]
      .toLowerCase()
  } catch {
    return ''
  }
}

function findSite(text, sites) {
  const hay = squash(text)
  let best = null
  for (const site of sites || []) {
    for (const token of [squash(site.name), hostToken(site.url)]) {
      if (token.length < 4) continue
      const at = hay.indexOf(token)
      if (at === -1) continue
      // Whichever store is named earliest is the sender, not a mention
      // further down; a longer token beats a shorter one at the same spot.
      if (!best || at < best.at || (at === best.at && token.length > best.len)) {
        best = { site, at, len: token.length }
      }
    }
  }
  return best ? best.site : null
}

function findDate(text) {
  const found = []
  const push = (y, m, d, index) => {
    const value = iso(y, m, d)
    if (value) found.push({ value, index })
  }

  let m
  const named = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/gi
  while ((m = named.exec(text)) !== null) {
    push(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]), m.index)
  }
  const dashed = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g
  while ((m = dashed.exec(text)) !== null) {
    push(Number(m[1]), Number(m[2]), Number(m[3]), m.index)
  }
  const slashed = /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g
  while ((m = slashed.exec(text)) !== null) {
    const year = Number(m[3])
    push(year < 100 ? 2000 + year : year, Number(m[1]), Number(m[2]), m.index)
  }
  if (!found.length) return null

  // Prefer a date introduced by something like "Order placed:".
  const labelled = found.find((f) => DATE_HINT.test(text.slice(Math.max(0, f.index - 40), f.index)))
  const chosen = (labelled || found[0]).value

  // Never return a date in the future: log_purchase() would clamp it anyway,
  // and a wrong year shouldn't sit at the top of the list.
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return chosen > today ? today : chosen
}

function findOrderNumber(text) {
  const m = /order\s*(?:#|no\.?|number)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{4,24})/i.exec(text)
  return m ? m[1] : null
}

/** Parse a pasted confirmation. Returns whatever it could find; callers show
 *  it for confirmation rather than saving it blind. */
export function parseReceipt(text, sites = []) {
  const clean = String(text || '')
    .replace(/ /g, ' ')
    .replace(/\r\n?/g, '\n')
  if (!clean.trim()) return { found: [] }

  const site = findSite(clean, sites)
  const amount = findTotal(clean)
  const purchasedOn = findDate(clean)
  const orderNumber = findOrderNumber(clean)

  const found = []
  if (site) found.push(site.name)
  if (amount != null) found.push(`$${amount.toFixed(2)}`)
  if (purchasedOn) found.push(purchasedOn)

  return {
    siteId: site ? site.id : null,
    siteName: site ? site.name : null,
    amount,
    purchasedOn,
    orderNumber,
    found,
  }
}
