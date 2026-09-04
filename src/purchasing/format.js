// Small formatting + export helpers shared across the portal.

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function money(n) {
  const v = Number(n)
  return MONEY.format(Number.isFinite(v) ? v : 0)
}

/** Compact money for dashboard tiles: $12.4k, $1.2M. */
export function moneyShort(n) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 10_000) return `$${(v / 1000).toFixed(1)}k`
  return money(v)
}

export function toNumber(v) {
  if (v === '' || v == null) return null
  const n = Number(String(v).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

/** `new Date('2026-09-04')` is parsed as UTC midnight, which renders as
 *  September 3rd anywhere west of Greenwich. Date-only strings are calendar
 *  dates, so they are built in local time instead. */
function asDate(value) {
  if (value instanceof Date) return value
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) return new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3])
  return new Date(value)
}

export function shortDate(d) {
  if (!d) return ''
  return asDate(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function longDate(d) {
  if (!d) return ''
  return asDate(d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function relativeTime(iso) {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 90) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return shortDate(iso)
}

/** `YYYY-MM-DD` in the browser's own timezone (not UTC, which shifts the day
 *  backwards for anyone west of Greenwich after 5pm). */
export function isoDate(d = new Date()) {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

/** Start of today / this week (Sunday) / this month / this year, as isoDate. */
export function periodStart(period, now = new Date()) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  if (period === 'week') d.setDate(d.getDate() - d.getDay())
  if (period === 'month') d.setDate(1)
  if (period === 'year') {
    d.setMonth(0)
    d.setDate(1)
  }
  return isoDate(d)
}

export const STATUSES = [
  'pending_approval',
  'rejected',
  'ordered',
  'shipped',
  'delivered',
  'returned',
  'cancelled',
]

export const STATUS_LABEL = {
  pending_approval: 'Awaiting approval',
  rejected: 'Rejected',
  ordered: 'Ordered',
  shipped: 'Shipped',
  delivered: 'Delivered',
  returned: 'Returned',
  cancelled: 'Cancelled',
}

/** Statuses an employee may set on their own order, given where it is now. */
export function nextStatuses(current) {
  if (current === 'pending_approval' || current === 'rejected') return []
  return ['ordered', 'shipped', 'delivered', 'returned', 'cancelled']
}

/** Spending that counts against a budget. Mirrors pp_budget_status() in SQL. */
export function countsTowardSpend(status) {
  return !['rejected', 'cancelled', 'returned'].includes(status)
}

export const ROLE_LABEL = {
  employee: 'Employee',
  manager: 'Department manager',
  admin: 'Administrator',
  super_admin: 'Super admin',
}

// --- CSV export ------------------------------------------------------------

function csvCell(value) {
  if (value == null) return ''
  const s = String(value)
  // A leading =, +, - or @ makes Excel treat the cell as a formula.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Build a CSV string. `columns` is [{ key, label, value? }]. */
export function toCsv(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(',')
  const body = rows.map((row) =>
    columns.map((c) => csvCell(c.value ? c.value(row) : row[c.key])).join(',')
  )
  return [head, ...body].join('\r\n')
}

/** Download a CSV. The BOM is what makes Excel read UTF-8 correctly. */
export function downloadCsv(filename, rows, columns) {
  const blob = new Blob(['﻿', toCsv(rows, columns)], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Sum `total` by a key, returning [{ key, label, total, count }] descending. */
export function groupTotals(rows, keyOf, labelOf = keyOf) {
  const map = new Map()
  for (const row of rows) {
    const key = keyOf(row) ?? '—'
    let entry = map.get(key)
    if (!entry) {
      entry = { key, label: labelOf(row) ?? '—', total: 0, count: 0 }
      map.set(key, entry)
    }
    entry.total += Number(row.total) || 0
    entry.count += 1
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}
