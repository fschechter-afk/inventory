import { submitCheck } from './supabase.js'
import { logPurchase } from './portal/api.js'

// Offline outbox: anything submitted without a connection waits in
// localStorage and is re-sent the next time the device is online.
const OUTBOX_KEY = 'dormInventory.outbox.v1'

// Entries carry a `kind` saying which sender takes them. Entries queued
// before the portal existed have no kind, and are inventory checks.
const SENDERS = {
  check: submitCheck,
  purchase: logPurchase,
}

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

function kindOf(entry) {
  return entry.kind || 'check'
}

/** How many entries are waiting; pass a kind to count just those. */
export function outboxCount(kind) {
  const list = read()
  return kind ? list.filter((e) => kindOf(e) === kind).length : list.length
}

export function queueCheck(payload) {
  queue('check', payload)
}

export function queuePurchase(payload) {
  queue('purchase', payload)
}

function queue(kind, payload) {
  const list = read()
  list.push({ ...payload, kind, queuedAt: new Date().toISOString() })
  write(list)
}

/** Try to send everything in the outbox. Returns how many were sent. */
export async function flushOutbox() {
  let list = read()
  let sent = 0
  while (list.length) {
    const entry = list[0]
    const send = SENDERS[kindOf(entry)]
    if (!send) {
      // Unknown kind (a downgrade, or a corrupted entry): drop it rather
      // than blocking everything queued behind it.
      list = list.slice(1)
      write(list)
      continue
    }
    try {
      await send(entry)
      list = list.slice(1)
      write(list)
      sent++
    } catch {
      break // still offline (or rejected) — keep the rest for later
    }
  }
  return sent
}
