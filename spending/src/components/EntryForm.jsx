import { useCallback, useEffect, useState } from 'react'
import { fetchSpendingHistory } from '../supabase.js'

const today = () => new Date().toISOString().slice(0, 10)

export default function EntryForm({ categories, submitting, onSubmit }) {
  const [entries, setEntries] = useState(undefined)
  const [entriesError, setEntriesError] = useState(null)

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
    if (categories?.length) setCategory((c) => c || categories[0].name)
  }, [categories])

  useEffect(() => {
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
    await onSubmit({ spentOn, category, amount: amt, vendor: vendor.trim(), note: note.trim(), receiptFile })
    resetForm()
    loadEntries()
  }

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

      <div className="rl-meta">Recent entries (all counselors)</div>
      {entriesError && <div className="rl-meta">{entriesError}</div>}
      {entries === undefined && !entriesError && <div className="rl-meta">Loading…</div>}
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
