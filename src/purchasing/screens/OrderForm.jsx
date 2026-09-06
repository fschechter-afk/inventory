import { useEffect, useMemo, useState } from 'react'
import {
  createPurchase,
  deleteReceipt,
  extractReceipt,
  fetchPurchase,
  receiptUrl,
  updatePurchase,
  uploadReceipt,
} from '../api.js'
import { isoDate, money, nextStatuses, STATUS_LABEL, toNumber } from '../format.js'
import { ErrorNote, Field, Loading, Modal, StatusPill } from '../ui.jsx'

const blankItem = () => ({ name: '', quantity: '1', unit_price: '' })

/** Recording a purchase, reduced to a photo.
 *
 *  The receipt is the first and usually the only thing on screen: uploading it
 *  creates the purchase and reads the order number, date, items and totals off
 *  the picture. Everything else is folded away behind "Enter it by hand" for
 *  the cases where there is no receipt to photograph. */
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
  const [busy, setBusy] = useState(null) // 'uploading' | 'reading'
  const [error, setError] = useState(null)
  const [existing, setExisting] = useState(null)
  const [receipts, setReceipts] = useState([])
  const [items, setItems] = useState([blankItem()])
  const [manual, setManual] = useState(false)
  const [extraction, setExtraction] = useState(null)
  const [form, setForm] = useState({
    department_id: session?.department_id || me.home_department_id || '',
    vendor_id: session?.vendor_id || '',
    vendor_name: session?.vendor_name || '',
    purpose: session?.purpose || '',
    order_number: '',
    ordered_on: isoDate(),
    shipping: '',
    tax: '',
    total: '',
    payment_method: '',
    notes: '',
    status: 'ordered',
  })

  useEffect(() => {
    if (!purchaseId) return
    load(purchaseId)
      .catch(setError)
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purchaseId])

  async function load(id) {
    const { order, items: rows, receipts: files } = await fetchPurchase(id)
    setExisting(order)
    setReceipts(files)
    setItems(
      rows.length
        ? rows.map((r) => ({
            name: r.name,
            quantity: String(r.quantity),
            unit_price: String(r.unit_price),
          }))
        : [blankItem()]
    )
    setForm((f) => ({
      ...f,
      department_id: order.department_id,
      vendor_id: order.vendor_id || '',
      vendor_name: order.vendor_name,
      purpose: order.purpose || '',
      order_number: order.order_number || '',
      ordered_on: order.ordered_on || '',
      shipping: order.shipping ? String(order.shipping) : '',
      tax: order.tax ? String(order.tax) : '',
      total: String(order.total),
      payment_method: order.payment_method || '',
      notes: order.notes || '',
      status: order.status,
    }))
    if (rows.length) setManual(true)
    return order
  }

  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const itemsSubtotal = useMemo(
    () => items.reduce((sum, i) => sum + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0),
    [items]
  )
  const hasItems = items.some((i) => i.name.trim())
  const totalValue = toNumber(form.total) || 0
  const limit = me.auto_approve_limit ?? settings?.approval_threshold ?? 0
  const department = departments.find((d) => d.id === form.department_id)

  /** Make sure a purchase row exists, so the receipt has something to attach
   *  to. Called by the upload path before the file goes anywhere. */
  async function ensurePurchase() {
    if (existing) return existing
    const row = await createPurchase({
      staff_id: me.id,
      department_id: form.department_id,
      vendor_id: form.vendor_id || null,
      vendor_name: form.vendor_name.trim() || 'Unknown vendor',
      purpose: form.purpose.trim() || department?.name || null,
      total: totalValue,
      shipping: toNumber(form.shipping) || 0,
      tax: toNumber(form.tax) || 0,
      status: requestApproval ? 'pending_approval' : 'ordered',
      sessionId: session?.id,
    })
    setExisting({ ...row, staff_name: me.full_name })
    onSaved()
    return row
  }

  async function onPickReceipt(event) {
    const files = [...event.target.files]
    event.target.value = ''
    if (!files.length) return

    setError(null)
    setBusy('uploading')
    try {
      const purchase = await ensurePurchase()
      let lastReceiptId = null
      for (const file of files) {
        const row = await uploadReceipt(purchase.id, file, me.id)
        setReceipts((prev) => [...prev, row])
        lastReceiptId = row.id
      }

      setBusy('reading')
      const result = await extractReceipt(lastReceiptId)
      if (result?.status === 'extracted') {
        await load(purchase.id)
        setExtraction(result)
        onToast(
          result.items
            ? `Read ${result.items} item${result.items === 1 ? '' : 's'} off the receipt`
            : 'Receipt read'
        )
      } else if (result === null) {
        // Extraction is not switched on for this project.
        setManual(true)
        onToast('Receipt saved')
      } else {
        setManual(true)
        onToast('Receipt saved — add the total below')
      }
      onSaved()
    } catch (e) {
      setError(e)
      setManual(true)
    } finally {
      setBusy(null)
    }
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        department_id: form.department_id,
        vendor_id: form.vendor_id || null,
        vendor_name: form.vendor_name.trim() || 'Unknown vendor',
        purpose: form.purpose.trim() || department?.name || null,
        order_number: form.order_number.trim() || null,
        ordered_on: form.ordered_on || null,
        subtotal: hasItems ? Number(itemsSubtotal.toFixed(2)) : null,
        shipping: toNumber(form.shipping) || 0,
        tax: toNumber(form.tax) || 0,
        total: hasItems
          ? Number((itemsSubtotal + (toNumber(form.shipping) || 0) + (toNumber(form.tax) || 0)).toFixed(2))
          : totalValue,
        payment_method: form.payment_method.trim() || null,
        notes: form.notes.trim() || null,
      }
      const cleanItems = items.filter((i) => i.name.trim())

      if (existing) {
        await updatePurchase(existing.id, { ...payload, status: form.status }, cleanItems)
      } else {
        await createPurchase({
          ...payload,
          staff_id: me.id,
          status: requestApproval ? 'pending_approval' : 'ordered',
          items: cleanItems,
          sessionId: session?.id,
        })
      }
      onToast('Saved')
      onSaved()
      onClose()
    } catch (e) {
      setError(e)
      setSaving(false)
    }
  }

  const title = existing
    ? `${existing.reference || 'Purchase'} · ${existing.vendor_name}`
    : session?.vendor_name || 'Record a purchase'

  const canSave =
    form.department_id && (hasItems || totalValue > 0 || receipts.length > 0)

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
                {existing.total > 0 && ` · ${money(existing.total)}`}
              </span>
            </div>
          )}

          <Receipts
            receipts={receipts}
            busy={busy}
            extraction={extraction}
            onPick={onPickReceipt}
            onRemove={async (receipt) => {
              setReceipts((prev) => prev.filter((r) => r.id !== receipt.id))
              try {
                await deleteReceipt(receipt)
                onSaved()
              } catch (e) {
                setError(e)
              }
            }}
          />

          {totalValue > limit && limit > 0 && !existing && (
            <div className="pp-notice">
              Over your {money(limit)} limit, so a manager reviews this one.
            </div>
          )}

          {!manual && !busy && (
            <button className="pp-link" onClick={() => setManual(true)}>
              No receipt? Enter it by hand
            </button>
          )}

          {manual && (
            <div style={{ marginTop: 10 }}>
              <Field label="Department">
                <select
                  className="pp-select"
                  value={form.department_id}
                  onChange={(e) => set({ department_id: e.target.value })}
                >
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
                    const vendor = vendors.find((v) => v.id === e.target.value)
                    set({
                      vendor_id: e.target.value,
                      vendor_name: vendor ? vendor.name : form.vendor_name,
                    })
                  }}
                >
                  <option value="">Not listed</option>
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
                  />
                </Field>
              )}

              <div className="pp-row">
                <Field label="Total">
                  <input
                    className="pp-input"
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    value={hasItems ? (itemsSubtotal + (toNumber(form.shipping) || 0) + (toNumber(form.tax) || 0)).toFixed(2) : form.total}
                    onChange={(e) => set({ total: e.target.value })}
                    disabled={hasItems}
                    placeholder="0.00"
                  />
                </Field>
                <Field label="Date">
                  <input
                    className="pp-input"
                    type="date"
                    value={form.ordered_on}
                    onChange={(e) => set({ ordered_on: e.target.value })}
                  />
                </Field>
              </div>

              <ItemsEditor items={items} setItems={setItems} />

              <details style={{ marginBottom: 14 }}>
                <summary className="pp-muted" style={{ cursor: 'pointer', padding: '6px 0' }}>
                  Order number, tax, notes
                </summary>
                <div style={{ paddingTop: 10 }}>
                  <Field label="Order number">
                    <input
                      className="pp-input"
                      value={form.order_number}
                      onChange={(e) => set({ order_number: e.target.value })}
                    />
                  </Field>
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
                      />
                    </Field>
                  </div>
                  <Field label="What was it for?">
                    <input
                      className="pp-input"
                      value={form.purpose}
                      onChange={(e) => set({ purpose: e.target.value })}
                      placeholder={department?.name || ''}
                    />
                  </Field>
                  <Field label="Notes">
                    <textarea
                      className="pp-textarea"
                      value={form.notes}
                      onChange={(e) => set({ notes: e.target.value })}
                    />
                  </Field>
                </div>
              </details>
            </div>
          )}

          {existing && nextStatuses(existing.status).length > 0 && (
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

          <button className="pp-btn" onClick={save} disabled={saving || !!busy || !canSave}>
            {saving ? 'Saving…' : existing ? 'Done' : 'Save'}
          </button>
        </>
      )}
    </Modal>
  )
}

function Receipts({ receipts, busy, extraction, onPick, onRemove }) {
  const [error, setError] = useState(null)

  async function open(receipt) {
    try {
      window.open(await receiptUrl(receipt.storage_path), '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e)
    }
  }

  return (
    <div style={{ marginBottom: 14 }}>
      <ErrorNote error={error} />
      {receipts.map((receipt) => (
        <div key={receipt.id} className="pp-receipt">
          <span>📎</span>
          <button className="pp-link" style={{ flex: 1, textAlign: 'left' }} onClick={() => open(receipt)}>
            {receipt.file_name}
          </button>
          <button className="pp-item-del" onClick={() => onRemove(receipt)} aria-label="Remove receipt">
            ✕
          </button>
        </div>
      ))}

      <label className={`pp-upload ${busy ? 'busy' : ''} ${receipts.length ? '' : 'primary'}`}>
        <input
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          multiple
          disabled={!!busy}
          onChange={onPick}
        />
        {busy === 'uploading'
          ? 'Uploading…'
          : busy === 'reading'
            ? 'Reading the receipt…'
            : receipts.length
              ? '+ Another receipt'
              : '📷 Photograph the receipt'}
      </label>

      {extraction && (
        <div className={`pp-notice ${extraction.confidence === 'low' ? '' : 'good'}`}>
          {extraction.confidence === 'low'
            ? 'The photo was hard to read — check the total and items below.'
            : `Read ${extraction.items} item${extraction.items === 1 ? '' : 's'} and a ${money(extraction.total)} total off the receipt.`}
        </div>
      )}

      {!receipts.length && !busy && (
        <p className="pp-muted" style={{ marginTop: 8, textAlign: 'center' }}>
          The order number, items and total come off the photo.
        </p>
      )}
    </div>
  )
}

function ItemsEditor({ items, setItems }) {
  const update = (index, patch) =>
    setItems(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))

  return (
    <details style={{ marginBottom: 14 }}>
      <summary className="pp-muted" style={{ cursor: 'pointer', padding: '6px 0' }}>
        Items ({items.filter((i) => i.name.trim()).length})
      </summary>
      <div style={{ paddingTop: 10 }}>
        {items.map((item, i) => (
          <div key={i} className="pp-item-row">
            <input
              className="pp-input"
              value={item.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Item"
            />
            <input
              className="pp-input"
              type="number"
              inputMode="decimal"
              min="0"
              value={item.quantity}
              onChange={(e) => update(i, { quantity: e.target.value })}
              aria-label="Quantity"
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
            />
            <button
              className="pp-item-del"
              onClick={() => setItems(items.length === 1 ? [blankItem()] : items.filter((_, j) => j !== i))}
              aria-label="Remove item"
            >
              ✕
            </button>
          </div>
        ))}
        <button className="pp-link" onClick={() => setItems([...items, blankItem()])}>
          + Add an item
        </button>
      </div>
    </details>
  )
}
