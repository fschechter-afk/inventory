import { money, shortDate } from '../format.js'
import { Empty, ReceiptPill, StatusPill } from '../ui.jsx'

/** One card per order, used by My Orders, the dashboard, and search results. */
export function OrderCard({ order, onOpen, showWho = false }) {
  const missingReceipt = order.receipt_count === 0 && order.status !== 'cancelled'
  const flag = order.status === 'pending_approval' ? 'flag-pending' : missingReceipt ? 'flag-missing' : ''

  return (
    <button className={`pp-order ${flag}`} onClick={() => onOpen(order)}>
      <div className="pp-order-top">
        <span className="pp-order-vendor">{order.vendor_name}</span>
        <span className="pp-order-total">{money(order.total)}</span>
      </div>
      <div className="pp-order-purpose">{order.purpose}</div>
      <div className="pp-order-meta">
        <span>
          {order.department_emoji} {order.department_name}
        </span>
        {showWho && <span>· {order.staff_name}</span>}
        <span>· {shortDate(order.effective_date)}</span>
        <StatusPill status={order.status} />
        <ReceiptPill count={order.receipt_count} />
      </div>
    </button>
  )
}

export function OrderCards({ orders, onOpen, showWho = false, empty }) {
  if (!orders.length) return empty || <Empty title="Nothing here yet" />
  return orders.map((o) => <OrderCard key={o.id} order={o} onOpen={onOpen} showWho={showWho} />)
}
