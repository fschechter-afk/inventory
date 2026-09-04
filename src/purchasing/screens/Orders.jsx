import { useEffect, useMemo, useState } from 'react'
import { fetchPurchases } from '../api.js'
import {
  downloadCsv,
  isoDate,
  money,
  periodStart,
  shortDate,
  STATUSES,
  STATUS_LABEL,
  toNumber,
} from '../format.js'
import { Empty, ErrorNote, Field, Loading, SearchInput, StatusPill } from '../ui.jsx'

export const PURCHASE_CSV_COLUMNS = [
  { label: 'Reference', key: 'reference' },
  { label: 'Date', value: (o) => o.effective_date },
  { label: 'Staff member', key: 'staff_name' },
  { label: 'Department', key: 'department_name' },
  { label: 'Vendor', key: 'vendor_name' },
  { label: 'Purpose', key: 'purpose' },
  { label: 'Order number', key: 'order_number' },
  { label: 'Items', key: 'item_count' },
  { label: 'Subtotal', key: 'subtotal' },
  { label: 'Shipping', key: 'shipping' },
  { label: 'Tax', key: 'tax' },
  { label: 'Total', key: 'total' },
  { label: 'Status', value: (o) => STATUS_LABEL[o.status] },
  { label: 'Approved by', key: 'approved_by_name' },
  { label: 'Receipt', value: (o) => (o.receipt_count > 0 ? 'Yes' : 'No') },
  { label: 'Payment method', key: 'payment_method' },
  { label: 'Tracking', key: 'tracking_number' },
  { label: 'Delivered', key: 'delivered_on' },
  { label: 'Notes', key: 'notes' },
]

const EMPTY = {
  search: '',
  staffId: '',
  departmentId: '',
  vendorId: '',
  status: '',
  from: '',
  to: '',
  minTotal: '',
  maxTotal: '',
  missingReceipt: false,
}

/** "Show me everything ordered for the Dorm from Amazon during September."
 *  Filters run in the database; the result exports to CSV as-is. */
export default function Orders({ departments, vendors, staff, initialFilters, onOpen, refreshKey }) {
  const [filters, setFilters] = useState({ ...EMPTY, ...initialFilters })
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(null)
  const [showFilters, setShowFilters] = useState(
    Object.entries(initialFilters || {}).some(([, v]) => v)
  )

  useEffect(() => setFilters({ ...EMPTY, ...initialFilters }), [initialFilters])

  useEffect(() => {
    let cancelled = false
    setOrders(null)
    setError(null)
    fetchPurchases({
      ...filters,
      minTotal: toNumber(filters.minTotal),
      maxTotal: toNumber(filters.maxTotal),
      limit: 1000,
    })
      .then((rows) => !cancelled && setOrders(rows))
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [filters, refreshKey])

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }))
  const total = useMemo(
    () => (orders || []).reduce((sum, o) => sum + Number(o.total), 0),
    [orders]
  )
  const active = Object.entries(filters).filter(([k, v]) => v && v !== EMPTY[k]).length

  return (
    <>
      <div className="pp-card">
        <SearchInput
          value={filters.search}
          onChange={(search) => set({ search })}
          placeholder="Order number, reference, store, purpose…"
        />
        <div className="pp-spread" style={{ marginTop: 10 }}>
          <button className="pp-link" onClick={() => setShowFilters(!showFilters)}>
            {showFilters ? 'Hide filters' : `Filters${active ? ` (${active})` : ''}`}
          </button>
          {active > 0 && (
            <button className="pp-link" onClick={() => setFilters({ ...EMPTY })}>
              Clear all
            </button>
          )}
        </div>

        {showFilters && (
          <div style={{ marginTop: 12 }}>
            <div className="pp-row">
              <Field label="Department">
                <select
                  className="pp-select"
                  value={filters.departmentId}
                  onChange={(e) => set({ departmentId: e.target.value })}
                >
                  <option value="">Any</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Store">
                <select
                  className="pp-select"
                  value={filters.vendorId}
                  onChange={(e) => set({ vendorId: e.target.value })}
                >
                  <option value="">Any</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="pp-row">
              <Field label="Staff member">
                <select
                  className="pp-select"
                  value={filters.staffId}
                  onChange={(e) => set({ staffId: e.target.value })}
                >
                  <option value="">Anyone</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Status">
                <select
                  className="pp-select"
                  value={filters.status}
                  onChange={(e) => set({ status: e.target.value })}
                >
                  <option value="">Any</option>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="pp-row">
              <Field label="From">
                <input
                  className="pp-input"
                  type="date"
                  value={filters.from}
                  onChange={(e) => set({ from: e.target.value })}
                />
              </Field>
              <Field label="To">
                <input
                  className="pp-input"
                  type="date"
                  value={filters.to}
                  onChange={(e) => set({ to: e.target.value })}
                />
              </Field>
            </div>
            <div className="pp-row">
              <Field label="Min amount">
                <input
                  className="pp-input"
                  type="number"
                  inputMode="decimal"
                  value={filters.minTotal}
                  onChange={(e) => set({ minTotal: e.target.value })}
                  placeholder="0"
                />
              </Field>
              <Field label="Max amount">
                <input
                  className="pp-input"
                  type="number"
                  inputMode="decimal"
                  value={filters.maxTotal}
                  onChange={(e) => set({ maxTotal: e.target.value })}
                  placeholder="Any"
                />
              </Field>
            </div>
            <div className="pp-chips">
              <button
                className={`pp-chip small ${filters.missingReceipt ? 'selected' : ''}`}
                onClick={() => set({ missingReceipt: !filters.missingReceipt })}
              >
                Missing receipt only
              </button>
              <button
                className="pp-chip small"
                onClick={() => set({ from: periodStart('month'), to: isoDate() })}
              >
                This month
              </button>
              <button
                className="pp-chip small"
                onClick={() => set({ from: periodStart('year'), to: isoDate() })}
              >
                This year
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <ErrorNote error={error} />}
      {!orders && !error && <Loading />}

      {orders && (
        <>
          <div className="pp-spread" style={{ marginBottom: 10 }}>
            <span className="pp-muted">
              {orders.length} order{orders.length === 1 ? '' : 's'} · {money(total)}
            </span>
            <button
              className="pp-btn small ghost"
              disabled={!orders.length}
              onClick={() =>
                downloadCsv(`lghs-purchases-${isoDate()}`, orders, PURCHASE_CSV_COLUMNS)
              }
            >
              Export CSV
            </button>
          </div>

          {orders.length === 0 ? (
            <Empty icon="🔍" title="No purchases match">
              Try widening the date range or clearing a filter.
            </Empty>
          ) : (
            <div className="pp-table-wrap">
              <table className="pp-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Store</th>
                    <th>Department</th>
                    <th>Who</th>
                    <th className="num">Total</th>
                    <th>Status</th>
                    <th>Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} onClick={() => onOpen(o)} style={{ cursor: 'pointer' }}>
                      <td>{shortDate(o.effective_date)}</td>
                      <td>
                        <strong>{o.vendor_name}</strong>
                        <div className="pp-muted">{o.purpose}</div>
                      </td>
                      <td>{o.department_name}</td>
                      <td>{o.staff_name}</td>
                      <td className="num">{money(o.total)}</td>
                      <td>
                        <StatusPill status={o.status} />
                      </td>
                      <td>{o.receipt_count > 0 ? '✓' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}
