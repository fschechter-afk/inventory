import { submitSpendingEntry } from './supabase.js'

// Offline outbox: entries logged without a connection wait in localStorage
// and are re-sent the next time the app is online.
const OUTBOX_KEY = 'dormSpending.outbox.v1'

function read() {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []
  } catch {
    return []
  }
}

function write(list) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(list))
}

export function outboxCount() {
  return read().length
}

export function queueEntry(payload) {
  const list = read()
  list.push({ ...payload, queuedAt: new Date().toISOString() })
  write(list)
}

/** Try to send everything in the outbox. Returns how many were sent. */
export async function flushOutbox() {
  let list = read()
  let sent = 0
  while (list.length) {
    try {
      await submitSpendingEntry(list[0])
      list = list.slice(1)
      write(list)
      sent++
    } catch {
      break // still offline (or rejected) — keep the rest for later
    }
  }
  return sent
}
