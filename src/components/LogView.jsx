const NEXT = { ok: 'low', low: 'out', out: 'ok' }

export default function LogView({ categories, statuses, onChange }) {
  return (
    <main className="log-view">
      {categories.map((cat) => (
        <div className="category" key={cat.name}>
          <h2>{cat.name}</h2>
          {cat.items.map((item) => {
            const st = statuses[item.id] || { status: 'ok', qty: null }
            return (
              <div className="item-row" key={item.id}>
                <div className="item-name">
                  {item.name}
                  {item.food_program && <span className="fp-tag">Food Prog.</span>}
                </div>
                {st.status === 'low' && (
                  <input
                    type="number"
                    min="0"
                    className="qty-input"
                    placeholder="qty"
                    inputMode="numeric"
                    autoFocus
                    value={st.qty ?? ''}
                    onChange={(e) =>
                      onChange(item.id, {
                        ...st,
                        qty: e.target.value === '' ? null : Number(e.target.value),
                      })
                    }
                  />
                )}
                <button
                  type="button"
                  className={`status-btn state-${st.status}`}
                  onClick={() => onChange(item.id, { status: NEXT[st.status], qty: null })}
                >
                  {st.status.toUpperCase()}
                </button>
              </div>
            )
          })}
        </div>
      ))}
    </main>
  )
}
