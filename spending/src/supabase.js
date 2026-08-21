import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_KEY } from './config.js'

// Bundled at build time — no CDN <script> tag to fail on filtered networks.
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
})

const CATEGORIES_CACHE_KEY = 'dormSpending.categories.v1'

/** Active spending categories, dashboard-editable — add/retire/reorder from
 *  the Supabase Table Editor, no redeploy needed. */
export async function fetchSpendingCategories() {
  try {
    const { data, error } = await supabase
      .from('spending_categories')
      .select('id, name, sort_order')
      .eq('active', true)
      .order('sort_order')
    if (error) throw error
    if (data && data.length) {
      localStorage.setItem(CATEGORIES_CACHE_KEY, JSON.stringify(data))
      return data
    }
    throw new Error('Category list is empty')
  } catch (e) {
    const cached = localStorage.getItem(CATEGORIES_CACHE_KEY)
    if (cached) return JSON.parse(cached)
    throw e
  }
}

/** Upload a receipt photo and return its public URL. No OCR/AI — it's just
 *  attached as proof of purchase for whoever reconciles the card statement. */
export async function uploadReceipt(file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
  const { error } = await supabase.storage.from('receipts').upload(path, file, {
    contentType: file.type || 'image/jpeg',
  })
  if (error) throw error
  return supabase.storage.from('receipts').getPublicUrl(path).data.publicUrl
}

/** Log one purchase. A single-table insert — RLS plus the amount > 0 check
 *  constraint do the validation. */
export async function submitSpendingEntry({ filledBy, spentOn, category, amount, vendor, note, receiptUrl }) {
  const { error } = await supabase.from('spending_entries').insert({
    filled_by: filledBy,
    spent_on: spentOn,
    category,
    amount,
    vendor: vendor || null,
    note: note || null,
    receipt_url: receiptUrl || null,
  })
  if (error) throw error
}

/** Recent purchases, for the "what I've logged" list. */
export async function fetchSpendingHistory(limit = 50) {
  const { data, error } = await supabase
    .from('spending_entries')
    .select('id, filled_by, spent_on, category, amount, vendor, note, receipt_url, created_at')
    .order('spent_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}
