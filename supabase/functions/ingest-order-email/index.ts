// Receives a vendor order-confirmation email, parses it, and — when it can be
// attributed to the person who went shopping — records the purchase with its
// line items. No typing by anybody.
//
// The attribution trick: the portal already recorded a shopping session when
// the staff member tapped "Shop" (who, which department, what for). The email
// supplies the merchant, order number, date, totals and items. Matching the
// two on vendor + time window produces a complete record from two halves that
// each arrive automatically.
//
// POST with header `x-ingest-secret: <INGEST_SECRET>` and a JSON body:
//   { messageId, from, to, subject, body, receivedAt? }

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { parseOrderEmail } from './parse-order-email.js'
import { extractFromEmail, merge } from './extract.ts'

// How far back to look for the shopping trip this email belongs to. Long
// enough to cover a warehouse run, short enough that two trips to the same
// vendor in one day do not collide.
const SESSION_WINDOW_HOURS = 12

// Shipping and marketing mail from the same senders; recording these as
// purchases would double-count every order.
const NOT_AN_ORDER =
  /\b(out for delivery|has shipped|was shipped|arriving|arrives today|delivered:|tracking|review your|rate (?:&|and) review|unsubscribe now|deals|weekly ad|price drop|back in stock|abandoned|still in your cart)\b/i

const ORDER_HINT =
  /\b(thanks for your order|order confirmation|your order|order #|order number|thank you for your purchase|receipt|invoice)\b/i

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const secret = Deno.env.get('INGEST_SECRET')
  if (!secret || req.headers.get('x-ingest-secret') !== secret) {
    return json({ error: 'Unauthorized' }, 401)
  }

  let payload: Record<string, string>
  try {
    payload = await req.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  const { messageId, from = '', to = '', subject = '', body = '', receivedAt } = payload
  if (!messageId) return json({ error: 'messageId is required' }, 400)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  // At-least-once delivery: the watcher may resend. Message-ID is the guard.
  const { data: seen } = await supabase
    .from('inbound_emails')
    .select('id, status, purchase_id')
    .eq('message_id', messageId)
    .maybeSingle()
  if (seen) return json({ status: 'duplicate', ...seen })

  const looksLikeOrder = ORDER_HINT.test(subject) && !NOT_AN_ORDER.test(subject)
  const fast = parseOrderEmail({ from, subject, body })

  // The fast path only covers formats that have actually been examined. For
  // everything else — and for any email whose items it could not read — the
  // model reads the body. It needs no per-vendor knowledge, which is the only
  // way Amazon, Sam's Club and WebstaurantStore get itemised without someone
  // hand-writing a parser for each and re-writing it at every redesign.
  let parsed = fast
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (looksLikeOrder && apiKey && (fast.needsExtraction || fast.total == null)) {
    try {
      parsed = merge(fast, await extractFromEmail({ from, subject, body }, apiKey))
    } catch (e) {
      console.error('Model extraction failed, keeping the fast-path result:', e)
    }
  }

  const row = {
    message_id: messageId,
    received_at: receivedAt || new Date().toISOString(),
    from_address: from,
    to_address: to,
    subject,
    body: body.slice(0, 200_000),
    vendor_guess: parsed.vendor,
    parser: parsed.parser,
    confidence: parsed.confidence,
    parsed,
    status: 'pending' as string,
    purchase_id: null as string | null,
    error: null as string | null,
    processed_at: new Date().toISOString(),
  }

  // Not an order at all, or nothing usable came out of it.
  if (!looksLikeOrder || parsed.confidence === 'none' || parsed.total == null) {
    row.status = 'ignored'
    const { data, error } = await supabase.from('inbound_emails').insert(row).select().single()
    if (error) return json({ error: error.message }, 500)
    return json({ status: 'ignored', reason: looksLikeOrder ? 'nothing parsable' : 'not an order', id: data.id })
  }

  try {
    const match = await findShoppingSession(supabase, parsed, row.received_at)

    if (!match) {
      row.status = 'unmatched'
      const { data, error } = await supabase.from('inbound_emails').insert(row).select().single()
      if (error) return json({ error: error.message }, 500)
      return json({ status: 'unmatched', id: data.id, vendor: parsed.vendor })
    }

    const purchase = await createPurchase(supabase, parsed, match)
    row.status = 'matched'
    row.purchase_id = purchase.id
    const { data, error } = await supabase.from('inbound_emails').insert(row).select().single()
    if (error) return json({ error: error.message }, 500)

    return json({
      status: 'matched',
      id: data.id,
      purchase: {
        id: purchase.id,
        reference: purchase.reference,
        total: purchase.total,
        status: purchase.status,
        items: parsed.items.length,
      },
    })
  } catch (e) {
    row.status = 'failed'
    row.error = String((e as Error)?.message || e)
    await supabase.from('inbound_emails').insert(row)
    return json({ status: 'failed', error: row.error }, 500)
  }
})

/** The open shopping trip this email most likely belongs to: same vendor,
 *  recent, not yet turned into a purchase. Ambiguity is left unmatched rather
 *  than guessed — attributing a purchase to the wrong person or budget is
 *  worse than asking. */
async function findShoppingSession(
  supabase: ReturnType<typeof createClient>,
  parsed: { vendor: string | null; orderedOn: string | null },
  receivedAt: string
) {
  if (!parsed.vendor) return null
  const since = new Date(new Date(receivedAt).getTime() - SESSION_WINDOW_HOURS * 3600_000)

  const { data, error } = await supabase
    .from('shopping_sessions')
    .select('id, staff_id, department_id, vendor_id, vendor_name, purpose, opened_at')
    .is('purchase_id', null)
    .is('dismissed_at', null)
    .gte('opened_at', since.toISOString())
    .lte('opened_at', receivedAt)
    .order('opened_at', { ascending: false })
  if (error) throw error

  const vendor = parsed.vendor.toLowerCase()
  const candidates = (data || []).filter((s) => {
    const name = String(s.vendor_name || '').toLowerCase()
    return name.includes(vendor) || vendor.includes(name)
  })

  // Exactly one open trip to this vendor is a confident match. Several people
  // shopping the same store in the same window is not.
  return candidates.length === 1 ? candidates[0] : null
}

async function createPurchase(
  supabase: ReturnType<typeof createClient>,
  parsed: Record<string, any>,
  session: Record<string, any>
) {
  const { data: purchase, error } = await supabase
    .from('purchase_orders')
    .insert({
      staff_id: session.staff_id,
      department_id: session.department_id,
      vendor_id: session.vendor_id,
      vendor_name: session.vendor_name || parsed.vendor,
      purpose: session.purpose,
      order_number: parsed.orderNumber,
      ordered_on: parsed.orderedOn,
      subtotal: parsed.subtotal,
      shipping: parsed.shipping ?? 0,
      tax: parsed.tax ?? 0,
      total: parsed.total,
      payment_method: parsed.paymentMethod,
      source: 'email',
      session_id: session.id,
      // The approval rule still applies: the insert trigger holds anything
      // over the buyer's limit at pending_approval, ingested or not.
      status: 'ordered',
    })
    .select()
    .single()
  if (error) throw error

  if (parsed.items?.length) {
    const items = parsed.items.map((item: Record<string, any>, index: number) => ({
      purchase_id: purchase.id,
      name: String(item.name).slice(0, 500),
      quantity: Number(item.quantity) || 1,
      unit_price: Number(item.unit_price) || 0,
      sort_order: index,
    }))
    const { error: itemError } = await supabase.from('purchase_order_items').insert(items)
    if (itemError) throw itemError
  }

  // Close the trip so it stops nagging the staff member to record it.
  await supabase
    .from('shopping_sessions')
    .update({ purchase_id: purchase.id })
    .eq('id', session.id)

  return purchase
}
