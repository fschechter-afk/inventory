import { useCallback, useEffect, useState } from 'react'
import {
  fetchSpendingCategories,
  fetchSpendingHistory,
  submitSpendingEntry,
  uploadReceipt,
} from '../supabase.js'
import { queueSpending } from '../outbox.js'

const today = () => new Date().toISOString().slice(0, 10)

export default function Spending({ filledBy, onToast, onQueued }) {
  const [categories, setCategories] = useState(null)
  const [categoriesError, setCategoriesError] = useState(null)
  const [entries, setEntries] = useState(undefined)
  const [entriesError, setEntriesError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const [spentOn, setSpentOn] = useState(today())
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [vendor, setVendor] = useState('')
  const [note, setNote] = useState('')
  const [receiptFile, setReceiptFile] = useState(null)

  const loadEntries = useCallback(() => {
    fetchSpendingHistory()
      .then(setEntries)
      .catch((e) => {
        console.error('Spending history fetch failed:', e)
        setEntriesError("Couldn't load past entries — are you online?")
      })
  }, [])

  useEffect(() => {
    fetchSpendingCategories()
      .then((cats) => {
        setCategories(cats)
        setCategory((c) => c || cats[0]?.name || '')
      })
      .catch((e) => setCategoriesError(e.message || String(e)))
    loadEntries()
  }, [loadEntries])

  function resetForm() {
    setSpentOn(today())
    setAmount('')
    setVendor('')
    setNote('')
    setReceiptFile(null)
    // Category is left as-is — counselors often log a run of same-category purchases.
  }

  async function handleSubmit(e) {
    e.preventDefault()
    const amt = parseFloat(amount)
    if (!category || !amt || amt <= 0) return

    setSubmitting(true)
    const base = { filledBy, spentOn, category, amount: amt, vendor: vendor.trim(), note: note.trim() }
    let receiptUrl = null
    let photoFailed = false

    try {
      if (receiptFile) {
        try {
          receiptUrl = await uploadReceipt(receiptFile)
        } catch {
          photoFailed = true // still log the expense — just without the photo
        }
      }
      await submitSpendingEntry({ ...base, receiptUrl })
      onToast(photoFailed ? 'Logged — but the photo failed to upload' : 'Expense logged!')
      resetForm()
      loadEntries()
    } catch (err) {
      if (navigator.onLine === false || /fetch|network/i.test(err.message || '')) {
        queueSpending({ ...base, receiptUrl: null })
        onQueued?.()
        onToast(
          receiptFile
            ? 'No connection — saved without the photo, will send automatically'
            : 'No connection — saved on this device, will send automatically'
        )
        resetForm()
      } else {
        console.error('Spending submit failed:', err)
        onToast('Something went wrong — try again')
      }
    }
    setSubmitting(false)
  }

  const total = (entries || []).reduce((sum, e) => sum + Number(e.amount), 0)

  return (
    <div className="list-view">
      <form className="spend-form" onSubmit={handleSubmit}>
        <div className="spend-row">
          <div>
            <label className="field-label" htmlFor="spentOn">
              Date
            </label>
            <input
              id="spentOn"
              type="date"
              value={spentOn}
              max={today()}
              onChange={(e) => setSpentOn(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="field-label" htmlFor="amount">
              Amount ($)
            </label>
            <input
              id="amount"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
        </div>

        <label className="field-label" htmlFor="category">
          Category
        </label>
        {categoriesError ? (
          <div className="rl-meta">Couldn&apos;t load categories: {categoriesError}</div>
        ) : (
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
            disabled={!categories}
          >
            {!categories && <option>Loading…</option>}
            {categories?.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        )}

        <label className="field-label" htmlFor="vendor">
          Store / vendor (optional)
        </label>
        <input
          id="vendor"
          type="text"
          placeholder="e.g. Target, Jewel-Osco"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
        />

        <label className="field-label" htmlFor="note">
          Note (optional)
        </label>
        <input
          id="note"
          type="text"
          placeholder="What was it for?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        <label className="field-label" htmlFor="receipt">
          Receipt photo (optional)
        </label>
        <input
          id="receipt"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
        />
        {receiptFile && <div className="rl-meta">📎 {receiptFile.name}</div>}

        <button className="submit-btn" type="submit" disabled={submitting || !categories}>
          {submitting ? 'Logging…' : 'Log Expense'}
        </button>
      </form>

      <div className="rl-meta spend-total">
        {entries === undefined
          ? 'Loading recent expenses…'
          : `Last ${entries.length} expense${entries.length === 1 ? '' : 's'} — $${total.toFixed(2)} total`}
      </div>
      {entriesError && <div className="rl-meta">{entriesError}</div>}
      {entries?.length === 0 && <div className="rl-empty">No expenses logged yet.</div>}

      {entries?.map((entry) => {
        const when = new Date(`${entry.spent_on}T00:00:00`).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })
        return (
          <div className="hist-entry" key={entry.id}>
            <div className="hist-top">
              <span className="hist-name">{entry.category}</span>
              <span className="hist-date">{when}</span>
            </div>
            <div className="spend-amount">
              ${Number(entry.amount).toFixed(2)}
              {entry.vendor ? ` · ${entry.vendor}` : ''}
            </div>
            {entry.note && <div className="spend-note">{entry.note}</div>}
            <div className="hist-links">
              <span className="hist-date">{entry.filled_by}</span>
              {entry.receipt_url && (
                <a href={entry.receipt_url} target="_blank" rel="noreferrer">
                  Receipt photo
                </a>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
