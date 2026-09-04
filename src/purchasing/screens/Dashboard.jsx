import { useEffect, useMemo, useState } from 'react'
import { fetchPurchases } from '../api.js'
import {
  countsTowardSpend,
  groupTotals,
  money,
  moneyShort,
  periodStart,
  STATUS_LABEL,
} from '../format.js'
import { Bar, Empty, ErrorNote, Loading, Stat } from '../ui.jsx'
import { OrderCards } from './OrderList.jsx'

/** Everything on this page is derived from one query for the year's purchases.
 *  A school records thousands of orders a year at most, so a single fetch and
 *  local aggregation keeps the numbers on screen consistent with each other. */
export default function Dashboard({ budgets, settings, onOpen, onNavigate, refreshKey }) {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(null)

  const load = () =>
    fetchPurchases({ from: periodStart('year'), limit: 5000 })
      .then(setOrders)
      .catch(setError)

  useEffect(() => {
    setError(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const stats = useMemo(() => {
    if (!orders) return null
    const counted = orders.filter((o) => countsTowardSpend(o.status))
    const since = (period) => {
      const start = periodStart(period)
      return counted
        .filter((o) => o.effective_date >= start)
        .reduce((sum, o) => sum + Number(o.total), 0)
    }
    return {
      today: since('day'),
      week: since('week'),
      month: since('month'),
      year: since('year'),
      byDepartment: groupTotals(counted, (o) => o.department_id, (o) => o.department_name),
      byVendor: groupTotals(counted, (o) => o.vendor_name, (o) => o.vendor_name),
      byEmployee: groupTotals(counted, (o) => o.staff_id, (o) => o.staff_name),
      byStatus: orders.reduce((acc, o) => {
        acc[o.status] = (acc[o.status] || 0) + 1
        return acc
      }, {}),
      pending: orders.filter((o) => o.status === 'pending_approval'),
      missingReceipt: orders.filter((o) => o.receipt_count === 0 && o.status !== 'cancelled'),
    }
  }, [orders])

  if (error) return <ErrorNote error={error} onRetry={load} />
  if (!orders) return <Loading />
  if (!orders.length)
    return (
      <Empty icon="📊" title="No purchases recorded yet">
        As staff record orders through the portal, this page fills in with spending by
        department, store and person.
      </Empty>
    )

  const warnPct = settings?.budget_warn_pct ?? 80

  return (
    <>
      <div className="pp-stats">
        <Stat label="Today" value={moneyShort(stats.today)} />
        <Stat label="This week" value={moneyShort(stats.week)} />
        <Stat label="This month" value={moneyShort(stats.month)} />
        <Stat label="This year" value={moneyShort(stats.year)} sub={`${orders.length} orders`} />
      </div>

      {(stats.pending.length > 0 || stats.missingReceipt.length > 0) && (
        <div className="pp-card">
          <h2>Needs attention</h2>
          {stats.pending.length > 0 && (
            <div className="pp-spread" style={{ marginBottom: 8 }}>
              <span>
                {stats.pending.length} order{stats.pending.length === 1 ? '' : 's'} awaiting approval
                · {money(stats.pending.reduce((s, o) => s + Number(o.total), 0))}
              </span>
              <button className="pp-btn small ghost" onClick={() => onNavigate('approvals')}>
                Review
              </button>
            </div>
          )}
          {stats.missingReceipt.length > 0 && (
            <div className="pp-spread">
              <span>
                {stats.missingReceipt.length} order
                {stats.missingReceipt.length === 1 ? '' : 's'} missing a receipt ·{' '}
                {money(stats.missingReceipt.reduce((s, o) => s + Number(o.total), 0))}
              </span>
              <button
                className="pp-btn small ghost"
                onClick={() => onNavigate('orders', { missingReceipt: true })}
              >
                Chase
              </button>
            </div>
          )}
        </div>
      )}

      {budgets?.length > 0 && (
        <div className="pp-card">
          <h2>Budget vs. actual</h2>
          {budgets.map((b) => (
            <Bar
              key={b.department_id}
              label={b.department_name}
              value={Number(b.spent)}
              max={Number(b.amount)}
              caption={`${money(b.spent)} of ${money(b.amount)} · ${b.pct}%`}
              tone={b.pct >= 100 ? 'over' : b.pct >= warnPct ? 'warn' : 'ok'}
            />
          ))}
          <p className="pp-muted">
            Each bar covers the current {budgets[0]?.period.replace('ly', '')} period.
          </p>
        </div>
      )}

      <Breakdown title="Spending by department" rows={stats.byDepartment} tone="plum" />
      <Breakdown title="Spending by store" rows={stats.byVendor} tone="gold" />
      <Breakdown title="Spending by person" rows={stats.byEmployee} tone="plum" />

      <div className="pp-card">
        <h2>Orders by status</h2>
        <div className="pp-chips">
          {Object.entries(stats.byStatus)
            .sort((a, b) => b[1] - a[1])
            .map(([status, count]) => (
              <button
                key={status}
                className="pp-chip small"
                onClick={() => onNavigate('orders', { status })}
              >
                {STATUS_LABEL[status]} · {count}
              </button>
            ))}
        </div>
      </div>

      <h2 className="pp-section-title">Recent orders</h2>
      <OrderCards orders={orders.slice(0, 12)} onOpen={onOpen} showWho />
      <button
        className="pp-btn ghost"
        style={{ marginTop: 8 }}
        onClick={() => onNavigate('orders')}
      >
        Search all purchases
      </button>
    </>
  )
}

function Breakdown({ title, rows, tone }) {
  if (!rows.length) return null
  const max = rows[0].total
  return (
    <div className="pp-card">
      <h2>{title}</h2>
      {rows.slice(0, 10).map((row) => (
        <Bar
          key={row.key}
          label={row.label}
          value={row.total}
          max={max}
          caption={`${money(row.total)} · ${row.count}`}
          tone={tone}
        />
      ))}
      {rows.length > 10 && <p className="pp-muted">+ {rows.length - 10} more</p>}
    </div>
  )
}
