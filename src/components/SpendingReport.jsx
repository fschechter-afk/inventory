import { useEffect, useMemo, useState } from 'react'
import { fetchSpendingEntries, setSpendingVerified } from '../supabase.js'

const ALL_CATEGORIES = 'All categories'

function monthKey(dateStr) {
  return dateStr.slice(0, 7) // 'YYYY-MM'
}

function monthLabel(key) {
  const [y, m] = key.split('-')
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  })
}

/** Reconciliation sheet: every purchase counselors logged in the Spending
 *  app, so whoever checks the credit card statement can verify each one. */
export default function SpendingReport({ onToast }) {
  const [entries, setEntries] = useState(undefined)
  const [error, setError] = useState(null)
  const [month, setMonth] = useState(null) // null = not yet chosen (defaults to latest)
  const [category, setCategory] = useState(ALL_CATEGORIES)

  useEffect(() => {
    fetchSpendingEntries()
      .then((data) => {
        setEntries(data)
        if (data.length) setMonth((m) => m ?? monthKey(data[0].spent_on))
      })
      .catch((e) => {
        console.error('Spending report fetch failed:', e)
        setError("Couldn't load spending entries — are you online?")
      })
  }, [])

  const months = useMemo(() => {
    const keys = new Set((entries || []).map((e) => monthKey(e.spent_on)))
    return [...keys].sort().reverse()
  }, [entries])

  const categories = useMemo(() => {
    const names = new Set((entries || []).map((e) => e.category))
    return [ALL_CATEGORIES, ...[...names].sort()]
  }, [entries])

  const filtered = useMemo(() => {
    return (entries || []).filter((e) => {
      if (month && month !== 'all' && monthKey(e.spent_on) !== month) return false
      if (category !== ALL_CATEGORIES && e.category !== category) return false
      return true
    })
  }, [entries, month, category])

  const total = filtered.reduce((sum, e) => sum + Number(e.amount), 0)
  const verifiedCount = filtered.filter((e) => e.verified).length

  async function toggleVerified(entry) {
    const next = !entry.verified
    setEntries((prev) => prev.map((e) => (e.id === entry.id ? { ...e, verified: next } : e)))
    try {
      await setSpendingVerified(entry.id, next)
    } catch (e) {
      console.error('Verify toggle failed:', e)
      setEntries((prev) => prev.map((row) => (row.id === entry.id ? { ...row, verified: !next } : row)))
      onToast("Couldn't save — try again")
    }
  }

  function rowsAsTsv() {
    const header = ['Date', 'Category', 'Amount', 'Vendor', 'Note', 'Logged by', 'Verified', 'Receipt']
    const lines = [header.join('\t')]
    for (const e of filtered) {
      lines.push(
        [
          e.spent_on,
          e.category,
          Number(e.amount).toFixed(2),
          e.vendor || '',
          e.note || '',
          e.filled_by,
          e.verified ? 'Yes' : 'No',
          e.receipt_url || '',
        ]
          .map((v) => String(v).replace(/\t|\n/g, ' '))
          .join('\t')
      )
    }
    return lines.join('\n')
  }

  function copySheet() {
    navigator.clipboard
      .writeText(rowsAsTsv())
      .then(() => onToast('Copied — paste into a spreadsheet'))
      .catch(() => onToast("Couldn't copy — try again"))
  }

  function downloadCsv() {
    const csv = rowsAsTsv().replace(/\t/g, ',')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `spending-${month === 'all' ? 'all' : month}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  if (error) return <div className="list-view"><div className="rl-meta">{error}</div></div>
  if (entries === undefined)
    return <div className="list-view"><div className="rl-meta">Loading spending entries…</div></div>
  if (entries.length === 0)
    return <div className="list-view"><div className="rl-empty">No purchases logged yet.</div></div>

  return (
    <div className="list-view">
      <div className="spend-filters">
        <select value={month || ''} onChange={(e) => setMonth(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
          <option value="all">All time</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="rl-meta spend-total">
        {filtered.length} purchase{filtered.length === 1 ? '' : 's'} — ${total.toFixed(2)} total —{' '}
        {verifiedCount}/{filtered.length} verified
      </div>

      <div className="report-actions">
        <button className="copy-btn" onClick={copySheet}>
          Copy for Sheets
        </button>
        <button className="copy-btn" onClick={downloadCsv}>
          Download CSV
        </button>
      </div>

      {filtered.length === 0 && <div className="rl-empty">Nothing in this filter.</div>}

      {filtered.map((entry) => {
        const when = new Date(`${entry.spent_on}T00:00:00`).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        })
        return (
          <div className={`report-row ${entry.verified ? 'verified' : ''}`} key={entry.id}>
            <input
              type="checkbox"
              aria-label={`Verified: ${entry.category} $${entry.amount} on ${when}`}
              checked={entry.verified}
              onChange={() => toggleVerified(entry)}
            />
            <div className="report-row-body">
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
          </div>
        )
      })}
    </div>
  )
}
