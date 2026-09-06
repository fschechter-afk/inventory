import { useEffect, useMemo, useState } from 'react'
import { dismissSession, fetchOpenSessions, startShoppingSession } from '../api.js'
import { money, relativeTime } from '../format.js'
import { Bar, ErrorNote, Loading } from '../ui.jsx'

const CUSTOM_VENDOR = { id: null, name: 'Somewhere else', emoji: '🏬', category: 'Other' }

/** Department, store, go.
 *
 *  Everything the portal used to ask for here — a purpose, an estimate, a
 *  Shop button to confirm — is gone. The department comes pre-selected from
 *  the staff member's home department, so the common case is one tap: the
 *  store. Anything else the record needs arrives from the vendor's email or
 *  off the receipt photo. */
export default function Shop({ me, departments, vendors, settings, budgets, onRecord, onToast }) {
  const [departmentId, setDepartmentId] = useState(
    me.home_department_id || departments[0]?.id || ''
  )
  const [openSessions, setOpenSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [starting, setStarting] = useState(null)
  const [custom, setCustom] = useState(null)

  useEffect(() => {
    fetchOpenSessions(me.id)
      .then(setOpenSessions)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [me.id])

  const vendorGroups = useMemo(() => {
    const groups = []
    const byName = new Map()
    for (const vendor of vendors) {
      let group = byName.get(vendor.category)
      if (!group) {
        group = { name: vendor.category, vendors: [] }
        byName.set(vendor.category, group)
        groups.push(group)
      }
      group.vendors.push(vendor)
    }
    groups.push({ name: 'Not listed', vendors: [CUSTOM_VENDOR] })
    return groups
  }, [vendors])

  const department = departments.find((d) => d.id === departmentId)
  const budget = budgets?.find((b) => b.department_id === departmentId)
  const warnPct = settings?.budget_warn_pct ?? 80

  /** One tap: record the trip and open the store. The vendor tab opens from
   *  inside the click handler so the browser still counts it as user-initiated
   *  and does not block the popup. */
  async function go(vendor, customName) {
    const name = customName || vendor.name
    setStarting(name)
    setError(null)

    const tab = vendor.url ? window.open('', '_blank', 'noopener,noreferrer') : null
    try {
      const session = await startShoppingSession({
        staff_id: me.id,
        department_id: departmentId,
        vendor_id: vendor.id,
        vendor_name: name,
        purpose: null,
      })
      if (tab && vendor.url) tab.location = vendor.url
      setOpenSessions((prev) => [session, ...prev])
      setCustom(null)
      onToast(`${name} · ${department?.name} — photograph the receipt when you're done`)
    } catch (e) {
      if (tab) tab.close()
      setError(e)
    } finally {
      setStarting(null)
    }
  }

  async function dismiss(session) {
    setOpenSessions((prev) => prev.filter((s) => s.id !== session.id))
    try {
      await dismissSession(session.id)
    } catch (e) {
      setError(e)
    }
  }

  if (loading) return <Loading />

  return (
    <>
      <ErrorNote error={error} />

      {openSessions.length > 0 && (
        <div className="pp-card" style={{ borderTop: '3px solid var(--gold)' }}>
          <h2>Add the receipt</h2>
          <p className="pp-muted" style={{ marginTop: -4, marginBottom: 12 }}>
            Snap a photo and the portal reads the rest off it.
          </p>
          {openSessions.map((session) => (
            <div key={session.id} className="pp-spread" style={{ marginBottom: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{session.vendor_name}</div>
                <div className="pp-muted">{relativeTime(session.opened_at)}</div>
              </div>
              <div className="pp-row">
                <button className="pp-btn small" onClick={() => onRecord({ session })}>
                  📷 Receipt
                </button>
                <button className="pp-link" onClick={() => dismiss(session)}>
                  Didn&apos;t buy
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pp-card">
        <div className="pp-spread" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Paying from</h2>
          {budget && (
            <span className="pp-muted">{money(budget.remaining)} left this {budget.period.replace('ly', '')}</span>
          )}
        </div>
        <div className="pp-chips">
          {departments.map((d) => (
            <button
              key={d.id}
              className={`pp-chip ${departmentId === d.id ? 'selected' : ''}`}
              onClick={() => setDepartmentId(d.id)}
            >
              <span>{d.emoji}</span>
              {d.name}
            </button>
          ))}
        </div>
        {budget && budget.pct >= warnPct && (
          <div style={{ marginTop: 12 }}>
            <Bar
              label={budget.department_name}
              value={Number(budget.spent)}
              max={Number(budget.amount)}
              caption={`${money(budget.spent)} of ${money(budget.amount)}`}
              tone={budget.pct >= 100 ? 'over' : 'warn'}
            />
            <div className="pp-notice">
              {budget.pct >= 100
                ? `Over budget by ${money(Number(budget.spent) - Number(budget.amount))}. Check with an administrator first.`
                : `Only ${money(budget.remaining)} left in this budget.`}
            </div>
          </div>
        )}
      </div>

      <div className="pp-card">
        <h2>Tap where you&apos;re shopping</h2>
        {vendorGroups.map((group) => (
          <div key={group.name} className="pp-vendor-group">
            <h3>{group.name}</h3>
            <div className="pp-vendor-grid">
              {group.vendors.map((vendor) => (
                <button
                  key={vendor.id || vendor.name}
                  className={`pp-vendor ${starting === vendor.name ? 'selected' : ''}`}
                  disabled={!!starting}
                  onClick={() =>
                    vendor === CUSTOM_VENDOR ? setCustom({ name: '' }) : go(vendor)
                  }
                >
                  <span className="pp-vendor-emoji">{vendor.emoji || '🛒'}</span>
                  <span className="pp-vendor-name">{vendor.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {custom && (
          <div style={{ marginTop: 16 }}>
            <span className="pp-field-label">Where are you shopping?</span>
            <div className="pp-row">
              <input
                className="pp-input"
                value={custom.name}
                autoFocus
                placeholder="Ace Hardware on Devon"
                onChange={(e) => setCustom({ name: e.target.value })}
                onKeyDown={(e) =>
                  e.key === 'Enter' &&
                  custom.name.trim() &&
                  go(CUSTOM_VENDOR, custom.name.trim())
                }
              />
              <button
                className="pp-btn small"
                disabled={!custom.name.trim() || !!starting}
                onClick={() => go(CUSTOM_VENDOR, custom.name.trim())}
              >
                Go
              </button>
            </div>
          </div>
        )}

        <p className="pp-muted" style={{ marginTop: 14, marginBottom: 0 }}>
          Tapping a store opens it and starts tracking. Nothing else to fill in.
        </p>
      </div>
    </>
  )
}
