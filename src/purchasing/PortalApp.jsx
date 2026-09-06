import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase.js'
import {
  fetchBudgetStatus,
  fetchDepartments,
  fetchMe,
  fetchSettings,
  fetchStaff,
  fetchVendors,
  signOut,
} from './api.js'
import { ErrorNote, Loading, Toast } from './ui.jsx'
import SignIn from './SignIn.jsx'
import Shop from './screens/Shop.jsx'
import MyOrders from './screens/MyOrders.jsx'
import OrderForm from './screens/OrderForm.jsx'
import Approvals from './screens/Approvals.jsx'
import Dashboard from './screens/Dashboard.jsx'
import Orders from './screens/Orders.jsx'
import Items from './screens/Items.jsx'
import Reports from './screens/Reports.jsx'
import Admin from './screens/Admin.jsx'

const TAB_TITLES = {
  shop: 'LGHS Shopping Portal',
  mine: 'My purchases',
  items: 'Item history',
  approvals: 'Approvals',
  dashboard: 'Dashboard',
  orders: 'All purchases',
  reports: 'Reports',
  admin: 'Administration',
}

export default function PortalApp() {
  const [session, setSession] = useState(undefined) // undefined = still checking
  const [me, setMe] = useState(null)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [tab, setTab] = useState('shop')
  const [orderFilters, setOrderFilters] = useState({})
  const [form, setForm] = useState(null) // { purchaseId } | { session, requestApproval }
  const [refreshKey, setRefreshKey] = useState(0)
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)

  const showToast = useCallback((message) => {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2800)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        setMe(null)
        setData(null)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const loadEverything = useCallback(async () => {
    setError(null)
    try {
      const profile = await fetchMe()
      setMe(profile)
      if (!profile || profile.noAccess) return

      const isAdmin = ['admin', 'super_admin'].includes(profile.role)
      const [settings, departments, vendors, budgets, allDepartments, allVendors, staff] =
        await Promise.all([
          fetchSettings(),
          fetchDepartments(),
          fetchVendors(),
          fetchBudgetStatus(),
          isAdmin ? fetchDepartments(true) : Promise.resolve(null),
          isAdmin ? fetchVendors(true) : Promise.resolve(null),
          isAdmin ? fetchStaff() : Promise.resolve([]),
        ])
      setData({
        settings,
        departments,
        vendors,
        budgets,
        allDepartments: allDepartments || departments,
        allVendors: allVendors || vendors,
        staff,
      })
    } catch (e) {
      setError(e)
    }
  }, [])

  useEffect(() => {
    if (session) loadEverything()
  }, [session, loadEverything])

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1)
    // Budgets move with every purchase, so they are re-read rather than cached.
    fetchBudgetStatus()
      .then((budgets) => setData((d) => (d ? { ...d, budgets } : d)))
      .catch(() => {})
  }, [])

  const goTo = useCallback((next, filters) => {
    setOrderFilters(filters || {})
    setTab(next)
    window.scrollTo(0, 0)
  }, [])

  if (session === undefined) return <Loading label="Checking your sign-in…" />
  if (!session) return <SignIn onSignedIn={loadEverything} />
  if (error) {
    return (
      <div className="pp-main">
        <ErrorNote error={error} onRetry={loadEverything} />
        <button className="pp-btn ghost" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    )
  }
  if (!me) return <Loading />
  if (me.noAccess) return <NoAccess email={me.email} />
  if (!data) return <Loading />

  const isAdmin = ['admin', 'super_admin'].includes(me.role)
  const canApprove = isAdmin || me.managedDepartmentIds?.length > 0
  const tabs = [
    { key: 'shop', icon: '🛒', label: 'Shop' },
    { key: 'mine', icon: '🧾', label: 'Mine' },
    { key: 'items', icon: '📦', label: 'Items' },
    canApprove && { key: 'approvals', icon: '✅', label: 'Approve' },
    (canApprove || isAdmin) && { key: 'dashboard', icon: '📊', label: 'Spending' },
    isAdmin && { key: 'admin', icon: '⚙️', label: 'Admin' },
  ].filter(Boolean)

  const openOrder = (order) => setForm({ purchaseId: order.id })

  return (
    <div className="pp">
      <header className="pp-header">
        <h1>
          {TAB_TITLES[tab]}
          <span className="pp-who">
            {me.full_name}
            {me.role !== 'employee' && ` · ${me.role.replace('_', ' ')}`}
          </span>
        </h1>
        {tab === 'dashboard' && isAdmin && (
          <button className="pp-header-btn" onClick={() => goTo('reports')}>
            Reports
          </button>
        )}
        <button className="pp-header-btn" onClick={() => signOut()}>
          Sign out
        </button>
      </header>

      <main className={`pp-main ${['orders', 'reports', 'items'].includes(tab) ? 'wide' : ''}`}>
        {tab === 'shop' && (
          <Shop
            me={me}
            departments={data.departments}
            vendors={data.vendors}
            settings={data.settings}
            budgets={data.budgets}
            onRecord={(payload) => setForm(payload)}
            onToast={showToast}
          />
        )}
        {tab === 'mine' && <MyOrders me={me} onOpen={openOrder} refreshKey={refreshKey} />}
        {tab === 'items' && (
          <Items
            departments={data.allDepartments}
            vendors={data.allVendors}
            staff={data.staff}
            canSeeOthers={canApprove}
            onOpenPurchase={openOrder}
            refreshKey={refreshKey}
          />
        )}
        {tab === 'approvals' && (
          <Approvals
            onOpen={openOrder}
            onDecided={refresh}
            onToast={showToast}
            refreshKey={refreshKey}
          />
        )}
        {tab === 'dashboard' && (
          <Dashboard
            budgets={data.budgets}
            settings={data.settings}
            onOpen={openOrder}
            onNavigate={goTo}
            refreshKey={refreshKey}
          />
        )}
        {tab === 'orders' && (
          <Orders
            departments={data.allDepartments}
            vendors={data.allVendors}
            staff={data.staff}
            initialFilters={orderFilters}
            onOpen={openOrder}
            refreshKey={refreshKey}
          />
        )}
        {tab === 'reports' && <Reports budgets={data.budgets} />}
        {tab === 'admin' && (
          <Admin
            me={me}
            data={{ ...data, refreshKey }}
            onChanged={() => {
              loadEverything()
              refresh()
            }}
            onToast={showToast}
          />
        )}
      </main>

      <nav className="pp-nav">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={
              tab === t.key || (['orders', 'reports'].includes(tab) && t.key === 'dashboard')
                ? 'active'
                : ''
            }
            onClick={() => goTo(t.key)}
          >
            <span className="pp-nav-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>

      {form && (
        <OrderForm
          me={me}
          departments={data.departments}
          vendors={data.vendors}
          settings={data.settings}
          purchaseId={form.purchaseId}
          session={form.session}
          requestApproval={form.requestApproval}
          onClose={() => setForm(null)}
          onSaved={refresh}
          onToast={showToast}
        />
      )}

      <Toast message={toast} />
    </div>
  )
}

function NoAccess({ email }) {
  return (
    <div className="pp-signin">
      <div className="pp-signin-card">
        <h1>Not set up yet</h1>
        <p className="pp-signin-sub">
          {email} is signed in, but it has no purchasing access.
        </p>
        <p className="pp-muted" style={{ lineHeight: 1.6, textAlign: 'center' }}>
          Ask an administrator to invite this exact email address from the portal&apos;s Admin
          screen, then sign in again.
        </p>
        <button className="pp-btn ghost" style={{ marginTop: 18 }} onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    </div>
  )
}
