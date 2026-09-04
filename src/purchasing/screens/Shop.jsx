import { useEffect, useMemo, useState } from 'react'
import {
  dismissSession,
  fetchOpenSessions,
  startShoppingSession,
} from '../api.js'
import { money, relativeTime, toNumber } from '../format.js'
import { Field, Loading, ErrorNote, Bar } from '../ui.jsx'

const CUSTOM_VENDOR = { id: null, name: 'Other / custom vendor', emoji: '🏬', category: 'Other' }

/** The whole point of the portal: department → store → purpose → Shop.
 *  Vendors do not report purchases back to us, so tapping Shop records a
 *  shopping session — who went where, for which budget, and why — and the
 *  order details are filled in on the way back. */
export default function Shop({ me, departments, vendors, settings, budgets, onRecord, onToast }) {
  const [departmentId, setDepartmentId] = useState(me.home_department_id || '')
  const [vendor, setVendor] = useState(null)
  const [customVendor, setCustomVendor] = useState({ name: '', url: '' })
  const [purpose, setPurpose] = useState('')
  const [estimate, setEstimate] = useState('')
  const [openSessions, setOpenSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchOpenSessions(me.id)
      .then(setOpenSessions)
      .catch(setError)
      .finally(() => setLoading(false))
  }, [me.id])

  const vendorGroups = useMemo(() => {
    const groups = []
    const byName = new Map()
    for (const v of vendors) {
      let group = byName.get(v.category)
      if (!group) {
        group = { name: v.category, vendors: [] }
        byName.set(v.category, group)
        groups.push(group)
      }
      group.vendors.push(v)
    }
    groups.push({ name: 'Something else', vendors: [CUSTOM_VENDOR] })
    return groups
  }, [vendors])

  const department = departments.find((d) => d.id === departmentId)
  const isCustom = vendor === CUSTOM_VENDOR
  const vendorName = isCustom ? customVendor.name.trim() : vendor?.name
  const limit = me.auto_approve_limit ?? settings?.approval_threshold ?? 0
  const estimateValue = toNumber(estimate)
  const needsApproval = estimateValue != null && estimateValue > limit
  const budget = budgets?.find((b) => b.department_id === departmentId)

  const ready = departmentId && vendorName && purpose.trim().length > 1

  async function go() {
    setBusy(true)
    setError(null)
    try {
      const session = await startShoppingSession({
        staff_id: me.id,
        department_id: departmentId,
        vendor_id: isCustom ? null : vendor.id,
        vendor_name: vendorName,
        purpose: purpose.trim(),
        estimated_total: estimateValue,
      })

      if (needsApproval) {
        onRecord({ session, vendor, requestApproval: true, estimate: estimateValue })
        return
      }

      const url = isCustom ? customVendor.url.trim() : vendor.url
      if (url) window.open(url, '_blank', 'noopener,noreferrer')
      setOpenSessions((prev) => [session, ...prev])
      setPurpose('')
      setEstimate('')
      setVendor(null)
      onToast(url ? `Shopping at ${vendorName} — record the order when you're done` : 'Trip started')
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
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
          <h2>Finish recording</h2>
          <p className="pp-muted" style={{ marginTop: -4, marginBottom: 12 }}>
            You started these trips but haven&apos;t recorded what you bought.
          </p>
          {openSessions.map((s) => (
            <div key={s.id} className="pp-spread" style={{ marginBottom: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: '0.88rem' }}>{s.vendor_name}</div>
                <div className="pp-muted">
                  {s.purpose} · {relativeTime(s.opened_at)}
                </div>
              </div>
              <div className="pp-row">
                <button className="pp-btn small" onClick={() => onRecord({ session: s })}>
                  Record
                </button>
                <button className="pp-link" onClick={() => dismiss(s)}>
                  Didn&apos;t buy
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pp-card">
        <h2>
          <span className="pp-step-num">1</span>Who is this for?
        </h2>
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
        {budget && (
          <div style={{ marginTop: 14 }}>
            <Bar
              label={`${budget.department_name} budget, this ${budget.period.replace('ly', '')}`}
              value={Number(budget.spent)}
              max={Number(budget.amount)}
              caption={`${money(budget.spent)} of ${money(budget.amount)}`}
              tone={budget.pct >= 100 ? 'over' : budget.pct >= (settings?.budget_warn_pct ?? 80) ? 'warn' : 'ok'}
            />
            {budget.pct >= 100 ? (
              <div className="pp-notice">
                This department is over budget by {money(Number(budget.spent) - Number(budget.amount))}.
                Check with an administrator before buying more.
              </div>
            ) : budget.pct >= (settings?.budget_warn_pct ?? 80) ? (
              <div className="pp-notice">
                Only {money(budget.remaining)} left in this budget.
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="pp-card">
        <h2>
          <span className="pp-step-num">2</span>Where are you shopping?
        </h2>
        {vendorGroups.map((group) => (
          <div key={group.name} className="pp-vendor-group">
            <h3>{group.name}</h3>
            <div className="pp-vendor-grid">
              {group.vendors.map((v) => (
                <button
                  key={v.id || v.name}
                  className={`pp-vendor ${vendor === v ? 'selected' : ''}`}
                  onClick={() => setVendor(v)}
                >
                  <span className="pp-vendor-emoji">{v.emoji || '🛒'}</span>
                  <span className="pp-vendor-name">{v.name}</span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {isCustom && (
          <div style={{ marginTop: 14 }}>
            <Field label="Store name">
              <input
                className="pp-input"
                value={customVendor.name}
                onChange={(e) => setCustomVendor({ ...customVendor, name: e.target.value })}
                placeholder="Ace Hardware on Devon"
              />
            </Field>
            <Field label="Website (optional)" hint="Leave blank for an in-person purchase.">
              <input
                className="pp-input"
                type="url"
                value={customVendor.url}
                onChange={(e) => setCustomVendor({ ...customVendor, url: e.target.value })}
                placeholder="https://"
              />
            </Field>
          </div>
        )}

        {vendor?.account_hint && (
          <div className="pp-notice info" style={{ marginTop: 12 }}>
            {vendor.account_hint}
          </div>
        )}
      </div>

      <div className="pp-card">
        <h2>
          <span className="pp-step-num">3</span>What&apos;s it for?
        </h2>
        <Field label="Purpose">
          <input
            className="pp-input"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Shabbos food for the dorm"
          />
        </Field>
        <Field
          label="About how much? (optional)"
          hint={`Purchases over ${money(limit)} need approval before you shop.`}
        >
          <input
            className="pp-input"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
            placeholder="0.00"
          />
        </Field>

        {needsApproval && (
          <div className="pp-notice">
            {money(estimateValue)} is over your {money(limit)} limit, so this goes to
            {department ? ` the ${department.name} manager` : ' a manager'} for approval first.
          </div>
        )}

        <button className="pp-btn gold" disabled={!ready || busy} onClick={go}>
          {busy
            ? 'One moment…'
            : needsApproval
              ? 'Request approval'
              : vendorName
                ? `Shop at ${vendorName} →`
                : 'Shop →'}
        </button>
      </div>
    </>
  )
}
