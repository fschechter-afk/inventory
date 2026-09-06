// Reads a receipt photo and fills in the purchase.
//
// This is what makes the portal usable: a staff member photographs the
// receipt and the order number, date, every line item, subtotal, tax and
// total come off the picture. It is also the only path that works for
// Restaurant Depot, Costco and Sam's Club, which send no email at all, and
// for Walmart grocery, whose email withholds the items.
//
// Called by the app right after a receipt is uploaded. Auth is the caller's
// own JWT, so a person can only extract a receipt on a purchase they can
// already see — the RPC that writes the result runs under their identity.
//
// POST { receiptId } with the user's Authorization header.

import Anthropic from 'npm:@anthropic-ai/sdk@0.71.0'
import { createClient } from 'jsr:@supabase/supabase-js@2'

const MODEL = 'claude-opus-5'
const RECEIPT_BUCKET = 'purchase-receipts'
const MAX_BYTES = 10 * 1024 * 1024

const SUPPORTED_IMAGE = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

const SYSTEM = `You read receipts and order confirmations for a school's purchasing records.

Return ONLY a JSON object, no prose and no code fence, with exactly these keys:
{
  "vendor": string|null,          // store name as printed
  "orderNumber": string|null,     // order/invoice/transaction number
  "orderedOn": string|null,       // "YYYY-MM-DD"
  "items": [ { "name": string, "quantity": number, "unit_price": number } ],
  "subtotal": number|null,
  "shipping": number|null,
  "tax": number|null,
  "total": number|null,
  "paymentMethod": string|null,   // e.g. "Visa ending 1442"
  "confidence": "high"|"medium"|"low"
}

Rules:
- Transcribe item names as printed, including abbreviations. Do not expand,
  translate, tidy or invent them.
- unit_price is the per-unit price. If the receipt shows only a line total for
  a quantity, divide it out.
- Use null for anything not visible. Never guess a number that is not printed.
- Deposits, bag fees and bottle deposits are items; discounts are items with a
  negative unit_price.
- If the image is not a receipt or is unreadable, return every field null,
  "items": [], and "confidence": "low".
- confidence is "low" whenever the total is unreadable or the items plainly do
  not add up to it.`

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) {
    // Not configured is not an error the staff member can act on — the app
    // treats this as "extraction is off" and keeps the manual fields.
    return json({ status: 'unavailable', reason: 'ANTHROPIC_API_KEY is not set' }, 503)
  }

  const authorization = req.headers.get('Authorization')
  if (!authorization) return json({ error: 'Missing Authorization' }, 401)

  let receiptId: string
  try {
    receiptId = (await req.json()).receiptId
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }
  if (!receiptId) return json({ error: 'receiptId is required' }, 400)

  // The caller's own token: RLS decides which receipts they can touch.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } }
  )

  const { data: receipt, error: receiptError } = await supabase
    .from('purchase_receipts')
    .select('id, purchase_id, storage_path, file_name, mime_type, size_bytes, extraction_status')
    .eq('id', receiptId)
    .maybeSingle()

  if (receiptError) return json({ error: receiptError.message }, 500)
  if (!receipt) return json({ error: 'Receipt not found' }, 404)
  if (receipt.extraction_status === 'extracted') {
    return json({ status: 'already_extracted', receiptId })
  }
  if ((receipt.size_bytes ?? 0) > MAX_BYTES) {
    await markFailed(supabase, receiptId, 'File is larger than 10 MB')
    return json({ status: 'failed', error: 'File is larger than 10 MB' }, 413)
  }

  try {
    const { data: file, error: downloadError } = await supabase.storage
      .from(RECEIPT_BUCKET)
      .download(receipt.storage_path)
    if (downloadError) throw downloadError

    const bytes = new Uint8Array(await file.arrayBuffer())
    const mediaType = normalizeMediaType(receipt.mime_type, receipt.file_name)
    if (!mediaType) {
      await markSkipped(supabase, receiptId, 'Unsupported file type')
      return json({ status: 'skipped', reason: 'Unsupported file type' })
    }

    const anthropic = new Anthropic({ apiKey })
    const source =
      mediaType === 'application/pdf'
        ? { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64(bytes) }
        : { type: 'base64' as const, media_type: mediaType, data: base64(bytes) }

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      system: SYSTEM,
      // A receipt is a short, concrete extraction; medium keeps it accurate
      // without paying for deliberation this task does not need.
      output_config: { effort: 'medium' },
      messages: [
        {
          role: 'user',
          content: [
            mediaType === 'application/pdf'
              ? { type: 'document', source }
              : { type: 'image', source },
            { type: 'text', text: 'Extract this receipt as JSON.' },
          ],
        },
      ],
    })

    if (response.stop_reason === 'refusal') {
      throw new Error('The model declined to read this image')
    }

    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { text: string }).text)
      .join('')

    const parsed = parseAndValidate(text)
    if (!parsed) throw new Error('Could not read a receipt from this image')

    const { data: purchase, error: applyError } = await supabase.rpc(
      'pp_apply_receipt_extraction',
      { p_receipt_id: receiptId, p_data: parsed }
    )
    if (applyError) throw applyError

    return json({
      status: 'extracted',
      receiptId,
      confidence: parsed.confidence,
      items: parsed.items.length,
      total: parsed.total,
      purchase,
    })
  } catch (e) {
    const message = String((e as Error)?.message || e)
    await markFailed(supabase, receiptId, message)
    return json({ status: 'failed', error: message }, 500)
  }
})

const markFailed = (supabase: ReturnType<typeof createClient>, id: string, error: string) =>
  supabase
    .from('purchase_receipts')
    .update({ extraction_status: 'failed', extraction_error: error.slice(0, 500), extracted_at: new Date().toISOString() })
    .eq('id', id)

const markSkipped = (supabase: ReturnType<typeof createClient>, id: string, reason: string) =>
  supabase
    .from('purchase_receipts')
    .update({ extraction_status: 'skipped', extraction_error: reason, extracted_at: new Date().toISOString() })
    .eq('id', id)

/** HEIC from an iPhone arrives with assorted content types and is not one the
 *  API accepts, so it is skipped rather than failed — the receipt file is
 *  still attached to the purchase either way. */
function normalizeMediaType(mime: string | null, fileName: string) {
  const declared = (mime || '').toLowerCase()
  if (SUPPORTED_IMAGE.includes(declared)) return declared as (typeof SUPPORTED_IMAGE)[number]
  if (declared === 'application/pdf') return 'application/pdf'
  const ext = fileName.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'pdf') return 'application/pdf'
  return null
}

function base64(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Trust nothing that comes back: coerce every field, drop malformed items,
 *  and refuse a result that read nothing at all. */
function parseAndValidate(text: string) {
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
    ? raw.items
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
        .filter(Boolean)
    : []

  const date = str(raw.orderedOn)
  const parsed = {
    vendor: str(raw.vendor),
    orderNumber: str(raw.orderNumber),
    orderedOn: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    items,
    subtotal: num(raw.subtotal),
    shipping: num(raw.shipping),
    tax: num(raw.tax),
    total: num(raw.total),
    paymentMethod: str(raw.paymentMethod),
    confidence: ['high', 'medium', 'low'].includes(String(raw.confidence))
      ? String(raw.confidence)
      : 'low',
  }

  // Nothing usable came back — better to leave the fields empty than to write
  // an empty purchase over them.
  if (parsed.total == null && parsed.items.length === 0) return null
  return parsed
}
