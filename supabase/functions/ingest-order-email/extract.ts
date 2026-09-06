// Reading the line items out of a confirmation email.
//
// The deterministic parsers in parse-order-email.js only cover formats that
// have actually been examined. Writing regexes for Amazon, Sam's Club and
// WebstaurantStore without ever having seen one of their emails would produce
// parsers that fail silently — and vendors redesign their templates anyway.
//
// So anything the fast path can't fully read goes to the model, which needs no
// per-vendor knowledge and survives a template change. The regex parsers stay
// as a free fast path for the formats they're proven against.

import Anthropic from 'npm:@anthropic-ai/sdk@0.71.0'

const MODEL = 'claude-opus-5'

const SYSTEM = `You read vendor order-confirmation emails for a school's purchasing records.

Return ONLY a JSON object, no prose and no code fence:
{
  "isOrderConfirmation": boolean,  // false for shipping notices, marketing, receipts for someone else
  "vendor": string|null,
  "orderNumber": string|null,
  "orderedOn": string|null,        // "YYYY-MM-DD"
  "items": [ { "name": string, "quantity": number, "unit_price": number } ],
  "itemsComplete": boolean,        // false if the email says there are more items than it lists
  "subtotal": number|null,
  "shipping": number|null,
  "tax": number|null,
  "total": number|null,
  "paymentMethod": string|null,
  "confidence": "high"|"medium"|"low"
}

Rules:
- Transcribe item names as printed. Do not expand, tidy, translate or invent them.
- unit_price is per unit. If only a line total is shown for a quantity, divide it out.
- Ignore recommendation and "trending"/"you might also like" blocks — those are
  adverts, not items on this order.
- Some emails name one item and hide the rest behind a login ("+ 15 items").
  List what is shown and set itemsComplete to false.
- Use null for anything not present. Never guess a number that is not printed.
- A shipping notice, delivery update or marketing email is not an order
  confirmation: set isOrderConfirmation false and leave everything else empty.`

export type Extracted = {
  isOrderConfirmation: boolean
  vendor: string | null
  orderNumber: string | null
  orderedOn: string | null
  items: { name: string; quantity: number; unit_price: number }[]
  itemsComplete: boolean
  subtotal: number | null
  shipping: number | null
  tax: number | null
  total: number | null
  paymentMethod: string | null
  confidence: string
}

/** Ask the model to read the email. Returns null when extraction is not
 *  configured or the model produced nothing usable — the caller keeps whatever
 *  the fast path found rather than losing the order. */
export async function extractFromEmail(
  { from, subject, body }: { from: string; subject: string; body: string },
  apiKey: string
): Promise<Extracted | null> {
  const anthropic = new Anthropic({ apiKey })

  // Marketing footers and tracking URLs are most of the bytes and none of the
  // signal; trimming keeps the request small and the model on task.
  const trimmed = body.replace(/https?:\/\/\S+/g, ' ').replace(/[ \t]+/g, ' ').slice(0, 60000)

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    // A confirmation email is a bounded extraction, not a reasoning problem.
    output_config: { effort: 'medium' },
    messages: [
      {
        role: 'user',
        content: `From: ${from}\nSubject: ${subject}\n\n${trimmed}`,
      },
    ],
  })

  if (response.stop_reason === 'refusal') return null

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { text: string }).text)
    .join('')

  return validate(text)
}

/** Coerce everything and drop what doesn't hold up. An extractor that writes
 *  confident nonsense is worse than one that returns nothing. */
function validate(text: string): Extracted | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }

  const num = (value: unknown) => {
    const n = typeof value === 'string' ? Number(value.replace(/[^0-9.-]/g, '')) : Number(value)
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
  }
  const str = (value: unknown) => {
    const s = typeof value === 'string' ? value.trim() : ''
    return s && s.toLowerCase() !== 'null' ? s : null
  }

  const items = Array.isArray(raw.items)
    ? (raw.items
        .map((item) => {
          const entry = item as Record<string, unknown>
          const name = str(entry.name)
          if (!name) return null
          return {
            name: name.slice(0, 500),
            quantity: Math.max(num(entry.quantity) ?? 1, 0.001),
            unit_price: num(entry.unit_price) ?? 0,
          }
        })
        .filter(Boolean) as Extracted['items'])
    : []

  const date = str(raw.orderedOn)
  const isOrder = raw.isOrderConfirmation !== false

  return {
    isOrderConfirmation: isOrder,
    vendor: str(raw.vendor),
    orderNumber: str(raw.orderNumber),
    orderedOn: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    items,
    itemsComplete: raw.itemsComplete !== false && items.length > 0,
    subtotal: num(raw.subtotal),
    shipping: num(raw.shipping),
    tax: num(raw.tax),
    total: num(raw.total),
    paymentMethod: str(raw.paymentMethod),
    confidence: ['high', 'medium', 'low'].includes(String(raw.confidence))
      ? String(raw.confidence)
      : 'low',
  }
}

/** The fast path found the order; the model found the items. Prefer whichever
 *  actually has a value, and prefer the deterministic parser where both do —
 *  it read the literal bytes. */
export function merge(fast: Record<string, any>, model: Extracted | null) {
  if (!model || !model.isOrderConfirmation) return fast
  const pick = (a: unknown, b: unknown) => (a == null || a === '' ? b : a)

  const items = fast.items?.length ? fast.items : model.items
  return {
    ...fast,
    vendor: fast.vendor || model.vendor,
    orderNumber: pick(fast.orderNumber, model.orderNumber),
    orderedOn: pick(fast.orderedOn, model.orderedOn),
    items,
    itemsComplete: fast.itemsComplete || model.itemsComplete,
    subtotal: pick(fast.subtotal, model.subtotal),
    shipping: pick(fast.shipping, model.shipping),
    tax: pick(fast.tax, model.tax),
    total: pick(fast.total, model.total),
    paymentMethod: pick(fast.paymentMethod, model.paymentMethod),
    parser: fast.items?.length ? fast.parser : 'model',
    confidence:
      (fast.orderNumber || model.orderNumber) && (fast.total ?? model.total) != null
        ? items.length
          ? 'high'
          : 'partial'
        : 'low',
  }
}
