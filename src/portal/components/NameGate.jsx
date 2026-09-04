import { useState } from 'react'

export default function NameGate({ dateLine, sitesReady, sitesError, fromCache, pending, onContinue }) {
  const [name, setName] = useState('')

  let statusClass = 'conn-status'
  let statusText = 'Loading the store list…'
  if (sitesError) {
    statusClass += ' fail'
    statusText = `❌ Couldn't load the store list: ${sitesError}`
  } else if (sitesReady && fromCache) {
    statusText = '📴 Offline — using the saved store list. Purchases will sync when back online.'
  } else if (sitesReady) {
    statusClass += ' ok'
    statusText = '✅ Connected — ready to order.'
  }

  function go() {
    const trimmed = name.trim()
    if (!trimmed) return
    onContinue(trimmed)
  }

  return (
    <div className="screen">
      <div className="start-card">
        <h1>School Ordering Portal</h1>
        <div className="start-sub">{dateLine}</div>
        <p className="gate-blurb">
          Order food and supplies for the school from here, then log what you spent. Everything
          bought for the school ends up in one place — who ordered it, when, and how much.
        </p>
        <div className={statusClass}>{statusText}</div>
        {pending > 0 && (
          <div className="conn-status">
            ⏳ {pending} purchase{pending === 1 ? '' : 's'} waiting to send.
          </div>
        )}
        <label className="field-label" htmlFor="orderedBy">
          Your name
        </label>
        <input
          id="orderedBy"
          type="text"
          placeholder="Who's ordering?"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
        />
        <button className="submit-btn" disabled={!name.trim()} onClick={go}>
          Start Ordering
        </button>
        <div className="gate-note">Saved on this device — you only type it once.</div>
      </div>
    </div>
  )
}
