import { supabase } from '../supabase.js'

const SITES_CACHE_KEY = 'portal.sites.v1'

/** The store list, grouped into ordered categories.
 *  Falls back to the last cached copy when offline. */
export async function fetchSites() {
  try {
    const { data, error } = await supabase
      .from('order_sites')
      .select('id, name, url, blurb, emoji, kind, auto_import, category, category_order, sort_order')
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
  deliveryLocation,
  expectedOn,
  items,
}) {
  const { data, error } = await supabase.rpc('log_purchase', {
    p_ordered_by: orderedBy,
    p_site_id: siteId || null,
    p_site_name: siteName,
    p_amount: amount,
    p_spent_on: spentOn || null,
    p_notes: notes || null,
    p_purchased_on: purchasedOn || null,
    p_delivery_location: deliveryLocation || null,
    p_expected_on: expectedOn || null,
    p_items: items && items.length ? items : null,
  })
  if (error) throw error
  return data
}

/** Purchases newest first, optionally from a start date (YYYY-MM-DD). */
export async function fetchPurchases({ since = null, limit = 500 } = {}) {
  let query = supabase
    .from('purchases')
    .select(
      'id, ordered_by, site_name, amount, spent_on, notes, purchased_on, voided, void_reason, ' +
        'source, created_at, delivery_location, expected_on, delivery_status, has_issue, ' +
        'issue_note, received_at, received_by, unpacked_at, unpacked_by, issue_by, ' +
        'issue_resolved_by, purchase_items(id, name, qty_ordered, unit, qty_received, sort_order)'
    )
    .order('purchased_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)
  if (since) query = query.gte('purchased_on', since)
  const { data, error } = await query
  if (error) throw error
  return data || []
}

/** Say who is heading off to a store, so the confirmation email that turns up
 *  later can find its owner without anyone claiming it. Best-effort: a failure
 *  here costs an automatic attribution, not the purchase. */
export async function recordOrderIntent({ orderedBy, siteId, siteName, deliveryLocation }) {
  const { error } = await supabase.rpc('record_order_intent', {
    p_ordered_by: orderedBy,
    p_site_id: siteId || null,
    p_site_name: siteName,
    p_delivery_location: deliveryLocation || null,
  })
  if (error) throw error
}

/** Claim an unassigned purchase by its order number, for when the portal
 *  couldn't work out whose it was. Returns false if nothing matched. */
export async function claimByOrderNumber(orderNumber, orderedBy) {
  const { data, error } = await supabase.rpc('claim_purchase_by_order_number', {
    p_order_number: orderNumber,
    p_ordered_by: orderedBy,
  })
  if (error) throw error
  return !!data
}

/** Put a name to an imported purchase. Only fills in an unassigned one, so
 *  claiming can never rewrite somebody else's row. */
export async function claimPurchase(id, orderedBy) {
  const { data, error } = await supabase.rpc('claim_purchase', {
    p_id: id,
    p_ordered_by: orderedBy,
  })
  if (error) throw error
  return data === true
}

/** Everything still owed a delivery or a check, oldest expected first.
 *  Michelle's queue, regardless of where an order was going. */
export async function fetchReceiving() {
  const { data, error } = await supabase
    .from('purchases')
    .select(
      'id, ordered_by, site_name, amount, spent_on, notes, purchased_on, delivery_location, ' +
        'expected_on, delivery_status, has_issue, issue_note, shipped_at, received_at, ' +
        'received_by, unpacked_at, unpacked_by, issue_by, issue_resolved_by, source, ' +
        'purchase_items(id, name, qty_ordered, unit, qty_received, sort_order)'
    )
    .eq('voided', false)
    .order('expected_on', { ascending: true, nullsFirst: false })
    .order('purchased_on', { ascending: false })
    .limit(400)
  if (error) throw error
  return data || []
}

/** Michelle's four marks: awaiting / received / unpacked / issue. */
export async function setDeliveryState(id, state, by, note) {
  const { error } = await supabase.rpc('set_delivery_state', {
    p_purchase_id: id,
    p_state: state,
    p_by: by,
    p_note: note || null,
  })
  if (error) throw error
}

export async function resolveDeliveryIssue(id, by) {
  const { error } = await supabase.rpc('resolve_delivery_issue', { p_purchase_id: id, p_by: by })
  if (error) throw error
}

/** Send an order to the right place, or correct where it went. */
export async function setDeliveryLocation(id, location, by) {
  const { error } = await supabase.rpc('set_delivery_location', {
    p_purchase_id: id,
    p_location: location || null,
    p_by: by,
  })
  if (error) throw error
}

export async function setExpectedDate(id, expectedOn, by) {
  const { error } = await supabase.rpc('set_expected_date', {
    p_purchase_id: id,
    p_expected_on: expectedOn || null,
    p_by: by,
  })
  if (error) throw error
}

/** What was on the order. */
export async function setPurchaseItems(id, items) {
  const { error } = await supabase.rpc('set_purchase_items', { p_purchase_id: id, p_items: items })
  if (error) throw error
}

/** How much of each line actually turned up. */
export async function setReceivedQuantities(id, items) {
  const { error } = await supabase.rpc('set_received_quantities', {
    p_purchase_id: id,
    p_items: items,
  })
  if (error) throw error
}

/** Strike a purchase from the totals without erasing it. */
export async function voidPurchase(id, reason) {
  const { error } = await supabase.rpc('void_purchase', { p_id: id, p_reason: reason || null })
  if (error) throw error
}
