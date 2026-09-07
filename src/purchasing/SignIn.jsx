import { useState } from 'react'
import { signIn, signUp } from './api.js'
import { Field, friendlyError } from './ui.jsx'

export default function SignIn({ onSignedIn }) {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
        onSignedIn()
      } else {
        const { needsConfirmation } = await signUp(email, password, fullName)
        if (needsConfirmation) {
          setNotice('Account created. Check your email for a confirmation link, then sign in.')
          setMode('signin')
        } else {
          onSignedIn()
        }
      }
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pp-signin">
      <form className="pp-signin-card" onSubmit={submit}>
        <h1>LGHS Shopping Portal</h1>
        <p className="pp-signin-sub">
          {mode === 'signin'
            ? 'Sign in with your school email'
            : 'Set up your account with the email your administrator invited'}
        </p>

        {error && <div className="pp-error">{friendlyError(error)}</div>}
        {notice && <div className="pp-notice good">{notice}</div>}

        {mode === 'signup' && (
          <Field label="Your name">
            <input
              className="pp-input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              required
            />
          </Field>
        )}

        <Field label="School email">
          <input
            className="pp-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoCapitalize="none"
            required
          />
        </Field>

        <Field label="Password" hint={mode === 'signup' ? 'At least 8 characters.' : null}>
          <input
            className="pp-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={mode === 'signup' ? 8 : undefined}
            required
          />
        </Field>

        <button className="pp-btn" disabled={busy}>
          {busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>

        <button
          type="button"
          className="pp-link"
          style={{ display: 'block', margin: '12px auto 0' }}
          onClick={() => {
            setMode(mode === 'signin' ? 'signup' : 'signin')
            setError(null)
            setNotice(null)
          }}
        >
          {mode === 'signin' ? 'First time here? Set up your account' : 'I already have an account'}
        </button>

        <p className="pp-muted" style={{ textAlign: 'center', marginTop: 16, lineHeight: 1.5 }}>
          Access is by invitation. If sign-up says your account has no access, ask an
          administrator to invite your email address.
        </p>

        <p className="pp-muted" style={{ textAlign: 'center', marginTop: 10, fontSize: '0.7rem' }}>
          Version {__BUILD_ID__}
        </p>
      </form>
    </div>
  )
}
