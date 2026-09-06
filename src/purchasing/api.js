import { supabase } from '../supabase.js'
import { SUPABASE_KEY, SUPABASE_URL } from '../config.js'

// Every query here runs under the caller's own Row Level Security policies, so
// "what an employee can see" is enforced by the database, not by this file.
// See supabase/migrations/0003_create_purchasing_portal_schema.sql.

const RECEIPT_BUCKET = 'purchase-receipts'

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

// --- session & identity ----------------------------------------------------

export async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  })
  if (error) throw error
}

export async function signUp(email, password, fullName) {
  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: { data: { full_name: fullName.trim() } },
  })
  if (error) throw error
  // No session means the project requires email confirmation first.
  return { needsConfirmation: !data.session }
}

export const signOut = () => supabase.auth.signOut()

/** The signed-in person's staff record, or null when they have no portal
 *  access. A Supabase Auth account is not enough — an administrator has to
 *  invite the address first (see pp_accept_staff_invite). */
export async function fetchMe() {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) return null
  const { data, error } = await supabase
    .from('staff')
    .select('*, home_department:departments(id, name, emoji)')
    .eq('id', auth.user.id)
    .maybeSingle()
  if (error) throw error
  if (!data) return { id: auth.user.id, email: auth.user.email, noAccess: true }

  const managed = unwrap(
    await supabase.from('department_managers').select('department_id').eq('staff_id', auth.user.id)
  )
  return { ...data, managedDepartmentIds: managed.map((m) => m.department_id) }
}

export const updateMyName = (fullName) =>
  supabase.rpc('pp_update_my_name', { p_full_name: fullName }).then(unwrap)

// --- reference data --------------------------------------------------------

export const fetchSettings = () =>
  supabase.from('purchasing_settings').select('*').eq('id', true).single().then(unwrap)

export const fetchDepartments = (includeInactive = false) => {
  let q = supabase.from('departments').select('*').order('sort_order').order('name')
  if (!includeInactive) q = q.eq('active', true)
  return q.then(unwrap)
}

export const fetchVendors = (includeInactive = false) => {
  let q = supabase
    .from('order_sites')
    .select('id, name, url, emoji, blurb, category, category_order, sort_order, active, integration, integration_note, account_hint, requires_receipt, channel, items_in_email')
    .order('category_order')
    .order('sort_order')
  if (!includeInactive) q = q.eq('active', true)
  return q.then(unwrap)
}

export const fetchStaff = () =>
  supabase
    .from('staff')
    .select('*, home_department:departments(id, name)')
    .order('full_name')
    .then(unwrap)

export const fetchBudgetStatus = () => supabase.rpc('pp_budget_status').then(unwrap)

export const fetchBudgets = () =>
  supabase
    .from('department_budgets')
    .select('*, department:departments(id, name, emoji)')
    .is('ends_on', null)
    .then(unwrap)

// --- shopping sessions -----------------------------------------------------

export const startShoppingSession = (session) =>
  supabase.from('shopping_sessions').insert(session).select().single().then(unwrap)

/** Trips the person opened but has not yet turned into a recorded order. */
export const fetchOpenSessions = (staffId) =>
  supabase
    .from('shopping_sessions')
    .select('*')
    .eq('staff_id', staffId)
    .is('purchase_id', null)
    .is('dismissed_at', null)
    .order('opened_at', { ascending: false })
    .then(unwrap)

export const dismissSession = (id) =>
  supabase
    .from('shopping_sessions')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', id)
    .then(unwrap)

const linkSessionToPurchase = (sessionId, purchaseId) =>
  supabase.from('shopping_sessions').update({ purchase_id: purchaseId }).eq('id', sessionId)

// --- purchases -------------------------------------------------------------

const ORDER_COLUMNS = '*'

/** Filters: { staffId, departmentId, vendorId, status, from, to, minTotal,
 *  maxTotal, search, missingReceipt, limit }. Everything is optional. */
export async function fetchPurchases(filters = {}) {
  let q = supabase.from('v_purchase_orders').select(ORDER_COLUMNS)

  if (filters.staffId) q = q.eq('staff_id', filters.staffId)
  if (filters.departmentId) q = q.eq('department_id', filters.departmentId)
  if (filters.vendorId) q = q.eq('vendor_id', filters.vendorId)
  if (filters.status) q = q.eq('status', filters.status)
  if (filters.minTotal != null) q = q.gte('total', filters.minTotal)
  if (filters.maxTotal != null) q = q.lte('total', filters.maxTotal)
  if (filters.missingReceipt) q = q.eq('receipt_count', 0)
  if (filters.search) {
    const term = `%${filters.search.replace(/[%,]/g, '')}%`
    q = q.or(
      `order_number.ilike.${term},purpose.ilike.${term},reference.ilike.${term},vendor_name.ilike.${term},notes.ilike.${term}`
    )
  }
  // effective_date is ordered_on, or the day the record was created when the
  // purchase was entered after the fact — so a date filter never silently
  // drops a retroactive entry.
  if (filters.from) q = q.gte('effective_date', filters.from)
  if (filters.to) q = q.lte('effective_date', filters.to)

  return q
    .order('effective_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 500)
    .then(unwrap)
}

/** Every line item ever recorded, newest first. Same RLS as the purchases
 *  they belong to, so an employee sees only their own. */
export function fetchItems(filters = {}) {
  let q = supabase.from('v_purchase_items').select('*')
  if (filters.search) q = q.ilike('name', `%${filters.search.replace(/[%,]/g, '')}%`)
  if (filters.departmentId) q = q.eq('department_id', filters.departmentId)
  if (filters.vendorId) q = q.eq('vendor_id', filters.vendorId)
  if (filters.staffId) q = q.eq('staff_id', filters.staffId)
  if (filters.from) q = q.gte('effective_date', filters.from)
  if (filters.to) q = q.lte('effective_date', filters.to)
  return q
    .order('effective_date', { ascending: false })
    .limit(filters.limit ?? 3000)
    .then(unwrap)
}

export const fetchPendingApprovals = () =>
  supabase
    .from('v_purchase_orders')
    .select(ORDER_COLUMNS)
    .eq('status', 'pending_approval')
    .order('created_at')
    .then(unwrap)

export async function fetchPurchase(id) {
  const [order, items, receipts, events] = await Promise.all([
    supabase.from('v_purchase_orders').select(ORDER_COLUMNS).eq('id', id).single().then(unwrap),
    supabase
      .from('purchase_order_items')
      .select('*')
      .eq('purchase_id', id)
      .order('sort_order')
      .order('id')
      .then(unwrap),
    supabase
      .from('purchase_receipts')
      .select('*')
      .eq('purchase_id', id)
      .order('created_at')
      .then(unwrap),
    supabase
      .from('purchase_events')
      .select('*, actor:staff(full_name)')
      .eq('purchase_id', id)
      .order('created_at')
      .then(unwrap),
  ])
  return { order, items, receipts, events }
}

/** Create a purchase with its line items. The database decides the final
 *  status: anything over the approval limit comes back `pending_approval`. */
export async function createPurchase({ items = [], sessionId, ...order }) {
  const row = await supabase.from('purchase_orders').insert(order).select().single().then(unwrap)
  if (items.length) await saveItems(row.id, items)
  if (sessionId) await linkSessionToPurchase(sessionId, row.id)
  return row
}

export async function updatePurchase(id, patch, items) {
  const row = await supabase
    .from('purchase_orders')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
    .then(unwrap)
  if (items) await saveItems(id, items)
  return row
}

/** Replace the line items wholesale — simpler than diffing, and these lists
 *  are a handful of rows edited by one person at a time. */
async function saveItems(purchaseId, items) {
  const { error } = await supabase.from('purchase_order_items').delete().eq('purchase_id', purchaseId)
  if (error) throw error
  const rows = items
    .filter((i) => i.name?.trim())
    .map((i, index) => ({
      purchase_id: purchaseId,
      name: i.name.trim(),
      quantity: Number(i.quantity) || 1,
      unit_price: Number(i.unit_price) || 0,
      sku: i.sku?.trim() || null,
      url: i.url?.trim() || null,
      sort_order: index,
    }))
  if (rows.length) unwrap(await supabase.from('purchase_order_items').insert(rows))
}

export const deletePurchase = (id) =>
  supabase.from('purchase_orders').delete().eq('id', id).then(unwrap)

export const decidePurchase = (id, approve, note) =>
  supabase
    .rpc('pp_decide_purchase', { p_purchase_id: id, p_approve: approve, p_note: note || null })
    .then(unwrap)

// --- receipts --------------------------------------------------------------

export async function uploadReceipt(purchaseId, file, uploadedBy) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().slice(0, 8)
  const path = `${purchaseId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage
    .from(RECEIPT_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (error) throw error

  return supabase
    .from('purchase_receipts')
    .insert({
      purchase_id: purchaseId,
      storage_path: path,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size ?? null,
      uploaded_by: uploadedBy,
    })
    .select()
    .single()
    .then(unwrap)
}

/** Read the receipt photo and fill the purchase in from it. Returns null when
 *  extraction is not configured on this project, which the caller treats as
 *  "keep the manual fields" rather than an error. */
export async function extractReceipt(receiptId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const response = await fetch(`${SUPABASE_URL}/functions/v1/extract-receipt`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ receiptId }),
  })

  const result = await response.json().catch(() => ({}))
  if (response.status === 503) return null // extraction not switched on
  if (!response.ok) throw new Error(result.error || 'Could not read the receipt')
  return result
}

/** The bucket is private, so viewing needs a short-lived signed URL. */
export const receiptUrl = (storagePath, seconds = 3600) =>
  supabase.storage
    .from(RECEIPT_BUCKET)
    .createSignedUrl(storagePath, seconds)
    .then(({ data, error }) => {
      if (error) throw error
      return data.signedUrl
    })

export async function deleteReceipt(receipt) {
  unwrap(await supabase.from('purchase_receipts').delete().eq('id', receipt.id))
  await supabase.storage.from(RECEIPT_BUCKET).remove([receipt.storage_path])
}

// --- administration --------------------------------------------------------

export const saveDepartment = (dept) =>
  supabase.from('departments').upsert(dept).select().single().then(unwrap)

export const saveVendor = (vendor) =>
  supabase.from('order_sites').upsert(vendor).select().single().then(unwrap)

export const saveSettings = (patch) =>
  supabase
    .from('purchasing_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', true)
    .select()
    .single()
    .then(unwrap)

export const saveStaff = (id, patch) =>
  supabase.from('staff').update(patch).eq('id', id).select().single().then(unwrap)

export const inviteStaff = (invite) =>
  supabase
    .from('staff_invites')
    .upsert({ ...invite, email: invite.email.trim().toLowerCase() })
    .select()
    .single()
    .then(unwrap)

export const fetchInvites = () =>
  supabase
    .from('staff_invites')
    .select('*, home_department:departments(name)')
    .is('accepted_at', null)
    .order('created_at', { ascending: false })
    .then(unwrap)

export const revokeInvite = (email) =>
  supabase.from('staff_invites').delete().eq('email', email).then(unwrap)

export const setDepartmentManagers = async (departmentId, staffIds) => {
  unwrap(await supabase.from('department_managers').delete().eq('department_id', departmentId))
  if (staffIds.length) {
    unwrap(
      await supabase
        .from('department_managers')
        .insert(staffIds.map((staff_id) => ({ staff_id, department_id: departmentId })))
    )
  }
}

export const fetchDepartmentManagers = () =>
  supabase.from('department_managers').select('*').then(unwrap)

/** Budgets are versioned by closing the old row rather than editing it, so
 *  last month's numbers still explain themselves. Both writes happen in one
 *  database call so a department is never briefly without a budget. */
export const setBudget = (departmentId, period, amount) =>
  supabase
    .rpc('pp_set_budget', {
      p_department_id: departmentId,
      p_period: period,
      p_amount: amount,
    })
    .then(unwrap)
