import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchSpendingCategories, submitSpendingEntry, uploadReceipt } from './supabase.js'
import { flushOutbox, outboxCount, queueEntry } from './outbox.js'
import StartScreen from './components/StartScreen.jsx'
import EntryForm from './components/EntryForm.jsx'

export default function App() {
  const [categories, setCategories] = useState(null)
  const [categoriesError, setCategoriesError] = useState(null)
  const [fromCache, setFromCache] = useState(false)
  const [filledBy, setFilledBy] = useState('')
  const [started, setStarted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [pending, setPending] = useState(outboxCount())
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)

  const showToast = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2600)
  }, [])

  useEffect(() => {
    fetchSpendingCategories()
      .then((cats) => {
        setCategories(cats)
        setFromCache(false)
      })
      .catch((e) => setCategoriesError(e.message || String(e)))
  }, [])

  useEffect(() => {
    const flush = () =>
      flushOutbox().then((sent) => {
        setPending(outboxCount())
        if (sent > 0) showToast(`Synced ${sent} saved entr${sent === 1 ? 'y' : 'ies'}`)
      })
    flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [showToast])

  async function handleSubmit({ spentOn, category, amount, vendor, note, receiptFile }) {
    setSubmitting(true)
    const base = { filledBy, spentOn, category, amount, vendor, note }
    let receiptUrl = null
    let photoFailed = false

    try {
      if (receiptFile) {
        try {
          receiptUrl = await uploadReceipt(receiptFile)
        } catch {
          photoFailed = true // still log the expense — just without the photo
        }
      }
      await submitSpendingEntry({ ...base, receiptUrl })
      showToast(photoFailed ? 'Logged — but the photo failed to upload' : 'Expense logged!')
    } catch (e) {
      if (navigator.onLine === false || /fetch|network/i.test(e.message || '')) {
        queueEntry({ ...base, receiptUrl: null })
        setPending(outboxCount())
        showToast(
          receiptFile
            ? 'No connection — saved without the photo, will send automatically'
            : 'No connection — saved on this device, will send automatically'
        )
      } else {
        console.error('Submit failed:', e)
        showToast('Something went wrong — try again')
      }
    }
    setSubmitting(false)
  }

  if (!started) {
    return (
      <>
        <StartScreen
          categoriesReady={!!categories}
          categoriesError={categoriesError}
          fromCache={fromCache}
          pending={pending}
          onBegin={(name) => {
            setFilledBy(name)
            setStarted(true)
          }}
        />
        <Toast msg={toast} />
      </>
    )
  }

  return (
    <>
      <header className="app-header">
        <h1>Dorm Spending</h1>
        <div className="sub">Logging as {filledBy}</div>
      </header>
      <EntryForm categories={categories} submitting={submitting} onSubmit={handleSubmit} />
      <Toast msg={toast} />
    </>
  )
}

function Toast({ msg }) {
  return <div className={`toast ${msg ? 'show' : ''}`}>{msg}</div>
}
