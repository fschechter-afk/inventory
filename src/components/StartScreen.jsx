import { useState } from 'react'

export default function StartScreen({
  dateLine,
  catalogReady,
  catalogError,
  fromCache,
  pending,
  onBegin,
}) {
  const [name, setName] = useState('')

  let statusClass = 'conn-status'
  let statusText = 'Checking connection…'
  if (catalogError) {
    statusClass += ' fail'
    statusText = `❌ Couldn't load the item list: ${catalogError}`
  } else if (catalogReady && fromCache) {
    statusText = '📴 Offline — using the saved item list. Checks will sync when back online.'
  } else if (catalogReady) {
    statusClass += ' ok'
    statusText = '✅ Connected — ready to save.'
  }

  function begin() {
    const trimmed = name.trim()
    if (!trimmed) return
    onBegin(trimmed)
  }

  return (
    <div className="screen">
      <div className="start-card">
        <h1>Dorm Inventory Check</h1>
        <div className="start-sub">{dateLine}</div>
        <div className={statusClass}>{statusText}</div>
        {pending > 0 && (
          <div className="conn-status">
            ⏳ {pending} saved check{pending === 1 ? '' : 's'} waiting to send.
          </div>
        )}
        <label className="field-label" htmlFor="filledBy">
          Filled out by
        </label>
        <input
          id="filledBy"
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && begin()}
        />
        <button className="submit-btn" disabled={!catalogReady || !name.trim()} onClick={begin}>
          Begin Inventory Check
        </button>
        <a className="back-link" href="#/shop">
          Need to buy something? Open the LGHS Shopping Portal →
        </a>
      </div>
    </div>
  )
}
