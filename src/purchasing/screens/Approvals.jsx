import { useEffect, useState } from 'react'
import { decidePurchase, fetchPendingApprovals } from '../api.js'
import { money, relativeTime } from '../format.js'
import { Empty, ErrorNote, Loading } from '../ui.jsx'

/** Row Level Security already limits this list to the departments the signed-in
 *  person manages, so there is no filtering to do here. */
export default function Approvals({ onOpen, onDecided, onToast, refreshKey }) {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)

  const load = () => fetchPendingApprovals().then(setOrders).catch(setError)
  useEffect(() => {
    setError(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  async function decide(order, approve) {
    let note = null
    if (!approve) {
      note = window.prompt('Why is this being turned down? (optional)')
      if (note === null) return // cancelled the prompt — do not turn it down
    }
    setBusyId(order.id)
    setError(null)
    try {
      await decidePurchase(order.id, approve, note)
      setOrders((prev) => prev.filter((o) => o.id !== order.id))
      onToast(approve ? 'Approved' : 'Turned down')
      onDecided()
    } catch (e) {
      setError(e)
    } finally {
      setBusyId(null)
    }
  }

  if (error) return <ErrorNote error={error} onRetry={load} />
  if (!orders) return <Loading />
  if (!orders.length)
    return (
      <Empty icon="✅" title="Nothing waiting">
        Purchases over the approval limit show up here for a decision.
      </Empty>
    )

  return orders.map((order) => (
    <div key={order.id} className="pp-card">
      <div className="pp-order-top">
        <span className="pp-order-vendor">{order.vendor_name}</span>
        <span className="pp-order-total">{money(order.total)}</span>
      </div>
      <div className="pp-order-purpose">{order.purpose}</div>
      <div className="pp-order-meta" style={{ marginBottom: 12 }}>
        <span>{order.staff_name}</span>
        <span>
          · {order.department_emoji} {order.department_name}
        </span>
        <span>· asked {relativeTime(order.created_at)}</span>
      </div>
      <div className="pp-row">
        <button
          className="pp-btn small"
          disabled={busyId === order.id}
          onClick={() => decide(order, true)}
        >
          Approve
        </button>
        <button
          className="pp-btn small ghost"
          disabled={busyId === order.id}
          onClick={() => decide(order, false)}
        >
          Turn down
        </button>
        <button className="pp-link" onClick={() => onOpen(order)}>
          Details
        </button>
      </div>
    </div>
  ))
}
