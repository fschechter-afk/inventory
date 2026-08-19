import { useState } from 'react'

export default function FinalStep({ submitting, onSubmit, onBack }) {
  const [pantry, setPantry] = useState('')
  const [closet, setCloset] = useState('')

  return (
    <div className="screen overlay">
      <div className="start-card">
        <h1>Almost done</h1>
        <div className="start-sub">Add photo/video links if you have them, then submit.</div>
        <label className="field-label" htmlFor="pantryVideo">
          Pantry video (optional link)
        </label>
        <input
          id="pantryVideo"
          type="url"
          placeholder="Paste video/photo link"
          value={pantry}
          onChange={(e) => setPantry(e.target.value)}
        />
        <label className="field-label" htmlFor="closetVideo">
          Storage closet video (optional link)
        </label>
        <input
          id="closetVideo"
          type="url"
          placeholder="Paste video/photo link"
          value={closet}
          onChange={(e) => setCloset(e.target.value)}
        />
        <button
          className="submit-btn"
          disabled={submitting}
          onClick={() =>
            onSubmit({ pantryVideoUrl: pantry.trim(), closetVideoUrl: closet.trim() })
          }
        >
          {submitting ? 'Submitting…' : 'Submit Inventory Check'}
        </button>
        <button className="back-link" onClick={onBack}>
          Back to list
        </button>
      </div>
    </div>
  )
}
