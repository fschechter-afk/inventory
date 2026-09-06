export const LOCATIONS = ['Dorm', 'School', 'Shul']

/** Asked once, before the store opens: where should this land? Michelle's
 *  whole queue is organised around the answer, so it's worth the one tap. */
export default function WhereTo({ site, onPick, onCancel }) {
  return (
    <div className="screen overlay">
      <div className="start-card">
        <h1>Ordering from {site.name}</h1>
        <div className="start-sub">Where should it be delivered?</div>

        <div className="where-grid">
          {LOCATIONS.map((place) => (
            <button key={place} className="where-btn" onClick={() => onPick(place)}>
              {place}
            </button>
          ))}
        </div>

        <p className="where-note">
          This is what Michelle checks against when it arrives — it&apos;s how an order gets found
          if it turns up somewhere unexpected.
        </p>

        <button className="back-link" onClick={() => onPick(null)}>
          Not sure yet — open the store anyway
        </button>
        <button className="back-link" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
