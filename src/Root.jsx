import { lazy, Suspense, useEffect, useState } from 'react'
import App from './App.jsx'

// The Shopping Portal is a separate app that happens to ship in the same
// bundle, so it is loaded only when someone actually opens #/shop. Routing is
// hash-based because this is served from GitHub Pages, which has no way to
// rewrite deep links back to index.html.
const PortalApp = lazy(() => import('./purchasing/PortalApp.jsx'))

const isPortal = () => window.location.hash.replace(/^#/, '').startsWith('/shop')

export default function Root() {
  const [portal, setPortal] = useState(isPortal)

  useEffect(() => {
    const onHashChange = () => setPortal(isPortal())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    document.title = portal ? 'LGHS Shopping Portal' : 'LGHS Dorm Inventory'
  }, [portal])

  if (!portal) return <App />
  return (
    <Suspense fallback={<div className="pp-loading">Loading the portal…</div>}>
      <PortalApp />
    </Suspense>
  )
}
