import { useEffect, useMemo, useState } from 'react'
import { fetchLatestCheck } from '../../supabase.js'

/** What the last inventory check flagged, so whoever is ordering knows what
 *  to buy without switching apps. */
export default function NeedsPanel() {
  const [latest, setLatest] = useState(undefined) // undefined=loading, null=none
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let alive = true
    fetchLatestCheck()
      .then((check) => alive && setLatest(check))
      .catch(() => alive && setLatest(null))
    return () => {
      alive = false
    }
  }, [])

  const rows = useMemo(() => {
    if (!latest) return []
    return (latest.inventory_check_items || [])
      .filter((r) => r.status === 'low' || r.status === 'out')
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === 'out' ? -1 : 1
        return a.item_name.localeCompare(b.item_name)
      })
  }, [latest])

  if (latest === undefined || latest === null || rows.length === 0) return null

  const checkedOn = new Date(latest.created_at).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })

  function copyList() {
    const text = rows
      .map((r) => `- ${r.item_name}${r.status === 'out' ? ' (OUT)' : ''}`)
      .join('\n')
    navigator.clipboard
      .writeText(`Needed for the dorm (checked ${checkedOn}):\n${text}\n`)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {})
  }

  const outCount = rows.filter((r) => r.status === 'out').length

  return (
    <section className="needs">
      <button className="needs-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>
          🧾 <strong>{rows.length}</strong> item{rows.length === 1 ? '' : 's'} needed
          {outCount > 0 && <span className="chip out needs-chip">{outCount} out</span>}
        </span>
        <span className="needs-toggle">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="needs-body">
          <div className="needs-meta">From the inventory check on {checkedOn}</div>
          <ul className="needs-list">
            {rows.map((r) => (
              <li key={r.item_id ?? r.item_name} className={r.status === 'out' ? 'out' : ''}>
                {r.item_name}
                {r.status === 'low' && r.qty != null ? ` (${r.qty} left)` : ''}
                <span className="needs-flag">{r.status}</span>
              </li>
            ))}
          </ul>
          <div className="needs-actions">
            <button className="copy-btn" onClick={copyList}>
              {copied ? 'Copied!' : 'Copy list'}
            </button>
            <a className="link-out" href="../">
              Open inventory app →
            </a>
          </div>
        </div>
      )}
    </section>
  )
}
