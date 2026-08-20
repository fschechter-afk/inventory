import { submitCheck, submitSpendingEntry } from './supabase.js'

// Offline outbox: things submitted without a connection wait in
// localStorage and are re-sent the next time the app is online.
const OUTBOX_KEY = 'dormInventory.outbox.v1'

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

export function queueCheck(payload) {
  const list = read()
  list.push({ type: 'check', payload, queuedAt: new Date().toISOString() })
  write(list)
}

export function queueSpending(payload) {
  const list = read()
  list.push({ type: 'spending', payload, queuedAt: new Date().toISOString() })
  write(list)
}

/** Try to send everything in the outbox. Returns how many were sent. */
export async function flushOutbox() {
  let list = read()
  let sent = 0
  while (list.length) {
    const entry = list[0]
    try {
      // Entries queued before the `type` field existed are bare check
      // payloads (no wrapper) — treat anything untagged as a check.
      if (entry.type === 'spending') {
        await submitSpendingEntry(entry.payload)
      } else {
        await submitCheck(entry.payload ?? entry)
      }
      list = list.slice(1)
      write(list)
      sent++
    } catch {
      break // still offline (or rejected) — keep the rest for later
    }
  }
  return sent
}
