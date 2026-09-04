import { useMemo, useState } from 'react'
import { todayISO } from '../format.js'

const SPENT_ON = ['Food', 'Supplies', 'Kitchen', 'Other']
const MAX_AMOUNT = 100000 // matches the check constraint on the table

export default function LogPurchase({
  orderedBy,
  sites,
  defaultSite,
  returning,
  saving,
  onSave,
  onCancel,
}) {
  const today = useMemo(() => todayISO(), [])
  // A store retired (or not yet loaded) since the tile was tapped still has
  // its name — keep it as a write-in rather than losing where they went.
  const known = defaultSite?.siteId && sites.some((s) => s.id === defaultSite.siteId)
  const [siteId, setSiteId] = useState(() => (known ? defaultSite.siteId : ''))
  const [otherName, setOtherName] = useState(() => (known ? '' : defaultSite?.siteName || ''))
  const [amount, setAmount] = useState('')
  const [spentOn, setSpentOn] = useState('Food')
  const [purchasedOn, setPurchasedOn] = useState(today)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  const chosen = sites.find((s) => s.id === siteId)
  const siteName = chosen ? chosen.name : otherName.trim()

  function save() {
    if (!siteName) {
      setError('Where was it from?')
      return
    }
    const parsed = Number.parseFloat(String(amount).replace(/[^0-9.]/g, ''))
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError('Enter the total you spent, like 42.60')
      return
    }
    if (parsed > MAX_AMOUNT) {
      setError('That looks too large — check the amount')
      return
    }
    setError('')
    onSave({
      siteId: chosen ? chosen.id : null,
      siteName,
      amount: Math.round(parsed * 100) / 100,
      spentOn,
      notes: notes.trim(),
      purchasedOn,
    })
  }

  return (
    <div className="screen overlay">
      <div className="start-card">
        <h1>{returning ? `Back from ${defaultSite.siteName}?` : 'Log a purchase'}</h1>
        <div className="start-sub">
          {returning
            ? 'If you ordered, put the total in — it takes five seconds.'
            : `Anything bought for the school, by ${orderedBy}.`}
        </div>

        <label className="field-label" htmlFor="site">
          Where from
        </label>
        <select
          id="site"
          className="select-input"
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
        >
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
          <option value="">Somewhere else…</option>
        </select>
        {!chosen && (
          <input
            type="text"
            placeholder="Store or supplier name"
            value={otherName}
            onChange={(e) => setOtherName(e.target.value)}
          />
        )}

        <label className="field-label" htmlFor="amount">
          Total spent
        </label>
        <div className="amount-wrap">
          <span className="amount-prefix">$</span>
          <input
            id="amount"
            className="amount-input"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            autoFocus
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
        </div>

        <label className="field-label">What for</label>
        <div className="chip-row">
          {SPENT_ON.map((option) => (
            <button
              key={option}
              className={`choice-chip ${spentOn === option ? 'active' : ''}`}
              onClick={() => setSpentOn(option)}
            >
              {option}
            </button>
          ))}
        </div>

        <label className="field-label" htmlFor="purchasedOn">
          Date
        </label>
        <input
          id="purchasedOn"
          type="date"
          max={today}
          value={purchasedOn}
          onChange={(e) => setPurchasedOn(e.target.value)}
        />

        <label className="field-label" htmlFor="notes">
          Notes (optional)
        </label>
        <input
          id="notes"
          type="text"
          placeholder="What it was for, order number…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />

        {error && <div className="conn-status fail">{error}</div>}

        <button className="submit-btn" disabled={saving} onClick={save}>
          {saving ? 'Saving…' : 'Save purchase'}
        </button>
        <button className="back-link" onClick={onCancel} disabled={saving}>
          {returning ? "I didn't order anything" : 'Cancel'}
        </button>
      </div>
    </div>
  )
}
