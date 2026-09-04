import { supabase } from '../supabase.js'

const SITES_CACHE_KEY = 'portal.sites.v1'

/** The store list, grouped into ordered categories.
 *  Falls back to the last cached copy when offline. */
export async function fetchSites() {
  try {
    const { data, error } = await supabase
      .from('order_sites')
      .select('id, name, url, blurb, emoji, category, category_order, sort_order')
      .eq('active', true)
      .order('category_order')
      .order('sort_order')
    if (error) throw error
    if (data && data.length) {
      localStorage.setItem(SITES_CACHE_KEY, JSON.stringify(data))
      return { sites: data, fromCache: false }
    }
    throw new Error('Store list is empty')
  } catch (e) {
    const cached = localStorage.getItem(SITES_CACHE_KEY)
    if (cached) return { sites: JSON.parse(cached), fromCache: true }
    throw e
  }
}

export function groupSitesByCategory(sites) {
  const cats = []
  const byName = new Map()
  for (const site of sites) {
    let cat = byName.get(site.category)
    if (!cat) {
      cat = { name: site.category, sites: [] }
      byName.set(site.category, cat)
      cats.push(cat)
    }
    cat.sites.push(site)
  }
  return cats
}

/** Record one purchase. Validation is repeated server-side in log_purchase(). */
export async function logPurchase({
  orderedBy,
  siteId,
  siteName,
  amount,
  spentOn,
  notes,
  purchasedOn,
}) {
  const { data, error } = await supabase.rpc('log_purchase', {
    p_ordered_by: orderedBy,
    p_site_id: siteId || null,
    p_site_name: siteName,
    p_amount: amount,
    p_spent_on: spentOn || null,
    p_notes: notes || null,
    p_purchased_on: purchasedOn || null,
  })
  if (error) throw error
  return data
}

/** Purchases newest first, optionally from a start date (YYYY-MM-DD). */
export async function fetchPurchases({ since = null, limit = 500 } = {}) {
  let query = supabase
    .from('purchases')
    .select(
      'id, ordered_by, site_name, amount, spent_on, notes, purchased_on, voided, void_reason, created_at'
    )
    .order('purchased_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (since) query = query.gte('purchased_on', since)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

/** Strike a purchase from the totals without erasing it. */
export async function voidPurchase(id, reason) {
  const { error } = await supabase.rpc('void_purchase', { p_id: id, p_reason: reason || null })
  if (error) throw error
}
