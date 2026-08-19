import { useEffect, useMemo, useState } from 'react'
import { fetchLatestCheck } from '../supabase.js'

export default function ShoppingList({ catalog, onToast }) {
  const [latest, setLatest] = useState(undefined) // undefined=loading, null=none

  useEffect(() => {
    fetchLatestCheck()
      .then(setLatest)
      .catch((e) => {
        console.error('Shopping list fetch failed:', e)
        setLatest(null)
        onToast("Couldn't load the latest check — are you online?")
      })
  }, [onToast])

  // Order flagged items the same way they appear on the log form.
  const order = useMemo(() => {
    const m = new Map()
    ;(catalog || []).forEach((item, i) => m.set(item.id, i))
    return m
  }, [catalog])

  const grouped = useMemo(() => {
    if (!latest) return []
    const flagged = (latest.inventory_check_items || [])
      .filter((r) => r.status === 'low' || r.status === 'out')
      .sort((a, b) => {
        const ai = order.has(a.item_id) ? order.get(a.item_id) : Infinity
        const bi = order.has(b.item_id) ? order.get(b.item_id) : Infinity
        if (ai !== bi) return ai - bi
        return a.item_name.localeCompare(b.item_name)
      })
    const cats = []
    const byName = new Map()
    for (const row of flagged) {
      let cat = byName.get(row.category)
      if (!cat) {
        cat = { name: row.category, rows: [] }
        byName.set(row.category, cat)
        cats.push(cat)
      }
      cat.rows.push(row)
    }
    return cats
  }, [latest, order])

  if (latest === undefined) {
    return (
      <div className="list-view">
        <div className="rl-meta">Loading latest submission…</div>
      </div>
    )
  }
  if (latest === null) {
    return (
      <div className="list-view">
        <div className="rl-empty">No submissions yet.</div>
      </div>
    )
  }

  const when = new Date(latest.created_at).toLocaleString()

  function copyList() {
    let text = `Shopping List — from check by ${latest.filled_by} (${when})\n\n`
    for (const cat of grouped) {
      text += `${cat.name}\n`
      for (const row of cat.rows) {
        const qtyText = row.status === 'low' && row.qty != null ? ` (${row.qty} left)` : ''
        text += `- ${row.item_name}${qtyText} (${row.status.toUpperCase()})\n`
      }
      text += '\n'
    }
    navigator.clipboard
      .writeText(text)
      .then(() => onToast('Shopping list copied!'))
      .catch(() => onToast("Couldn't copy — try selecting the text manually"))
  }

  return (
    <div className="list-view">
      <div className="rl-meta">
        Latest check by {latest.filled_by} — {when}
      </div>
      {grouped.length === 0 ? (
        <div className="rl-empty">Nothing flagged — everything was OK at last check.</div>
      ) : (
        <>
          <button className="copy-btn" onClick={copyList}>
            Copy List
          </button>
          {grouped.map((cat) => (
            <div key={cat.name}>
              <div className="rl-category-title">{cat.name}</div>
              {cat.rows.map((row) => (
                <div key={row.id ?? `${row.item_name}-${row.category}`} className={`rl-item ${row.status === 'out' ? 'out' : ''}`}>
                  <span className="rl-name">
                    {row.item_name}
                    {row.status === 'low' && row.qty != null ? ` (${row.qty} left)` : ''}
                  </span>
                  <span className="rl-flag">{row.status}</span>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
