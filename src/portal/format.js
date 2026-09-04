const currency = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
})

export function money(amount) {
  return currency.format(Number(amount) || 0)
}

/** 'YYYY-MM-DD' -> 'Thu, Sep 4'. Parsed as a plain date, not UTC midnight,
 *  so a purchase never shows up on the day before. */
export function dayLabel(isoDate) {
  const [y, m, d] = String(isoDate).split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export function todayISO() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** First day of the month, `back` months ago, as 'YYYY-MM-DD'. */
export function monthStartISO(back = 0) {
  const now = new Date()
  const d = new Date(now.getFullYear(), now.getMonth() - back, 1)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`
}
