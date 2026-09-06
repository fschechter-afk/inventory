import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchSites, groupSitesByCategory, logPurchase, recordOrderIntent } from './api.js'
import { parseReceipt } from './receipt.js'
import { flushOutbox, outboxCount, queuePurchase } from '../outbox.js'
import { money } from './format.js'
import NameGate from './components/NameGate.jsx'
import NeedsPanel from './components/NeedsPanel.jsx'
import SiteGrid from './components/SiteGrid.jsx'
import LogPurchase from './components/LogPurchase.jsx'
import Spending from './components/Spending.jsx'

const NAME_KEY = 'portal.orderedBy.v1'
const TRIP_KEY = 'portal.pendingTrip.v1'

// A "trip" is a store someone opened from the portal but hasn't logged yet.
// It survives the tab being closed, so the prompt still catches them the next
// time they come back. After a week it's stale — drop it rather than ask
// about an order nobody remembers.
const TRIP_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
// Ignore the first moments after a tile is tapped: opening the store steals
// and returns focus, and prompting then would beat them to the store.
const TRIP_MIN_AGE_MS = 3000

function readTrip() {
  try {
    const trip = JSON.parse(localStorage.getItem(TRIP_KEY))
    if (!trip || !trip.siteName) return null
    if (Date.now() - trip.at > TRIP_MAX_AGE_MS) {
      localStorage.removeItem(TRIP_KEY)
      return null
    }
    return trip
  } catch {
    return null
  }
}

function clearTrip() {
  localStorage.removeItem(TRIP_KEY)
}

/** An installed portal registers as a share target, so a confirmation email
 *  can be shared straight into it. The text arrives as query parameters. */
function readSharedText() {
  const p = new URLSearchParams(window.location.search)
  return [p.get('share_title'), p.get('share_text'), p.get('share_url')]
    .filter(Boolean)
    .join('\n')
}

const todayLine = new Date().toLocaleDateString(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

export default function Portal() {
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) || '')
  const [sites, setSites] = useState(null)
  const [sitesError, setSitesError] = useState(null)
  const [fromCache, setFromCache] = useState(false)
  const [tab, setTab] = useState('order')
  const [logging, setLogging] = useState(null) // {site, returning} while the form is open
  const [saving, setSaving] = useState(false)
  const [pending, setPending] = useState(() => outboxCount('purchase'))
  const [reloadKey, setReloadKey] = useState(0)
  const [sharedText, setSharedText] = useState(readSharedText)
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)

  const showToast = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 3000)
  }, [])

  // Load the store list (network first, cached copy offline).
  useEffect(() => {
    fetchSites()
      .then(({ sites, fromCache }) => {
        setSites(sites)
        setFromCache(fromCache)
      })
      .catch((e) => setSitesError(e.message || String(e)))
  }, [])

  // Re-send anything queued while offline.
  useEffect(() => {
    const flush = () =>
      flushOutbox().then((sent) => {
        setPending(outboxCount('purchase'))
        if (sent > 0) {
          setReloadKey((k) => k + 1)
          showToast(`Synced ${sent} saved purchase${sent === 1 ? '' : 's'}`)
        }
      })
    flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [showToast])

  // Coming back from a store: ask what was spent, while it's fresh.
  useEffect(() => {
    if (!name) return
    const check = () => {
      if (document.visibilityState !== 'visible') return
      setLogging((open) => {
        if (open) return open
        const trip = readTrip()
        if (!trip || Date.now() - trip.at < TRIP_MIN_AGE_MS) return open
        return { site: trip, returning: true }
      })
    }
    check()
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [name])

  // A shared receipt opens the form with the store, total and date already
  // read out of it. Waits for the store list so the store can be matched.
  useEffect(() => {
    if (!sharedText) return
    window.history.replaceState({}, '', window.location.pathname)
    if (!name || (sites === null && !sitesError)) return
    setLogging({ site: null, returning: false, prefill: parseReceipt(sharedText, sites || []) })
    setSharedText('')
  }, [sharedText, name, sites, sitesError])

  const categories = useMemo(() => (sites ? groupSitesByCategory(sites) : []), [sites])

  function saveName(entered) {
    localStorage.setItem(NAME_KEY, entered)
    setName(entered)
  }

  function switchUser() {
    localStorage.removeItem(NAME_KEY)
    setName('')
    setLogging(null)
  }

  function openSite(site) {
    localStorage.setItem(
      TRIP_KEY,
      JSON.stringify({ siteId: site.id, siteName: site.name, url: site.url, at: Date.now() })
    )
    // Tell the database who's going where, so an imported confirmation can be
    // credited without anyone claiming it. Never block opening the store on it.
    if (site.auto_import) {
      recordOrderIntent({ orderedBy: name, siteId: site.id, siteName: site.name }).catch((e) =>
        console.warn('Could not record who is ordering:', e)
      )
    }
    window.open(site.url, '_blank', 'noopener,noreferrer')
  }

  // Shops visited in person have no website worth opening — tapping one is a
  // request to log the receipt.
  function logForSite(site) {
    setLogging({ site: { siteId: site.id, siteName: site.name }, returning: false })
  }

  function dismissTrip() {
    clearTrip()
    setLogging(null)
  }

  async function handleSave(entry) {
    const payload = { orderedBy: name, ...entry }
    setSaving(true)
    try {
      await logPurchase(payload)
      showToast(`Logged ${money(payload.amount)} at ${payload.siteName}`)
      setReloadKey((k) => k + 1)
    } catch (e) {
      if (navigator.onLine === false || /fetch|network/i.test(e.message || '')) {
        queuePurchase(payload)
        setPending(outboxCount('purchase'))
        showToast('No connection — saved on this device, will send automatically')
      } else {
        console.error('Logging the purchase failed:', e)
        showToast('Something went wrong — try again')
        setSaving(false)
        return
      }
    }
    clearTrip()
    setLogging(null)
    setSaving(false)
  }

  if (!name) {
    return (
      <>
        <NameGate
          dateLine={todayLine}
          sitesReady={!!sites}
          sitesError={sitesError}
          fromCache={fromCache}
          pending={pending}
          onContinue={saveName}
        />
        <Toast msg={toast} />
      </>
    )
  }

  return (
    <>
      <header className="app-header">
        <h1>School Ordering Portal</h1>
        <div className="sub">
          {todayLine} · Ordering as {name}{' '}
          <button className="link-btn" onClick={switchUser}>
            not you?
          </button>
        </div>
        <div className="tabs">
          <button
            className={`tab ${tab === 'order' ? 'active' : ''}`}
            onClick={() => setTab('order')}
          >
            Order
          </button>
          <button
            className={`tab ${tab === 'spending' ? 'active' : ''}`}
            onClick={() => setTab('spending')}
          >
            Spending
          </button>
        </div>
      </header>

      {pending > 0 && (
        <div className="status-bar">
          <span>
            ⏳ {pending} purchase{pending === 1 ? '' : 's'} saved on this device, waiting to send.
          </span>
        </div>
      )}

      {tab === 'order' && (
        <main className="portal-view">
          <NeedsPanel />
          {sitesError && !sites && (
            <div className="conn-status fail">Couldn&apos;t load the store list: {sitesError}</div>
          )}
          {fromCache && (
            <div className="conn-status">
              📴 Offline — showing the saved store list. Purchases will send when you&apos;re back
              online.
            </div>
          )}
          <SiteGrid categories={categories} onOpen={openSite} onLog={logForSite} />
          <button
            className="ghost-btn"
            onClick={() => setLogging({ site: null, returning: false })}
          >
            + Log a purchase from somewhere else
          </button>
          <p className="portal-foot">
            Order through here so every purchase gets counted. After you check out, come back and
            enter the total.
          </p>
        </main>
      )}

      {tab === 'spending' && (
        <Spending reloadKey={reloadKey} orderedBy={name} onToast={showToast} />
      )}

      {logging && (
        <LogPurchase
          orderedBy={name}
          sites={sites || []}
          defaultSite={logging.site}
          prefill={logging.prefill}
          returning={logging.returning}
          saving={saving}
          onSave={handleSave}
          onCancel={logging.returning ? dismissTrip : () => setLogging(null)}
        />
      )}
      <Toast msg={toast} />
    </>
  )
}

function Toast({ msg }) {
  return <div className={`toast ${msg ? 'show' : ''}`}>{msg}</div>
}
