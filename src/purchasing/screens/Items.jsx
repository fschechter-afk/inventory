import { useEffect, useMemo, useState } from 'react'
import { fetchItems } from '../api.js'
import { downloadCsv, isoDate, money, periodStart, shortDate } from '../format.js'
import { Empty, ErrorNote, Field, Loading, Modal, SearchInput } from '../ui.jsx'

/** The running record of every item the school has ordered.
 *
 *  Rolled up by item name: how many times it was bought, how much has gone to
 *  it, what it cost last time and whether that is up or down, and which store
 *  has been cheapest. That last one is the point — it turns a pile of orders
 *  into "we pay $12.99 at Amazon and $9.40 at Restaurant Depot for the same
 *  thing." */
export default function Items({ departments, vendors, staff, canSeeOthers, onOpenPurchase, refreshKey }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState({ departmentId: '', vendorId: '', staffId: '', from: '', to: '' })
  const [sort, setSort] = useState('spend')
  const [detail, setDetail] = useState(null)

  const load = () =>
    fetchItems({ ...filters, search })
      .then(setRows)
      .catch(setError)

  useEffect(() => {
    setRows(null)
    setError(null)
    let cancelled = false
    fetchItems({ ...filters, search })
      .then((r) => !cancelled && setRows(r))
      .catch((e) => !cancelled && setError(e))
    return () => {
      cancelled = true
    }
  }, [filters, search, refreshKey])

  const items = useMemo(() => {
    if (!rows) return null
    const byKey = new Map()
    for (const row of rows) {
      let entry = byKey.get(row.name_key)
      if (!entry) {
        entry = {
          key: row.name_key,
          name: row.name,
          times: 0,
          quantity: 0,
          spend: 0,
          vendors: new Map(),
          prices: [],
          lines: [],
        }
        byKey.set(row.name_key, entry)
      }
      entry.times += 1
      entry.quantity += Number(row.quantity) || 0
      entry.spend += Number(row.line_total) || 0
      entry.lines.push(row)
      const price = Number(row.unit_price)
      if (price > 0) {
        entry.prices.push({ price, date: row.effective_date, vendor: row.vendor_name })
        const seen = entry.vendors.get(row.vendor_name)
        if (!seen || price < seen) entry.vendors.set(row.vendor_name, price)
      }
    }

    // rows arrive newest first, so prices[0] is the most recent price paid
    const list = [...byKey.values()].map((entry) => {
      const cheapest = [...entry.vendors.entries()].sort((a, b) => a[1] - b[1])[0]
      const latest = entry.prices[0]
      const previous = entry.prices.find((p) => latest && p.price !== latest.price)
      return {
        ...entry,
        lastDate: entry.lines[0]?.effective_date,
        lastPrice: latest?.price ?? null,
        priceChange: latest && previous ? latest.price - previous.price : null,
        cheapestVendor: cheapest?.[0] ?? null,
        cheapestPrice: cheapest?.[1] ?? null,
        vendorCount: entry.vendors.size,
      }
    })

    const sorters = {
      spend: (a, b) => b.spend - a.spend,
      times: (a, b) => b.times - a.times,
      recent: (a, b) => String(b.lastDate).localeCompare(String(a.lastDate)),
      name: (a, b) => a.name.localeCompare(b.name),
    }
    return list.sort(sorters[sort])
  }, [rows, sort])

  const set = (patch) => setFilters((f) => ({ ...f, ...patch }))
  const activeFilters = Object.values(filters).filter(Boolean).length

  return (
    <>
      <div className="pp-card">
        <SearchInput value={search} onChange={setSearch} placeholder="Search every item ever ordered…" />
        <div className="pp-row wrap" style={{ marginTop: 10 }}>
          <Field label="Department">
            <select
              className="pp-select small"
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
              className="pp-select small"
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
        <div className="pp-row wrap">
          {canSeeOthers && (
            <Field label="Who ordered">
              <select
                className="pp-select small"
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
          )}
          <Field label="Sort by">
            <select className="pp-select small" value={sort} onChange={(e) => setSort(e.target.value)}>
              <option value="spend">Most spent</option>
              <option value="times">Most often ordered</option>
              <option value="recent">Most recent</option>
              <option value="name">Name</option>
            </select>
          </Field>
        </div>
        <div className="pp-chips">
          <button
            className="pp-chip small"
            onClick={() => set({ from: periodStart('year'), to: isoDate() })}
          >
            This year
          </button>
          <button
            className="pp-chip small"
            onClick={() => set({ from: periodStart('month'), to: isoDate() })}
          >
            This month
          </button>
          {(activeFilters > 0 || search) && (
            <button
              className="pp-chip small"
              onClick={() => {
                setFilters({ departmentId: '', vendorId: '', staffId: '', from: '', to: '' })
                setSearch('')
              }}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {error && <ErrorNote error={error} onRetry={load} />}
      {!items && !error && <Loading />}

      {items && items.length === 0 && (
        <Empty icon="📦" title="No items recorded yet">
          Items come from the &ldquo;Items&rdquo; box when someone records an order. Orders saved
          with just a total still count toward spending — they just won&apos;t show up here.
        </Empty>
      )}

      {items && items.length > 0 && (
        <>
          <div className="pp-spread" style={{ marginBottom: 10 }}>
            <span className="pp-muted">
              {items.length} distinct item{items.length === 1 ? '' : 's'} · {rows.length} line
              {rows.length === 1 ? '' : 's'} ·{' '}
              {money(items.reduce((s, i) => s + i.spend, 0))}
            </span>
            <button
              className="pp-btn small ghost"
              onClick={() =>
                downloadCsv(`lghs-items-${isoDate()}`, items, [
                  { label: 'Item', key: 'name' },
                  { label: 'Times ordered', key: 'times' },
                  { label: 'Total quantity', key: 'quantity' },
                  { label: 'Total spent', key: 'spend' },
                  { label: 'Last price', key: 'lastPrice' },
                  { label: 'Last ordered', key: 'lastDate' },
                  { label: 'Cheapest at', key: 'cheapestVendor' },
                  { label: 'Cheapest price', key: 'cheapestPrice' },
                  { label: 'Stores used', key: 'vendorCount' },
                ])
              }
            >
              Export CSV
            </button>
          </div>

          {items.map((item) => (
            <button key={item.key} className="pp-order" onClick={() => setDetail(item)}>
              <div className="pp-order-top">
                <span className="pp-order-vendor">{item.name}</span>
                <span className="pp-order-total">{money(item.spend)}</span>
              </div>
              <div className="pp-order-meta">
                <span>
                  {item.times} order{item.times === 1 ? '' : 's'} · {item.quantity} unit
                  {item.quantity === 1 ? '' : 's'}
                </span>
                {item.lastPrice != null && (
                  <span>
                    · last {money(item.lastPrice)}
                    {item.priceChange != null && item.priceChange !== 0 && (
                      <span className={item.priceChange > 0 ? 'pp-up' : 'pp-down'}>
                        {' '}
                        {item.priceChange > 0 ? '▲' : '▼'} {money(Math.abs(item.priceChange))}
                      </span>
                    )}
                  </span>
                )}
                {item.lastDate && <span>· {shortDate(item.lastDate)}</span>}
                {item.vendorCount > 1 && (
                  <span className="pp-pill pp-pill-ok">
                    cheapest at {item.cheapestVendor} {money(item.cheapestPrice)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </>
      )}

      {detail && (
        <ItemDetail item={detail} onClose={() => setDetail(null)} onOpenPurchase={onOpenPurchase} />
      )}
    </>
  )
}

function ItemDetail({ item, onClose, onOpenPurchase }) {
  return (
    <Modal title={item.name} onClose={onClose} wide>
      <div className="pp-stats">
        <div className="pp-stat">
          <div className="pp-stat-label">Total spent</div>
          <div className="pp-stat-value">{money(item.spend)}</div>
          <div className="pp-stat-sub">
            {item.times} order{item.times === 1 ? '' : 's'}
          </div>
        </div>
        <div className="pp-stat">
          <div className="pp-stat-label">Last price</div>
          <div className="pp-stat-value">
            {item.lastPrice != null ? money(item.lastPrice) : '—'}
          </div>
          <div className="pp-stat-sub">{item.lastDate ? shortDate(item.lastDate) : ''}</div>
        </div>
        {item.vendorCount > 1 && (
          <div className="pp-stat">
            <div className="pp-stat-label">Cheapest</div>
            <div className="pp-stat-value">{money(item.cheapestPrice)}</div>
            <div className="pp-stat-sub">at {item.cheapestVendor}</div>
          </div>
        )}
      </div>

      <div className="pp-table-wrap">
        <table className="pp-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Store</th>
              <th>Department</th>
              <th>Who</th>
              <th className="num">Qty</th>
              <th className="num">Unit</th>
              <th className="num">Line</th>
            </tr>
          </thead>
          <tbody>
            {item.lines.map((line) => (
              <tr
                key={line.id}
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  onClose()
                  onOpenPurchase({ id: line.purchase_id })
                }}
              >
                <td>{shortDate(line.effective_date)}</td>
                <td>{line.vendor_name}</td>
                <td>{line.department_name}</td>
                <td>{line.staff_name}</td>
                <td className="num">{Number(line.quantity)}</td>
                <td className="num">{money(line.unit_price)}</td>
                <td className="num">{money(line.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pp-muted" style={{ marginTop: 10 }}>
        Tap any row to open the order it came from.
      </p>
    </Modal>
  )
}
