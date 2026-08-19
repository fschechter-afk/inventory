import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchCatalog, groupByCategory, submitCheck } from './supabase.js'
import { flushOutbox, outboxCount, queueCheck } from './outbox.js'
import StartScreen from './components/StartScreen.jsx'
import LogView from './components/LogView.jsx'
import ShoppingList from './components/ShoppingList.jsx'
import History from './components/History.jsx'
import FinalStep from './components/FinalStep.jsx'

const todayLine = new Date().toLocaleDateString(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

export default function App() {
  const [catalog, setCatalog] = useState(null) // flat item list from the DB
  const [catalogError, setCatalogError] = useState(null)
  const [fromCache, setFromCache] = useState(false)
  const [filledBy, setFilledBy] = useState('')
  const [started, setStarted] = useState(false)
  const [tab, setTab] = useState('log')
  const [statuses, setStatuses] = useState({}) // itemId -> {status, qty}
  const [finalOpen, setFinalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [pending, setPending] = useState(outboxCount())
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)

  const showToast = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2600)
  }, [])

  // Load the item catalog (network first, cached copy offline).
  useEffect(() => {
    fetchCatalog()
      .then(({ items, fromCache }) => {
        setCatalog(items)
        setFromCache(fromCache)
        setStatuses(Object.fromEntries(items.map((i) => [i.id, { status: 'ok', qty: null }])))
      })
      .catch((e) => setCatalogError(e.message || String(e)))
  }, [])

  // Re-send any checks that were queued while offline.
  useEffect(() => {
    const flush = () =>
      flushOutbox().then((sent) => {
        setPending(outboxCount())
        if (sent > 0) showToast(`Synced ${sent} saved check${sent === 1 ? '' : 's'}`)
      })
    flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [showToast])

  const categories = useMemo(() => (catalog ? groupByCategory(catalog) : []), [catalog])

  const counts = useMemo(() => {
    let low = 0
    let out = 0
    for (const s of Object.values(statuses)) {
      if (s.status === 'low') low++
      if (s.status === 'out') out++
    }
    return { low, out }
  }, [statuses])

  const setItemState = useCallback((id, next) => {
    setStatuses((prev) => ({ ...prev, [id]: next }))
  }, [])

  async function handleSubmit({ pantryVideoUrl, closetVideoUrl }) {
    const items = catalog.map((item) => ({
      item_id: item.id,
      item_name: item.name,
      category: item.category,
      status: statuses[item.id]?.status || 'ok',
      qty: statuses[item.id]?.status === 'low' ? statuses[item.id]?.qty ?? null : null,
    }))
    const payload = { filledBy, pantryVideoUrl, closetVideoUrl, items }

    setSubmitting(true)
    try {
      await submitCheck(payload)
      showToast('Inventory check submitted!')
    } catch (e) {
      if (navigator.onLine === false || /fetch|network/i.test(e.message || '')) {
        queueCheck(payload)
        setPending(outboxCount())
        showToast('No connection — saved on this device, will send automatically')
      } else {
        console.error('Submit failed:', e)
        showToast('Something went wrong — try again')
        setSubmitting(false)
        return
      }
    }
    // Reset for the next check.
    setStatuses(Object.fromEntries(catalog.map((i) => [i.id, { status: 'ok', qty: null }])))
    setFinalOpen(false)
    setSubmitting(false)
  }

  if (!started) {
    return (
      <>
        <StartScreen
          dateLine={todayLine}
          catalogReady={!!catalog}
          catalogError={catalogError}
          fromCache={fromCache}
          pending={pending}
          onBegin={(name) => {
            setFilledBy(name)
            setStarted(true)
          }}
        />
        <Toast msg={toast} />
      </>
    )
  }

  return (
    <>
      <header className="app-header">
        <h1>Dorm Inventory Check</h1>
        <div className="sub">{todayLine}</div>
        <div className="tabs">
          <button className={`tab ${tab === 'log' ? 'active' : ''}`} onClick={() => setTab('log')}>
            Log Inventory
          </button>
          <button
            className={`tab ${tab === 'restock' ? 'active' : ''}`}
            onClick={() => setTab('restock')}
          >
            Shopping List
          </button>
          <button
            className={`tab ${tab === 'history' ? 'active' : ''}`}
            onClick={() => setTab('history')}
          >
            History
          </button>
        </div>
      </header>

      {tab === 'log' && (
        <>
          <div className="status-bar">
            <span>Logging as {filledBy} — tap only what&apos;s changed.</span>
            <div className="counts">
              <span className="chip low">{counts.low} low</span>
              <span className="chip out">{counts.out} out</span>
            </div>
          </div>
          <LogView categories={categories} statuses={statuses} onChange={setItemState} />
          <footer className="submit-bar">
            <button className="submit-btn" onClick={() => setFinalOpen(true)}>
              Continue
            </button>
          </footer>
        </>
      )}

      {tab === 'restock' && <ShoppingList catalog={catalog} onToast={showToast} />}
      {tab === 'history' && <History />}

      {finalOpen && (
        <FinalStep
          submitting={submitting}
          onSubmit={handleSubmit}
          onBack={() => setFinalOpen(false)}
        />
      )}
      <Toast msg={toast} />
    </>
  )
}

function Toast({ msg }) {
  return <div className={`toast ${msg ? 'show' : ''}`}>{msg}</div>
}
