import { useEffect, useState } from 'react'
import { fetchHistory } from '../supabase.js'

export default function History() {
  const [entries, setEntries] = useState(undefined)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchHistory()
      .then(setEntries)
      .catch((e) => {
        console.error('History fetch failed:', e)
        setError("Couldn't load history — are you online?")
      })
  }, [])

  if (error) return <div className="list-view"><div className="rl-meta">{error}</div></div>
  if (entries === undefined)
    return <div className="list-view"><div className="rl-meta">Loading past submissions…</div></div>
  if (entries.length === 0)
    return <div className="list-view"><div className="rl-empty">No submissions yet.</div></div>

  return (
    <div className="list-view">
      <div className="rl-meta">
        Last {entries.length} submission{entries.length === 1 ? '' : 's'}
      </div>
      {entries.map((entry) => {
        const when = new Date(entry.created_at).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
        return (
          <div className="hist-entry" key={entry.id}>
            <div className="hist-top">
              <span className="hist-name">{entry.filled_by}</span>
              <span className="hist-date">{when}</span>
            </div>
            <div className="hist-counts">
              <span className="chip low">{entry.low_count} low</span>
              <span className="chip out">{entry.out_count} out</span>
            </div>
            {(entry.pantry_video_url || entry.closet_video_url) && (
              <div className="hist-links">
                {entry.pantry_video_url && (
                  <a href={entry.pantry_video_url} target="_blank" rel="noreferrer">
                    Pantry video
                  </a>
                )}
                {entry.closet_video_url && (
                  <a href={entry.closet_video_url} target="_blank" rel="noreferrer">
                    Closet video
                  </a>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
