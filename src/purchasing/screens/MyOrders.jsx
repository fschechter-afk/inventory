import { useEffect, useState } from 'react'
import { fetchPurchases } from '../api.js'
import { money } from '../format.js'
import { Empty, ErrorNote, Loading } from '../ui.jsx'
import { OrderCards } from './OrderList.jsx'

export default function MyOrders({ me, onOpen, refreshKey }) {
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    setError(null)
    fetchPurchases({ staffId: me.id, limit: 300 }).then(setOrders).catch(setError)
  }, [me.id, refreshKey])

  if (error) return <ErrorNote error={error} />
  if (!orders) return <Loading />

  const missing = orders.filter((o) => o.receipt_count === 0 && o.status !== 'cancelled')
  const pending = orders.filter((o) => o.status === 'pending_approval')
  const shown =
    filter === 'missing' ? missing : filter === 'pending' ? pending : orders

  return (
    <>
      {missing.length > 0 && filter === 'all' && (
        <div className="pp-notice">
          {missing.length} of your order{missing.length === 1 ? ' has' : 's have'} no receipt
          attached.{' '}
          <button className="pp-link" onClick={() => setFilter('missing')}>
            Show them
          </button>
        </div>
      )}

      <div className="pp-chips" style={{ marginBottom: 12 }}>
        {[
          ['all', `All (${orders.length})`],
          ['pending', `Awaiting approval (${pending.length})`],
          ['missing', `Missing receipt (${missing.length})`],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`pp-chip small ${filter === key ? 'selected' : ''}`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <OrderCards
        orders={shown}
        onOpen={onOpen}
        empty={
          <Empty
            icon="🧾"
            title={filter === 'all' ? 'No purchases yet' : 'Nothing in this list'}
          >
            {filter === 'all'
              ? 'Start on the Shop tab — choose a department, pick a store, and the order gets recorded here.'
              : 'Good news.'}
          </Empty>
        }
      />

      {filter === 'all' && orders.length > 0 && (
        <p className="pp-muted" style={{ textAlign: 'center', marginTop: 16 }}>
          {orders.length} purchases · {money(orders.reduce((s, o) => s + Number(o.total), 0))} total
        </p>
      )}
    </>
  )
}
