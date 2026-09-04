import { useEffect, useMemo, useState } from 'react'
import {
  createPurchase,
  deleteReceipt,
  fetchPurchase,
  receiptUrl,
  updatePurchase,
  uploadReceipt,
} from '../api.js'
import { isoDate, money, nextStatuses, STATUS_LABEL, toNumber } from '../format.js'
import { ErrorNote, Field, Loading, Modal, StatusPill, friendlyError } from '../ui.jsx'

const blankItem = () => ({ name: '', quantity: '1', unit_price: '', sku: '', url: '' })

/** Record a new purchase (usually from a shopping session) or open an existing
 *  one to edit, attach a receipt, or update its delivery status. */
export default function OrderForm({
  me,
  departments,
  vendors,
  settings,
  purchaseId,
  session,
  requestApproval = false,
  onClose,
  onSaved,
  onToast,
}) {
  const [loading, setLoading] = useState(!!purchaseId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [existing, setExisting] = useState(null)
  const [receipts, setReceipts] = useState([])
  const [items, setItems] = useState([blankItem()])
  const [form, setForm] = useState({
    department_id: session?.department_id || me.home_department_id || '',
    vendor_id: session?.vendor_id || '',
    vendor_name: session?.vendor_name || '',
    purpose: session?.purpose || '',
    order_number: '',
    ordered_on: isoDate(),
    shipping: '',
    tax: '',
    total: session?.estimated_total != null ? String(session.estimated_total) : '',
    payment_method: '',
    tracking_carrier: '',
    tracking_number: '',
    tracking_url: '',
    delivered_on: '',
    notes: '',
    status: 'ordered',
  })

  useEffect(() => {
    if (!purchaseId) return
    fetchPurchase(purchaseId)
      .then(({ order, items: rows, receipts: files }) => {
        setExisting(order)
        setReceipts(files)
        setItems(
          rows.length
            ? rows.map((r) => ({
                name: r.name,
                quantity: String(r.quantity),
                unit_price: String(r.unit_price),
                sku: r.sku || '',
                url: r.url || '',
              }))
            : [blankItem()]
        )
        setForm({
          department_id: order.department_id,
          vendor_id: order.vendor_id || '',
          vendor_name: order.vendor_name,
          purpose: order.purpose,
          order_number: order.order_number || '',
          ordered_on: order.ordered_on || '',
          shipping: order.shipping ? String(order.shipping) : '',
          tax: order.tax ? String(order.tax) : '',
          total: String(order.total),
          payment_method: order.payment_method || '',
          tracking_carrier: order.tracking_carrier || '',
          tracking_number: order.tracking_number || '',
          tracking_url: order.tracking_url || '',
          delivered_on: order.delivered_on || '',
          notes: order.notes || '',
          status: order.status,
        })
      })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [purchaseId])

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const itemsSubtotal = useMemo(
    () =>
      items.reduce(
        (sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0),
        0
      ),
    [items]
  )
  const hasItems = items.some((i) => i.name.trim())
  const computedTotal = itemsSubtotal + (toNumber(form.shipping) || 0) + (toNumber(form.tax) || 0)

  // Once line items exist they are the source of truth for the total, so the
  // two can never disagree on a report.
  useEffect(() => {
    if (hasItems) set({ total: computedTotal.toFixed(2) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasItems, computedTotal])

  const vendor = vendors.find((v) => v.id === form.vendor_id)
  const limit = me.auto_approve_limit ?? settings?.approval_threshold ?? 0
  const totalValue = toNumber(form.total) || 0
  const willNeedApproval = totalValue > limit && existing?.status !== 'pending_approval'
  const canEdit =
    !existing ||
    existing.staff_id === me.id ||
    ['admin', 'super_admin'].includes(me.role) ||
    me.managedDepartmentIds?.includes(existing.department_id)

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        department_id: form.department_id,
        vendor_id: form.vendor_id || null,
        vendor_name: form.vendor_name.trim(),
        purpose: form.purpose.trim(),
        order_number: form.order_number.trim() || null,
        ordered_on: form.ordered_on || null,
        subtotal: hasItems ? Number(itemsSubtotal.toFixed(2)) : null,
        shipping: toNumber(form.shipping) || 0,
        tax: toNumber(form.tax) || 0,
        total: totalValue,
        payment_method: form.payment_method.trim() || null,
        tracking_carrier: form.tracking_carrier.trim() || null,
        tracking_number: form.tracking_number.trim() || null,
        tracking_url: form.tracking_url.trim() || null,
        delivered_on: form.delivered_on || null,
        notes: form.notes.trim() || null,
      }

      const cleanItems = items.filter((i) => i.name.trim())

      if (existing) {
        await updatePurchase(existing.id, { ...payload, status: form.status }, cleanItems)
        onToast('Order updated')
      } else {
        const row = await createPurchase({
          ...payload,
          staff_id: me.id,
          status: requestApproval ? 'pending_approval' : 'ordered',
          items: cleanItems,
          sessionId: session?.id,
        })
        onToast(
          row.status === 'pending_approval'
            ? 'Sent for approval'
            : 'Order saved — now add the receipt'
        )
        // Stay open on the saved order so the receipt step is right there,
        // which is the whole reason receipts go missing otherwise.
        setExisting({ ...row, staff_name: me.full_name })
        set({ status: row.status })
        onSaved()
        setSaving(false)
        return
      }
      onSaved()
      onClose()
    } catch (e) {
      setError(e)
      setSaving(false)
    }
  }

  const title = existing
    ? `${existing.reference} · ${existing.vendor_name}`
    : requestApproval
      ? 'Request approval'
      : 'Record this order'

  return (
    <Modal title={title} onClose={onClose}>
      {loading ? (
        <Loading />
      ) : (
        <>
          <ErrorNote error={error} />

          {existing && (
            <div className="pp-spread" style={{ marginBottom: 14 }}>
              <StatusPill status={existing.status} />
              <span className="pp-muted">
                {existing.staff_name}
                {existing.approved_by_name && ` · approved by ${existing.approved_by_name}`}
              </span>
            </div>
          )}

          {requestApproval && (
            <div className="pp-notice">
              This is over your {money(limit)} limit. Fill in what you plan to buy and a manager
              will review it before you shop.
            </div>
          )}

          <Field label="Department">
            <select
              className="pp-select"
              value={form.department_id}
              onChange={(e) => set({ department_id: e.target.value })}
              disabled={!canEdit}
            >
              <option value="">Choose…</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.emoji} {d.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Store">
            <select
              className="pp-select"
              value={form.vendor_id}
              onChange={(e) => {
                const v = vendors.find((x) => x.id === e.target.value)
                set({ vendor_id: e.target.value, vendor_name: v ? v.name : form.vendor_name })
              }}
              disabled={!canEdit}
            >
              <option value="">Other / not listed</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </Field>

          {!form.vendor_id && (
            <Field label="Store name">
              <input
                className="pp-input"
                value={form.vendor_name}
                onChange={(e) => set({ vendor_name: e.target.value })}
                disabled={!canEdit}
              />
            </Field>
          )}

          <Field label="What was it for?">
            <input
              className="pp-input"
              value={form.purpose}
              onChange={(e) => set({ purpose: e.target.value })}
              disabled={!canEdit}
            />
          </Field>

          <div className="pp-row">
            <Field label="Order number">
              <input
                className="pp-input"
                value={form.order_number}
                onChange={(e) => set({ order_number: e.target.value })}
                placeholder="111-2223334-5556667"
                disabled={!canEdit}
              />
            </Field>
            <Field label="Date">
              <input
                className="pp-input"
                type="date"
                value={form.ordered_on}
                onChange={(e) => set({ ordered_on: e.target.value })}
                disabled={!canEdit}
              />
            </Field>
          </div>

          {vendor?.integration_note && (
            <p className="pp-muted" style={{ marginTop: -6, marginBottom: 14, lineHeight: 1.5 }}>
              {vendor.integration === 'manual'
                ? 'This store has no way to send order data to the portal, so the receipt below is the record.'
                : 'This store can report order data to an administrator; the receipt below is still the fastest record.'}
            </p>
          )}

          <ItemsEditor items={items} setItems={setItems} disabled={!canEdit} />

          <div className="pp-row">
            <Field label="Shipping">
              <input
                className="pp-input"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.shipping}
                onChange={(e) => set({ shipping: e.target.value })}
                placeholder="0.00"
                disabled={!canEdit}
              />
            </Field>
            <Field label="Tax">
              <input
                className="pp-input"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.tax}
                onChange={(e) => set({ tax: e.target.value })}
                placeholder="0.00"
                disabled={!canEdit}
              />
            </Field>
          </div>

          <Field
            label="Total"
            hint={hasItems ? 'Calculated from the items, shipping and tax above.' : null}
          >
            <input
              className="pp-input"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={form.total}
              onChange={(e) => set({ total: e.target.value })}
              disabled={!canEdit || hasItems}
              required
            />
          </Field>

          {willNeedApproval && !existing && (
            <div className="pp-notice">
              {money(totalValue)} is over your {money(limit)} limit, so this will go to a manager
              for approval.
            </div>
          )}

          <Field label="Paid with (optional)">
            <input
              className="pp-input"
              value={form.payment_method}
              onChange={(e) => set({ payment_method: e.target.value })}
              placeholder="School card ending 4412"
              disabled={!canEdit}
            />
          </Field>

          {existing ? (
            <Receipts
              purchaseId={existing.id}
              receipts={receipts}
              setReceipts={setReceipts}
              me={me}
              onError={setError}
              canEdit={canEdit}
            />
          ) : (
            <div className="pp-notice info">
              Save the order first, then attach the receipt — it opens right back up.
            </div>
          )}

          {existing && nextStatuses(existing.status).length > 0 && canEdit && (
            <Field label="Status">
              <select
                className="pp-select"
                value={form.status}
                onChange={(e) => set({ status: e.target.value })}
              >
                {nextStatuses(existing.status).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </Field>
          )}

          <details style={{ marginBottom: 14 }}>
            <summary className="pp-muted" style={{ cursor: 'pointer', padding: '6px 0' }}>
              Tracking &amp; notes
            </summary>
            <div style={{ paddingTop: 10 }}>
              <div className="pp-row">
                <Field label="Carrier">
                  <input
                    className="pp-input"
                    value={form.tracking_carrier}
                    onChange={(e) => set({ tracking_carrier: e.target.value })}
                    placeholder="UPS"
                    disabled={!canEdit}
                  />
                </Field>
                <Field label="Tracking number">
                  <input
                    className="pp-input"
                    value={form.tracking_number}
                    onChange={(e) => set({ tracking_number: e.target.value })}
                    disabled={!canEdit}
                  />
                </Field>
              </div>
              <Field label="Delivered on">
                <input
                  className="pp-input"
                  type="date"
                  value={form.delivered_on}
                  onChange={(e) => set({ delivered_on: e.target.value })}
                  disabled={!canEdit}
                />
              </Field>
              <Field label="Notes">
                <textarea
                  className="pp-textarea"
                  value={form.notes}
                  onChange={(e) => set({ notes: e.target.value })}
                  disabled={!canEdit}
                />
              </Field>
            </div>
          </details>

          {canEdit && (
            <button
              className="pp-btn"
              onClick={save}
              disabled={
                saving ||
                !form.department_id ||
                !form.vendor_name.trim() ||
                !form.purpose.trim() ||
                !form.total
              }
            >
              {saving ? 'Saving…' : existing ? 'Save changes' : 'Save order'}
            </button>
          )}
        </>
      )}
    </Modal>
  )
}

function ItemsEditor({ items, setItems, disabled }) {
  const update = (index, patch) =>
    setItems(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))

  return (
    <div style={{ marginBottom: 14 }}>
      <span className="pp-field-label">Items (optional)</span>
      {items.map((item, i) => (
        <div key={i} className="pp-item-row">
          <input
            className="pp-input"
            value={item.name}
            onChange={(e) => update(i, { name: e.target.value })}
            placeholder="Item"
            disabled={disabled}
          />
          <input
            className="pp-input"
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            value={item.quantity}
            onChange={(e) => update(i, { quantity: e.target.value })}
            aria-label="Quantity"
            disabled={disabled}
          />
          <input
            className="pp-input"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={item.unit_price}
            onChange={(e) => update(i, { unit_price: e.target.value })}
            placeholder="0.00"
            aria-label="Unit price"
            disabled={disabled}
          />
          <button
            className="pp-item-del"
            onClick={() => setItems(items.length === 1 ? [blankItem()] : items.filter((_, j) => j !== i))}
            aria-label="Remove item"
            disabled={disabled}
          >
            ✕
          </button>
        </div>
      ))}
      {!disabled && (
        <button className="pp-link" onClick={() => setItems([...items, blankItem()])}>
          + Add an item
        </button>
      )}
    </div>
  )
}

function Receipts({ purchaseId, receipts, setReceipts, me, onError, canEdit }) {
  const [busy, setBusy] = useState(false)

  async function onPick(e) {
    const files = [...e.target.files]
    e.target.value = ''
    if (!files.length) return
    setBusy(true)
    try {
      for (const file of files) {
        const row = await uploadReceipt(purchaseId, file, me.id)
        setReceipts((prev) => [...prev, row])
      }
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }

  async function open(receipt) {
    try {
      window.open(await receiptUrl(receipt.storage_path), '_blank', 'noopener,noreferrer')
    } catch (err) {
      onError(err)
    }
  }

  async function remove(receipt) {
    setReceipts((prev) => prev.filter((r) => r.id !== receipt.id))
    try {
      await deleteReceipt(receipt)
    } catch (err) {
      onError(err)
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <span className="pp-field-label">Receipt / invoice</span>
      {receipts.map((r) => (
        <div key={r.id} className="pp-receipt">
          <span>📎</span>
          <button className="pp-link" style={{ flex: 1, textAlign: 'left' }} onClick={() => open(r)}>
            {r.file_name}
          </button>
          {canEdit && (
            <button className="pp-item-del" onClick={() => remove(r)} aria-label="Remove receipt">
              ✕
            </button>
          )}
        </div>
      ))}
      {canEdit && (
        <label className="pp-upload">
          <input
            type="file"
            accept="image/*,application/pdf"
            capture="environment"
            multiple
            onChange={onPick}
          />
          {busy ? 'Uploading…' : receipts.length ? '+ Add another receipt' : '📷 Take a photo or choose a file'}
        </label>
      )}
      {!receipts.length && (
        <p className="pp-muted" style={{ marginTop: 6 }}>
          Orders without a receipt show up on the missing-receipts report.
        </p>
      )}
    </div>
  )
}
