import { useEffect, useMemo, useState } from 'react'
import { fetchPurchases } from '../api.js'
import {
  countsTowardSpend,
  downloadCsv,
  groupTotals,
  isoDate,
  money,
  periodStart,
  STATUS_LABEL,
} from '../format.js'
import { ErrorNote, Field, Loading } from '../ui.jsx'
import { PURCHASE_CSV_COLUMNS } from './Orders.jsx'

const SUMMARY_COLUMNS = [
  { label: 'Name', key: 'label' },
  { label: 'Orders', key: 'count' },
  { label: 'Total', key: 'total' },
]

/** All eight reports come from one date-ranged fetch, so a monthly report and
 *  a vendor report for the same range can never disagree. */
export default function Reports({ budgets }) {
  const [range, setRange] = useState({ from: periodStart('month'), to: isoDate() })
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(null)
  const [report, setReport] = useState('department')

  useEffect(() => {
    let cancelled = false
    setOrders(null)
    setError(null)
    fetchPurchases({ from: range.from, to: range.to, limit: 5000 })
      .then((rows) => !cancelled && setOrders(rows))
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [range])

  const counted = useMemo(() => (orders || []).filter((o) => countsTowardSpend(o.status)), [orders])

  const table = useMemo(() => {
    if (!orders) return null
    switch (report) {
      case 'department':
        return {
          title: 'Department spending',
          rows: groupTotals(counted, (o) => o.department_id, (o) => o.department_name),
          columns: SUMMARY_COLUMNS,
        }
      case 'vendor':
        return {
          title: 'Vendor spending',
          rows: groupTotals(counted, (o) => o.vendor_name, (o) => o.vendor_name),
          columns: SUMMARY_COLUMNS,
        }
      case 'employee':
        return {
          title: 'Employee purchasing',
          rows: groupTotals(counted, (o) => o.staff_id, (o) => o.staff_name),
          columns: SUMMARY_COLUMNS,
        }
      case 'month':
        return {
          title: 'Spending by month',
          rows: groupTotals(
            counted,
            (o) => o.effective_date.slice(0, 7),
            (o) => o.effective_date.slice(0, 7)
          ).sort((a, b) => a.key.localeCompare(b.key)),
          columns: SUMMARY_COLUMNS,
        }
      case 'status':
        return {
          title: 'Orders by status',
          rows: groupTotals(orders, (o) => o.status, (o) => STATUS_LABEL[o.status]),
          columns: SUMMARY_COLUMNS,
        }
      case 'missing':
        return {
          title: 'Missing receipts',
          rows: orders.filter((o) => o.receipt_count === 0 && o.status !== 'cancelled'),
          columns: PURCHASE_CSV_COLUMNS,
          detail: true,
        }
      case 'budget':
        return {
          title: 'Budget vs. actual (current period)',
          rows: (budgets || []).map((b) => ({
            label: b.department_name,
            period: b.period,
            amount: b.amount,
            spent: b.spent,
            remaining: b.remaining,
            pct: `${b.pct}%`,
          })),
          columns: [
            { label: 'Department', key: 'label' },
            { label: 'Period', key: 'period' },
            { label: 'Budget', key: 'amount' },
            { label: 'Spent', key: 'spent' },
            { label: 'Remaining', key: 'remaining' },
            { label: 'Used', key: 'pct' },
          ],
          money: ['amount', 'spent', 'remaining'],
        }
      default:
        return {
          title: 'All purchases',
          rows: orders,
          columns: PURCHASE_CSV_COLUMNS,
          detail: true,
        }
    }
  }, [orders, counted, report, budgets])

  const grandTotal = counted.reduce((sum, o) => sum + Number(o.total), 0)

  return (
    <>
      <div className="pp-card">
        <h2>Report</h2>
        <div className="pp-chips" style={{ marginBottom: 14 }}>
          {[
            ['department', 'By department'],
            ['vendor', 'By store'],
            ['employee', 'By person'],
            ['month', 'By month'],
            ['status', 'By status'],
            ['budget', 'Budget vs. actual'],
            ['missing', 'Missing receipts'],
            ['all', 'Every purchase'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={`pp-chip small ${report === key ? 'selected' : ''}`}
              onClick={() => setReport(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="pp-row">
          <Field label="From">
            <input
              className="pp-input"
              type="date"
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </Field>
          <Field label="To">
            <input
              className="pp-input"
              type="date"
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </Field>
        </div>
        <div className="pp-chips">
          <button
            className="pp-chip small"
            onClick={() => setRange({ from: periodStart('month'), to: isoDate() })}
          >
            This month
          </button>
          <button
            className="pp-chip small"
            onClick={() => setRange({ from: periodStart('year'), to: isoDate() })}
          >
            This year
          </button>
          <button
            className="pp-chip small"
            onClick={() => {
              const d = new Date()
              d.setMonth(d.getMonth() - 1, 1)
              const start = isoDate(d)
              d.setMonth(d.getMonth() + 1, 0)
              setRange({ from: start, to: isoDate(d) })
            }}
          >
            Last month
          </button>
        </div>
      </div>

      {error && <ErrorNote error={error} />}
      {!orders && !error && <Loading />}

      {orders && table && (
        <div className="pp-card">
          <div className="pp-spread" style={{ marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: 0 }}>{table.title}</h2>
              <span className="pp-muted">
                {range.from} to {range.to} · {counted.length} orders · {money(grandTotal)}
              </span>
            </div>
            <button
              className="pp-btn small ghost"
              disabled={!table.rows.length}
              onClick={() =>
                downloadCsv(`lghs-${report}-${range.from}-to-${range.to}`, table.rows, table.columns)
              }
            >
              Export CSV
            </button>
          </div>

          {table.rows.length === 0 ? (
            <p className="pp-muted">Nothing in this range.</p>
          ) : table.detail ? (
            <div className="pp-table-wrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Store</th>
                    <th>Department</th>
                    <th>Who</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((o) => (
                    <tr key={o.id}>
                      <td>{o.effective_date}</td>
                      <td>{o.vendor_name}</td>
                      <td>{o.department_name}</td>
                      <td>{o.staff_name}</td>
                      <td className="num">{money(o.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="pp-table-wrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    {table.columns.map((c) => (
                      <th key={c.label} className={isNumeric(c.key) ? 'num' : ''}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row, i) => (
                    <tr key={row.key ?? row.label ?? i}>
                      {table.columns.map((c) => (
                        <td key={c.label} className={isNumeric(c.key) ? 'num' : ''}>
                          {formatCell(row[c.key], c.key, table.money)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
}

const isNumeric = (key) =>
  ['count', 'total', 'amount', 'spent', 'remaining', 'pct'].includes(key)

function formatCell(value, key, moneyKeys) {
  if (value == null) return '—'
  if (key === 'total' || moneyKeys?.includes(key)) return money(value)
  return String(value)
}
