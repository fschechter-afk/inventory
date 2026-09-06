import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchReceiving,
  resolveDeliveryIssue,
  setDeliveryLocation,
  setDeliveryState,
  setExpectedDate,
  setReceivedQuantities,
} from '../api.js'
import { dayLabel, money, todayISO } from '../format.js'
import { LOCATIONS } from './WhereTo.jsx'

const STAGES = [
  { key: 'ordered', label: 'Ordered' },
  { key: 'shipped', label: 'Coming' },
  { key: 'received', label: 'Delivered' },
  { key: 'unpacked', label: 'Unpacked' },
]

/** Everything still owed a delivery or a check, grouped by the day it's due.
 *  Anything overdue or flagged comes first, because that's what needs doing. */
export default function Receiving({ reloadKey, orderedBy, onToast, onOpenCount }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [localReload, setLocalReload] = useState(0)
  const [showDone, setShowDone] = useState(false)
  const [issueFor, setIssueFor] = useState(null) // order id the issue form is open on
  const [issueNote, setIssueNote] = useState('')
  const [received, setReceived] = useState({}) // item id -> qty actually received
  const today = todayISO()

  const reload = useCallback(() => setLocalReload((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    setRows(null)
    setError('')
    fetchReceiving()
      .then((data) => alive && setRows(data))
      .catch((e) => {
        if (!alive) return
        setError(e.message || String(e))
        setRows([])
      })
    return () => {
      alive = false
    }
  }, [reloadKey, localReload])

  const open = useMemo(() => (rows || []).filter((r) => r.delivery_status !== 'unpacked'), [rows])
  const flagged = useMemo(() => (rows || []).filter((r) => r.has_issue), [rows])
  const done = useMemo(
    () => (rows || []).filter((r) => r.delivery_status === 'unpacked' && !r.has_issue),
    [rows]
  )

  // The tab badge counts what actually needs Michelle: anything not yet
  // delivered, delivered but not unpacked, or flagged.
  const needsAttention = useMemo(
    () => new Set([...open.map((r) => r.id), ...flagged.map((r) => r.id)]).size,
    [open, flagged]
  )
  useEffect(() => {
    if (onOpenCount) onOpenCount(needsAttention)
  }, [needsAttention, onOpenCount])

  /** Awaiting orders bucketed by the day they're due. */
  const byDay = useMemo(() => {
    const groups = []
    const seen = new Map()
    const waiting = open
      .filter((r) => r.delivery_status === 'ordered' || r.delivery_status === 'shipped')
      .sort((a, b) => (a.expected_on || '9999').localeCompare(b.expected_on || '9999'))
    for (const row of waiting) {
      const key = row.expected_on || 'unknown'
      let group = seen.get(key)
      if (!group) {
        group = { key, rows: [] }
        seen.set(key, group)
        groups.push(group)
      }
      group.rows.push(row)
    }
    return groups
  }, [open])

  const deliveredNotUnpacked = useMemo(
    () => open.filter((r) => r.delivery_status === 'received'),
    [open]
  )

  async function mark(row, state, note) {
    try {
      await setDeliveryState(row.id, state, orderedBy, note || null)
      // Record what actually turned up, when quantities were filled in.
      const lines = Object.entries(received)
        .filter(([id]) => (row.purchase_items || []).some((i) => String(i.id) === id))
        .map(([id, qty]) => ({ id: Number(id), qty_received: qty === '' ? null : Number(qty) }))
      if (lines.length) await setReceivedQuantities(row.id, lines)
      setIssueFor(null)
      setIssueNote('')
      setReceived({})
      reload()
      onToast(
        state === 'issue'
          ? 'Flagged — the note is on the order'
          : state === 'awaiting'
            ? 'Put back in the queue'
            : `Marked ${state}`
      )
    } catch (e) {
      console.error('Updating the delivery failed:', e)
      onToast("Couldn't do that — are you online?")
    }
  }

  async function resolve(row) {
    try {
      await resolveDeliveryIssue(row.id, orderedBy)
      reload()
      onToast('Issue closed — the note stays on the record')
    } catch (e) {
      console.error('Resolving the issue failed:', e)
      onToast("Couldn't do that — are you online?")
    }
  }

  async function relocate(row, place) {
    try {
      await setDeliveryLocation(row.id, place, orderedBy)
      reload()
      onToast(place ? `Directed to the ${place}` : 'Location cleared')
    } catch (e) {
      console.error('Setting the location failed:', e)
      onToast("Couldn't do that — are you online?")
    }
  }

  async function reschedule(row, date) {
    try {
      await setExpectedDate(row.id, date || null, orderedBy)
      reload()
      onToast(date ? `Due ${dayLabel(date)}` : 'Date cleared')
    } catch (e) {
      console.error('Setting the date failed:', e)
      onToast("Couldn't do that — are you online?")
    }
  }

  function dayHeading(key) {
    if (key === 'unknown') return 'No delivery date'
    if (key === today) return `Today — ${dayLabel(key)}`
    if (key < today) return `Overdue — was due ${dayLabel(key)}`
    return dayLabel(key)
  }

  const card = (row) => (
    <OrderCard
      key={row.id}
      row={row}
      today={today}
      issueOpen={issueFor === row.id}
      issueNote={issueNote}
      received={received}
      onIssueOpen={() => {
        setIssueFor(row.id)
        setIssueNote(row.issue_note || '')
        setReceived(
          Object.fromEntries(
            (row.purchase_items || []).map((i) => [i.id, i.qty_received ?? ''])
          )
        )
      }}
      onIssueClose={() => setIssueFor(null)}
      onIssueNote={setIssueNote}
      onReceivedQty={(id, qty) => setReceived((prev) => ({ ...prev, [id]: qty }))}
      onMark={(state, note) => mark(row, state, note)}
      onResolve={() => resolve(row)}
      onRelocate={(place) => relocate(row, place)}
      onReschedule={(date) => reschedule(row, date)}
    />
  )

  if (rows === null) {
    return (
      <main className="portal-view">
        <div className="rl-meta">Loading deliveries…</div>
      </main>
    )
  }

  return (
    <main className="portal-view">
      {error && <div className="conn-status fail">Couldn&apos;t load deliveries: {error}</div>}

      <div className="recv-summary">
        <div>
          <strong>{byDay.reduce((n, g) => n + g.rows.length, 0)}</strong> waiting to arrive
        </div>
        <div>
          <strong>{deliveredNotUnpacked.length}</strong> to unpack
        </div>
        <div className={flagged.length ? 'recv-flagged' : ''}>
          <strong>{flagged.length}</strong> with issues
        </div>
      </div>

      {flagged.length > 0 && (
        <>
          <div className="recv-heading alert">⚠️ Needs sorting out</div>
          {flagged.map(card)}
        </>
      )}

      {deliveredNotUnpacked.length > 0 && (
        <>
          <div className="recv-heading">📦 Arrived, not unpacked</div>
          {deliveredNotUnpacked.filter((r) => !r.has_issue).map(card)}
        </>
      )}

      {byDay.map((group) => (
        <div key={group.key}>
          <div className={`recv-heading ${group.key !== 'unknown' && group.key < today ? 'alert' : ''}`}>
            {dayHeading(group.key)}
            <span className="recv-count">{group.rows.length}</span>
          </div>
          {group.rows.map(card)}
        </div>
      ))}

      {open.length === 0 && flagged.length === 0 && (
        <div className="rl-empty">
          Nothing waiting. Every order placed has been received, checked and unpacked.
        </div>
      )}

      {done.length > 0 && (
        <>
          <button className="ghost-btn" onClick={() => setShowDone((v) => !v)}>
            {showDone ? 'Hide' : 'Show'} {done.length} completed
          </button>
          {showDone && done.map(card)}
        </>
      )}
    </main>
  )
}

function OrderCard({
  row,
  today,
  issueOpen,
  issueNote,
  received,
  onIssueOpen,
  onIssueClose,
  onIssueNote,
  onReceivedQty,
  onMark,
  onResolve,
  onRelocate,
  onReschedule,
}) {
  const items = (row.purchase_items || []).slice().sort((a, b) => a.sort_order - b.sort_order)
  const overdue =
    row.expected_on &&
    row.expected_on < today &&
    (row.delivery_status === 'ordered' || row.delivery_status === 'shipped')
  const stageIndex = STAGES.findIndex((s) => s.key === row.delivery_status)

  return (
    <div className={`recv-card ${row.has_issue ? 'issue' : ''} ${overdue ? 'overdue' : ''}`}>
      <div className="recv-top">
        <span className="recv-store">{row.site_name}</span>
        <span className="recv-amount">{money(row.amount)}</span>
      </div>

      <div className="recv-meta">
        <span>ordered by {row.ordered_by}</span>
        {row.delivery_location ? (
          <span className="recv-place">{row.delivery_location}</span>
        ) : (
          <span className="recv-place none">no location</span>
        )}
        {row.expected_on && (
          <span className={overdue ? 'recv-due late' : 'recv-due'}>
            due {dayLabel(row.expected_on)}
          </span>
        )}
        {row.notes && <span className="buy-notes">{row.notes}</span>}
      </div>

      <div className="recv-track">
        {STAGES.map((stage, i) => (
          <span key={stage.key} className={`recv-step ${i <= stageIndex ? 'done' : ''}`}>
            {stage.label}
          </span>
        ))}
      </div>

      {items.length > 0 && (
        <ul className="recv-items">
          {items.map((item) => {
            const short =
              item.qty_ordered != null &&
              item.qty_received != null &&
              Number(item.qty_received) < Number(item.qty_ordered)
            return (
              <li key={item.id} className={short ? 'short' : ''}>
                <span>{item.name}</span>
                <span className="recv-qty">
                  {item.qty_ordered != null && (
                    <>
                      {item.qty_received != null ? `${item.qty_received} of ` : ''}
                      {item.qty_ordered}
                      {item.unit ? ` ${item.unit}` : ''}
                    </>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {row.has_issue && (
        <div className="recv-issue">
          <strong>Issue:</strong> {row.issue_note}
          <div className="recv-stamp">
            flagged by {row.issue_by}
            {row.received_by ? ` · received by ${row.received_by}` : ''}
          </div>
          <button className="paste-toggle" onClick={onResolve}>
            Mark sorted out
          </button>
        </div>
      )}

      {!row.has_issue && (row.received_by || row.unpacked_by) && (
        <div className="recv-stamp">
          {row.received_by && `received by ${row.received_by}`}
          {row.unpacked_by && ` · unpacked by ${row.unpacked_by}`}
        </div>
      )}

      {issueOpen ? (
        <div className="recv-issue-form">
          <label className="field-label">What was wrong?</label>
          <input
            type="text"
            placeholder="Ordered 15 gallons of oil, only 12 arrived"
            value={issueNote}
            onChange={(e) => onIssueNote(e.target.value)}
          />
          {items.length > 0 && (
            <>
              <label className="field-label">How much actually came?</label>
              {items.map((item) => (
                <div className="recv-count-line" key={item.id}>
                  <span>
                    {item.name}
                    {item.qty_ordered != null && (
                      <em>
                        {' '}
                        ({item.qty_ordered}
                        {item.unit ? ` ${item.unit}` : ''} ordered)
                      </em>
                    )}
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="got"
                    value={received[item.id] ?? ''}
                    onChange={(e) => onReceivedQty(item.id, e.target.value)}
                  />
                </div>
              ))}
            </>
          )}
          <button className="submit-btn" onClick={() => onMark('issue', issueNote)}>
            Save the problem
          </button>
          <button className="back-link" onClick={onIssueClose}>
            Cancel
          </button>
        </div>
      ) : (
        <>
          <div className="recv-actions">
            {row.delivery_status !== 'ordered' && row.delivery_status !== 'shipped' && (
              <button className="recv-btn" onClick={() => onMark('awaiting')}>
                Not yet received
              </button>
            )}
            {row.delivery_status !== 'received' && (
              <button className="recv-btn primary" onClick={() => onMark('received')}>
                Received
              </button>
            )}
            {row.delivery_status !== 'unpacked' && (
              <button className="recv-btn primary" onClick={() => onMark('unpacked')}>
                Received &amp; unpacked
              </button>
            )}
            <button className="recv-btn warn" onClick={onIssueOpen}>
              Issue
            </button>
          </div>

          <div className="recv-fix">
            <span className="recv-fix-label">Send to</span>
            {LOCATIONS.map((place) => (
              <button
                key={place}
                className={`choice-chip small ${row.delivery_location === place ? 'active' : ''}`}
                onClick={() => onRelocate(row.delivery_location === place ? null : place)}
              >
                {place}
              </button>
            ))}
            <input
              type="date"
              className="recv-date"
              value={row.expected_on || ''}
              onChange={(e) => onReschedule(e.target.value)}
            />
          </div>
        </>
      )}
    </div>
  )
}
