import { useEffect, useState } from 'react'
import { STATUS_LABEL } from './format.js'

export function Field({ label, hint, children }) {
  return (
    <label className="pp-field">
      <span className="pp-field-label">{label}</span>
      {children}
      {hint && <span className="pp-field-hint">{hint}</span>}
    </label>
  )
}

export function StatusPill({ status }) {
  return <span className={`pp-pill pp-pill-${status}`}>{STATUS_LABEL[status] || status}</span>
}

export function ReceiptPill({ count, required = true }) {
  if (count > 0) return <span className="pp-pill pp-pill-ok">Receipt ✓</span>
  if (!required) return null
  return <span className="pp-pill pp-pill-missing">Receipt missing</span>
}

export function Empty({ icon = '📭', title, children }) {
  return (
    <div className="pp-empty">
      <div className="pp-empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  )
}

export function Loading({ label = 'Loading…' }) {
  return <div className="pp-loading">{label}</div>
}

export function ErrorNote({ error, onRetry }) {
  if (!error) return null
  return (
    <div className="pp-error">
      <strong>Something went wrong.</strong> {friendlyError(error)}
      {onRetry && (
        <button className="pp-link" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

/** Postgres and GoTrue errors are precise but not written for a person who is
 *  trying to buy paper towels. */
export function friendlyError(error) {
  const message = error?.message || String(error || '')
  if (/Invalid login credentials/i.test(message)) return 'That email and password did not match.'
  if (/Email not confirmed/i.test(message))
    return 'This account still needs to be confirmed — check your email, or ask an administrator.'
  if (/User already registered/i.test(message)) return 'That email already has an account — sign in instead.'
  if (/Only a manager or administrator/i.test(message))
    return 'Approving a purchase is a manager’s decision.'
  if (/violates row-level security/i.test(message))
    return 'You do not have permission to change this.'
  if (/duplicate key.*departments_name/i.test(message)) return 'A department with that name already exists.'
  if (/duplicate key/i.test(message)) return 'That already exists.'
  if (/Failed to fetch|NetworkError/i.test(message))
    return 'No connection. Check the network and try again.'
  return message
}

export function Modal({ title, onClose, children, wide = false }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div className="pp-modal-backdrop" onClick={onClose}>
      <div
        className={`pp-modal ${wide ? 'wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="pp-modal-head">
          <h2>{title}</h2>
          <button className="pp-modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="pp-modal-body">{children}</div>
      </div>
    </div>
  )
}

/** A labelled proportion bar — used for budgets and for every "spending by X"
 *  breakdown, so they all read the same way. */
export function Bar({ label, value, max, caption, tone = 'plum' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="pp-bar-row">
      <div className="pp-bar-head">
        <span className="pp-bar-label">{label}</span>
        <span className="pp-bar-value">{caption}</span>
      </div>
      <div className="pp-bar-track">
        <div className={`pp-bar-fill tone-${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function Stat({ label, value, sub }) {
  return (
    <div className="pp-stat">
      <div className="pp-stat-label">{label}</div>
      <div className="pp-stat-value">{value}</div>
      {sub && <div className="pp-stat-sub">{sub}</div>}
    </div>
  )
}

/** Debounced text input, so typing in a search box does not fire a query per
 *  keystroke. */
export function SearchInput({ value, onChange, placeholder }) {
  const [local, setLocal] = useState(value || '')
  useEffect(() => setLocal(value || ''), [value])
  useEffect(() => {
    const t = setTimeout(() => {
      if (local !== value) onChange(local)
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local])
  return (
    <input
      type="search"
      className="pp-input"
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
    />
  )
}

export function Toast({ message }) {
  return <div className={`toast ${message ? 'show' : ''}`}>{message}</div>
}
