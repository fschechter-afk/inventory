/**
 * Reads order confirmations out of onlineorders@lghschicago.org and files them
 * in the ordering portal, so nobody has to log an online order by hand.
 *
 * Setup is in automation/README.md. In short: paste this into a new Apps
 * Script project signed in as the mailbox, run importOrders() once to grant
 * access, then add a time-driven trigger for every 15 minutes.
 */

// ---------------------------------------------------------------- settings

// The same publishable key the portal ships with. Row Level Security is what
// limits it: it can add a purchase and read the lists, nothing more.
var SUPABASE_URL = 'https://aheiyytqvzxkoowykkgt.supabase.co'
var SUPABASE_KEY = 'sb_publishable_gWE8hOq2mvCLmoq6wYJxJg_U42BMp18'

// Stores whose confirmations should be imported, and what the money usually
// counts as. Add a store here and in the portal's order_sites table.
var STORES = [
  { name: 'Amazon', from: 'amazon.com', spentOn: 'Supplies' },
  { name: 'Walmart', from: 'walmart.com', spentOn: 'Food' },
  { name: "Sam's Club", from: 'samsclub.com', spentOn: 'Food' },
  { name: 'WebstaurantStore', from: 'webstaurantstore.com', spentOn: 'Kitchen' },
]

var LABEL = 'Logged to portal'
var LOOKBACK = '14d' // how far back each run looks
var MAX_THREADS = 50 // per run, so one backlog can't run past the time limit

// ------------------------------------------------------------------ import

/** Entry point. Point the time-driven trigger at this. */
function importOrders() {
  var label = GmailApp.getUserLabelByName(LABEL) || GmailApp.createLabel(LABEL)
  var froms = STORES.map(function (s) {
    return 'from:' + s.from
  }).join(' OR ')

  // Confirmations only: shipping, delivery and cancellation notices repeat the
  // same total and would otherwise be counted a second time.
  var query =
    'newer_than:' + LOOKBACK +
    ' (' + froms + ')' +
    ' -label:"' + LABEL + '"' +
    ' -subject:(shipped OR "on the way" OR delivered OR "out for delivery" OR' +
    ' cancel OR canceled OR cancelled OR return OR refund OR review)'

  var threads = GmailApp.search(query, 0, MAX_THREADS)
  var imported = 0
  var skipped = 0

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages()
    var handledThread = false

    for (var m = 0; m < messages.length; m++) {
      var result = importMessage(messages[m])
      if (result === 'imported') {
        imported++
        handledThread = true
      } else if (result === 'duplicate') {
        handledThread = true
      } else {
        skipped++
      }
    }
    // Only label a thread we actually understood; anything skipped stays
    // unlabelled so a fix to the parser can pick it up on a later run.
    if (handledThread) threads[t].addLabel(label)
  }

  Logger.log('Imported ' + imported + ', skipped ' + skipped + ', of ' + threads.length + ' threads')
}

function importMessage(message) {
  var subject = message.getSubject() || ''
  var body = message.getPlainBody() || ''
  var from = message.getFrom() || ''
  var text = subject + '\n' + from + '\n' + body

  // Marketing mail quotes prices too. Require it to read like a confirmation.
  if (!/order\s*(confirmation|receipt|placed|summary|#|number)|thanks?\s+(you\s+)?for\s+your\s+order|your\s+order|we\s+received\s+your\s+order/i.test(subject + '\n' + body)) {
    return 'skipped'
  }

  var store = matchStore(from, text)
  var amount = findTotal(body)
  if (!store || amount === null) return 'skipped'

  var orderNumber = findOrderNumber(text)
  var purchasedOn = toIsoDate(message.getDate())

  // One order, one row — even when a store sends several emails about it.
  // Falling back to the message id keeps unnumbered receipts from colliding.
  var sourceRef = orderNumber
    ? store.name + '#' + orderNumber
    : 'gmail:' + message.getId()

  var notes = orderNumber ? 'Order ' + orderNumber : subject.slice(0, 120)

  var response = post('import_purchase_from_email', {
    p_source_ref: sourceRef,
    p_site_name: store.name,
    p_amount: amount,
    p_spent_on: store.spentOn,
    p_notes: notes,
    p_purchased_on: purchasedOn,
    p_ordered_by: null, // a shared mailbox doesn't say who — claimed in the portal
  })

  if (response.code >= 300) {
    Logger.log('Import failed (' + response.code + ') for "' + subject + '": ' + response.body)
    return 'skipped'
  }
  // The function returns null when that order was already imported.
  return /^\s*null\s*$/.test(response.body) ? 'duplicate' : 'imported'
}

function post(fn, payload) {
  var res = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  })
  return { code: res.getResponseCode(), body: res.getContentText() }
}

// ------------------------------------------------------------------ parsing
// Same rules as src/portal/receipt.js, which the portal uses for pasted
// receipts. Keep the two in step when either changes.

var TOTAL_LABELS = [
  { re: /(order|grand|payment|invoice|purchase)\s+total/i, score: 5 },
  { re: /total\s+(charged|paid|billed|due|for\s+this\s+order)/i, score: 5 },
  { re: /(amount|total)\s+(charged|billed|paid)/i, score: 5 },
  { re: /you\s+(paid|were\s+charged)/i, score: 5 },
  { re: /charged\s+to|card\s+ending/i, score: 4 },
  { re: /\btotal\b/i, score: 3 },
]

var NOT_TOTAL =
  /sub-?total|before\s+tax|savings|you\s+saved|discount|coupon|shipping|delivery\s+fee|service\s+fee|\btax\b|\btip\b|gift\s+card|balance|each\b|\bper\b|item\s+price/i

function contextFor(text, index) {
  var lineStart = text.lastIndexOf('\n', index) + 1
  var before = text.slice(Math.max(lineStart, index - 70), index)
  var prevStart = lineStart > 1 ? text.lastIndexOf('\n', lineStart - 2) + 1 : 0
  var prevLine = lineStart > 0 ? text.slice(prevStart, Math.max(prevStart, lineStart - 1)) : ''
  return prevLine + ' ' + before
}

function findTotal(text) {
  var money = /(?:\$|USD\s*)\s?(\d[\d,]*\.\d{2})(?![\d.])/gi
  var best = null
  var m
  while ((m = money.exec(text)) !== null) {
    var amount = parseFloat(m[1].replace(/,/g, ''))
    if (!isFinite(amount)) continue
    var ctx = contextFor(text, m.index)
    var score = 0
    for (var i = 0; i < TOTAL_LABELS.length; i++) {
      if (TOTAL_LABELS[i].re.test(ctx)) {
        score = TOTAL_LABELS[i].score
        break
      }
    }
    if (score < 5 && NOT_TOTAL.test(ctx)) continue
    if (score === 0) continue
    if (!best || score > best.score || (score === best.score && amount > best.amount)) {
      best = { amount: amount, score: score }
    }
  }
  return best ? best.amount : null
}

function squash(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function matchStore(from, text) {
  var fromSquashed = squash(from)
  // The sender is the strongest signal: an Amazon email mentioning Walmart is
  // still an Amazon order.
  for (var i = 0; i < STORES.length; i++) {
    if (fromSquashed.indexOf(squash(STORES[i].from)) !== -1) return STORES[i]
  }
  var hay = squash(text)
  var best = null
  for (var j = 0; j < STORES.length; j++) {
    var at = hay.indexOf(squash(STORES[j].name))
    if (at !== -1 && (!best || at < best.at)) best = { store: STORES[j], at: at }
  }
  return best ? best.store : null
}

function findOrderNumber(text) {
  var m = /order\s*(?:#|no\.?|number)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9-]{4,24})/i.exec(text)
  return m ? m[1] : null
}

function toIsoDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
}

// ------------------------------------------------------------------- checks

/** Run this by hand to see what the importer makes of recent mail, without
 *  writing anything to the portal. */
function dryRun() {
  var froms = STORES.map(function (s) { return 'from:' + s.from }).join(' OR ')
  var threads = GmailApp.search('newer_than:' + LOOKBACK + ' (' + froms + ')', 0, 20)
  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages()
    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m]
      var store = matchStore(msg.getFrom() || '', (msg.getSubject() || '') + (msg.getPlainBody() || ''))
      Logger.log(
        [
          toIsoDate(msg.getDate()),
          store ? store.name : '(no store)',
          findTotal(msg.getPlainBody() || ''),
          findOrderNumber((msg.getSubject() || '') + '\n' + (msg.getPlainBody() || '')),
          (msg.getSubject() || '').slice(0, 60),
        ].join('  |  ')
      )
    }
  }
}
