import { useEffect, useMemo, useState } from 'react'
import { claimPurchase, fetchPurchases, voidPurchase } from '../api.js'
import { dayLabel, money, monthStartISO } from '../format.js'

const UNASSIGNED = 'Unassigned'

const PERIODS = [
  { key: 'month', label: 'This month' },
  { key: 'last', label: 'Last month' },
  { key: 'all', label: 'All time' },
]

export default function Spending({ reloadKey, orderedBy, onToast }) {
  const [period, setPeriod] = useState('month')
  const [person, setPerson] = useState('everyone')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [localReload, setLocalReload] = useState(0)

  useEffect(() => {
    let alive = true
    setRows(null)
    setError('')
    const since = period === 'all' ? null : monthStartISO(period === 'last' ? 1 : 0)
    fetchPurchases({ since })
      .then((data) => {
        if (!alive) return
        // "Last month" is everything from its first day up to this month's.
        const cutoff = monthStartISO(0)
        setRows(period === 'last' ? data.filter((r) => r.purchased_on < cutoff) : data)
      })
      .catch((e) => {
        if (!alive) return
        setError(e.message || String(e))
        setRows([])
      })
    return () => {
      alive = false
    }
  }, [period, reloadKey, localReload])

  const people = useMemo(() => {
    const names = new Set((rows || []).map((r) => r.ordered_by))
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [rows])

  const visible = useMemo(
    () => (rows || []).filter((r) => person === 'everyone' || r.ordered_by === person),
    [rows, person]
  )

  const total = useMemo(
    () => visible.reduce((sum, r) => (r.voided ? sum : sum + Number(r.amount)), 0),
    [visible]
  )

  const byPerson = useMemo(() => {
    const totals = new Map()
    for (const r of rows || []) {
      if (r.voided) continue
      totals.set(r.ordered_by, (totals.get(r.ordered_by) || 0) + Number(r.amount))
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])

  const unclaimed = useMemo(
    () => (rows || []).filter((r) => r.ordered_by === UNASSIGNED && !r.voided).length,
    [rows]
  )

  const days = useMemo(() => {
    const out = []
    const byDate = new Map()
    for (const r of visible) {
      let day = byDate.get(r.purchased_on)
      if (!day) {
        day = { date: r.purchased_on, rows: [] }
        byDate.set(r.purchased_on, day)
        out.push(day)
      }
      day.rows.push(r)
    }
    return out
  }, [visible])

  function copyCsv() {
    const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [['Date', 'Person', 'Store', 'Amount', 'For', 'Notes', 'Voided'].join(',')]
    for (const r of visible) {
      lines.push(
        [
          cell(r.purchased_on),
          cell(r.ordered_by),
          cell(r.site_name),
          cell(Number(r.amount).toFixed(2)),
          cell(r.spent_on),
          cell(r.notes),
          cell(r.voided ? 'yes' : ''),
        ].join(',')
      )
    }
    navigator.clipboard
      .writeText(lines.join('\n'))
      .then(() => onToast('Copied as a spreadsheet — paste into Sheets or Excel'))
      .catch(() => onToast("Couldn't copy — try selecting the text manually"))
  }

  async function claim(row) {
    try {
      const ok = await claimPurchase(row.id, orderedBy)
      setLocalReload((k) => k + 1)
      onToast(ok ? `Yours — ${row.site_name} logged to ${orderedBy}` : 'Someone already claimed that one')
    } catch (e) {
      console.error('Claiming the purchase failed:', e)
      onToast("Couldn't do that — are you online?")
    }
  }

  async function strike(row) {
    const ok = window.confirm(
      `Strike ${money(row.amount)} at ${row.site_name} from the totals?\n\n` +
        'It stays in the list, crossed out, so nothing disappears silently.'
    )
    if (!ok) return
    try {
      await voidPurchase(row.id, null)
      setLocalReload((k) => k + 1)
      onToast('Struck from the totals')
    } catch (e) {
      console.error('Voiding the purchase failed:', e)
      onToast("Couldn't do that — are you online?")
    }
  }

  return (
    <main className="portal-view">
      <div className="chip-row period-row">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            className={`choice-chip ${period === p.key ? 'active' : ''}`}
            onClick={() => setPeriod(p.key)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {unclaimed > 0 && (
        <div className="claim-banner">
          📥 {unclaimed} order{unclaimed === 1 ? '' : 's'} came in from the inbox and
          {unclaimed === 1 ? " doesn't" : " don't"} have a name yet. Tap{' '}
          <strong>that was me</strong> on yours.
        </div>
      )}

      <div className="total-card">
        <div className="total-label">
          {person === 'everyone' ? 'Total spent' : `Spent by ${person}`}
        </div>
        <div className="total-amount">{money(total)}</div>
        <div className="total-sub">
          {visible.filter((r) => !r.voided).length} purchase
          {visible.filter((r) => !r.voided).length === 1 ? '' : 's'}
        </div>
      </div>

      {byPerson.length > 1 && (
        <div className="by-person">
          {byPerson.map(([who, amount]) => (
            <div className="by-person-row" key={who}>
              <span className="bp-name">{who}</span>
              <span className="bp-bar">
                <span
                  className="bp-fill"
                  style={{ width: `${Math.max(2, (amount / byPerson[0][1]) * 100)}%` }}
                />
              </span>
              <span className="bp-amount">{money(amount)}</span>
            </div>
          ))}
        </div>
      )}

      {people.length > 1 && (
        <div className="chip-row">
          <button
            className={`choice-chip ${person === 'everyone' ? 'active' : ''}`}
            onClick={() => setPerson('everyone')}
          >
            Everyone
          </button>
          {people.map((who) => (
            <button
              key={who}
              className={`choice-chip ${person === who ? 'active' : ''}`}
              onClick={() => setPerson(who)}
            >
              {who}
            </button>
          ))}
        </div>
      )}

      {error && <div className="conn-status fail">Couldn&apos;t load purchases: {error}</div>}

      {rows === null && <div className="rl-meta">Loading purchases…</div>}

      {rows !== null && visible.length === 0 && !error && (
        <div className="rl-empty">
          Nothing logged for this period yet. Purchases show up here as soon as someone orders
          through the portal.
        </div>
      )}

      {days.map((day) => (
        <div key={day.date}>
          <div className="rl-category-title">{dayLabel(day.date)}</div>
          {day.rows.map((row) => (
            <div className={`buy-row ${row.voided ? 'voided' : ''}`} key={row.id}>
              <div className="buy-main">
                <span className="buy-site">{row.site_name}</span>
                <span className="buy-amount">{money(row.amount)}</span>
              </div>
              <div className="buy-meta">
                <span className={row.ordered_by === UNASSIGNED ? 'buy-unassigned' : ''}>
                  {row.ordered_by === UNASSIGNED ? 'no name yet' : row.ordered_by}
                </span>
                {row.source === 'email' && (
                  <span className="buy-tag auto" title="Read from the order confirmation email">
                    auto
                  </span>
                )}
                <span className="buy-tag">{row.spent_on}</span>
                {row.notes && <span className="buy-notes">{row.notes}</span>}
                {!row.voided && row.ordered_by === UNASSIGNED && (
                  <button className="claim-btn" onClick={() => claim(row)}>
                    that was me
                  </button>
                )}
                {row.voided ? (
                  <span className="buy-void">struck</span>
                ) : (
                  <button className="link-btn" onClick={() => strike(row)}>
                    strike
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}

      {visible.length > 0 && (
        <button className="ghost-btn" onClick={copyCsv}>
          Copy as spreadsheet
        </button>
      )}
    </main>
  )
}
