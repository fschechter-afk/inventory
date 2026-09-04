import { useMemo, useState } from 'react'
import { todayISO } from '../format.js'
import { parseReceipt } from '../receipt.js'

const SPENT_ON = ['Food', 'Supplies', 'Kitchen', 'Other']
const MAX_AMOUNT = 100000 // matches the check constraint on the table

export default function LogPurchase({
  orderedBy,
  sites,
  defaultSite,
  prefill,
  returning,
  saving,
  onSave,
  onCancel,
}) {
  const today = useMemo(() => todayISO(), [])
  // A store retired (or not yet loaded) since the tile was tapped still has
  // its name — keep it as a write-in rather than losing where they went.
  const known = defaultSite?.siteId && sites.some((s) => s.id === defaultSite.siteId)
  const [siteId, setSiteId] = useState(() => prefill?.siteId || (known ? defaultSite.siteId : ''))
  const [otherName, setOtherName] = useState(() =>
    prefill?.siteId ? '' : prefill?.siteName || (known ? '' : defaultSite?.siteName || '')
  )
  const [amount, setAmount] = useState(() =>
    prefill?.amount != null ? prefill.amount.toFixed(2) : ''
  )
  const [spentOn, setSpentOn] = useState('Food')
  const [purchasedOn, setPurchasedOn] = useState(() => prefill?.purchasedOn || today)
  const [notes, setNotes] = useState(() => (prefill?.orderNumber ? `Order ${prefill.orderNumber}` : ''))
  const [error, setError] = useState('')

  // Reading the receipt instead of retyping it
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteNote, setPasteNote] = useState('')
  const [readSummary, setReadSummary] = useState(() =>
    prefill?.found?.length ? prefill.found.join(' · ') : ''
  )

  const chosen = sites.find((s) => s.id === siteId)
  const siteName = chosen ? chosen.name : otherName.trim()

  /** Put whatever the parser found into the form. Nothing is saved until the
   *  person looks at it and taps save. */
  function apply(result) {
    if (!result || (result.amount == null && !result.siteName && !result.purchasedOn)) {
      setPasteNote("Couldn't find a total in that — check it's the whole email.")
      return false
    }
    if (result.siteId) {
      setSiteId(result.siteId)
      setOtherName('')
    } else if (result.siteName) {
      setSiteId('')
      setOtherName(result.siteName)
    }
    if (result.amount != null) setAmount(result.amount.toFixed(2))
    if (result.purchasedOn) setPurchasedOn(result.purchasedOn)
    if (result.orderNumber && !notes.trim()) setNotes(`Order ${result.orderNumber}`)
    setReadSummary(result.found.join(' · '))
    setPasteNote('')
    setError('')
    return true
  }

  function readText(text) {
    if (!text || !text.trim()) {
      setPasteNote('Nothing to read yet — paste the email in the box.')
      return false
    }
    return apply(parseReceipt(text, sites))
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText()
      if (text && text.trim()) {
        if (readText(text)) {
          setPasteOpen(false)
          return
        }
      } else {
        setPasteNote('Clipboard looks empty — paste the email below instead.')
      }
    } catch {
      // Safari and any browser without clipboard permission land here.
      setPasteNote('Paste the confirmation email in the box below.')
    }
    setPasteOpen(true)
  }

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
            ? "Paste the confirmation email and it fills itself in."
            : `Anything bought for the school, by ${orderedBy}.`}
        </div>

        <div className="paste-zone">
          <button className="paste-btn" onClick={pasteFromClipboard}>
            📋 Paste receipt — read the total for me
          </button>
          {!pasteOpen && !readSummary && (
            <button className="paste-toggle" onClick={() => setPasteOpen(true)}>
              or paste it into a box
            </button>
          )}
          {pasteNote && <div className="paste-note">{pasteNote}</div>}
          {pasteOpen && (
            <>
              <textarea
                className="paste-area"
                rows={4}
                placeholder="Paste the whole confirmation email here…"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                onPaste={(e) => {
                  const text = e.clipboardData.getData('text')
                  if (text && text.trim()) {
                    setPasteText(text)
                    e.preventDefault()
                    if (readText(text)) setPasteOpen(false)
                  }
                }}
              />
              <button className="paste-toggle" onClick={() => readText(pasteText)}>
                Read it
              </button>
            </>
          )}
          {readSummary && (
            <div className="paste-found">
              ✅ Read from the receipt: <strong>{readSummary}</strong> — check it below.
            </div>
          )}
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
