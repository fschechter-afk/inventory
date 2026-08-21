import { useState } from 'react'

export default function StartScreen({ categoriesReady, categoriesError, fromCache, pending, onBegin }) {
  const [name, setName] = useState('')

  let statusClass = 'conn-status'
  let statusText = 'Checking connection…'
  if (categoriesError) {
    statusClass += ' fail'
    statusText = `❌ Couldn't load categories: ${categoriesError}`
  } else if (categoriesReady && fromCache) {
    statusText = '📴 Offline — using the saved category list. Entries will sync when back online.'
  } else if (categoriesReady) {
    statusClass += ' ok'
    statusText = '✅ Connected — ready to log.'
  }

  function begin() {
    const trimmed = name.trim()
    if (!trimmed) return
    onBegin(trimmed)
  }

  return (
    <div className="screen">
      <div className="start-card">
        <h1>Dorm Spending</h1>
        <div className="start-sub">Log a purchase in a few taps</div>
        <div className={statusClass}>{statusText}</div>
        {pending > 0 && (
          <div className="conn-status">
            ⏳ {pending} saved entr{pending === 1 ? 'y' : 'ies'} waiting to send.
          </div>
        )}
        <label className="field-label" htmlFor="filledBy">
          Your name
        </label>
        <input
          id="filledBy"
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && begin()}
        />
        <button className="submit-btn" disabled={!categoriesReady || !name.trim()} onClick={begin}>
          Start Logging
        </button>
      </div>
    </div>
  )
}
