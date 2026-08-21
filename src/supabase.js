import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_KEY } from './config.js'

// Bundled at build time — no CDN <script> tag to fail on filtered networks.
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
})

const CATALOG_CACHE_KEY = 'dormInventory.catalog.v1'

/** Fetch the active item catalog, grouped into ordered categories.
 *  Falls back to the last cached copy when offline. */
export async function fetchCatalog() {
  try {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('id, category, category_order, name, food_program, sort_order')
      .eq('active', true)
      .order('category_order')
      .order('sort_order')
    if (error) throw error
    if (data && data.length) {
      localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(data))
      return { items: data, fromCache: false }
    }
    throw new Error('Catalog is empty')
  } catch (e) {
    const cached = localStorage.getItem(CATALOG_CACHE_KEY)
    if (cached) return { items: JSON.parse(cached), fromCache: true }
    throw e
  }
}

export function groupByCategory(items) {
  const cats = []
  const byName = new Map()
  for (const item of items) {
    let cat = byName.get(item.category)
    if (!cat) {
      cat = { name: item.category, items: [] }
      byName.set(item.category, cat)
      cats.push(cat)
    }
    cat.items.push(item)
  }
  return cats
}

/** Submit a check atomically via the database function. */
export async function submitCheck({ filledBy, pantryVideoUrl, closetVideoUrl, items }) {
  const { data, error } = await supabase.rpc('submit_inventory_check', {
    p_filled_by: filledBy,
    p_pantry_video_url: pantryVideoUrl || null,
    p_closet_video_url: closetVideoUrl || null,
    p_items: items,
  })
  if (error) throw error
  return data
}

/** Latest check with its item rows (for the shopping list). */
export async function fetchLatestCheck() {
  const { data, error } = await supabase
    .from('inventory_checks')
    .select('*, inventory_check_items(item_id, item_name, category, status, qty)')
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return data && data.length ? data[0] : null
}

/** Recent checks (counts only) for the history tab. */
export async function fetchHistory(limit = 30) {
  const { data, error } = await supabase
    .from('inventory_checks')
    .select('id, filled_by, low_count, out_count, pantry_video_url, closet_video_url, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

/** All purchases logged by counselors in the separate Spending app, for the
 *  reconciliation sheet. Entries are created there — this app only reads
 *  and lets senior staff check them off against the card statement. */
export async function fetchSpendingEntries() {
  const { data, error } = await supabase
    .from('spending_entries')
    .select(
      'id, filled_by, spent_on, category, amount, vendor, note, receipt_url, verified, created_at'
    )
    .order('spent_on', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

/** Toggle one entry's verified flag via RPC, so a client can only ever
 *  flip that column — never rewrite the amount or category. */
export async function setSpendingVerified(id, verified) {
  const { error } = await supabase.rpc('set_spending_verified', { p_id: id, p_verified: verified })
  if (error) throw error
}
