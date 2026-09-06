/**
 * LGHS Shopping Portal — order email watcher.
 *
 * Reads new vendor order-confirmation emails from a Google Workspace mailbox
 * and posts them to the portal, which parses them and records the purchase.
 *
 * Google Apps Script is used rather than an inbound-email provider because the
 * school already has Workspace: no DNS changes, no MX records, no third-party
 * mail vendor, no monthly cost, and the mail never leaves Google except to go
 * to the school's own Supabase project.
 *
 * ── Setup ────────────────────────────────────────────────────────────────
 * 1. Sign in to Google as the mailbox that receives the order emails
 *    (e.g. orders@lghschicago.org), then open https://script.google.com and
 *    create a new project. Paste this file in.
 * 2. Project Settings → Script properties, add:
 *      INGEST_URL     https://aheiyytqvzxkoowykkgt.supabase.co/functions/v1/ingest-order-email
 *      INGEST_SECRET  <the same value set as the INGEST_SECRET Edge Function secret>
 * 3. Run `installTrigger` once and approve the permission prompt.
 * 4. Watch it work: run `runOnce` and check View → Executions.
 *
 * ── Getting the orders into this mailbox ─────────────────────────────────
 * Any one of these, per vendor — all are one-time setup, never per order:
 *   • Set this address as the account email on the school's vendor accounts.
 *   • Add it as a secondary/notification address in the vendor account.
 *   • Add a Gmail filter on a staff member's account that auto-forwards
 *     order confirmations here.
 */

var LOOKBACK_DAYS = 7;
var BATCH_SIZE = 25;
var PROCESSED_LABEL = 'Portal/Ingested';

/** Gmail search for things that look like order confirmations. Shipping and
 *  marketing mail is filtered again on the server, so being a little broad
 *  here is fine — anything that is not an order is recorded as 'ignored'. */
function buildQuery_() {
  return (
    'newer_than:' + LOOKBACK_DAYS + 'd ' +
    '-label:' + PROCESSED_LABEL + ' ' +
    '(category:purchases OR subject:(order OR receipt OR invoice OR purchase))'
  );
}

function runOnce() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('INGEST_URL');
  var secret = props.getProperty('INGEST_SECRET');
  if (!url || !secret) {
    throw new Error('Set INGEST_URL and INGEST_SECRET in Project Settings → Script properties');
  }

  var label = GmailApp.getUserLabelByName(PROCESSED_LABEL) ||
              GmailApp.createLabel(PROCESSED_LABEL);

  var threads = GmailApp.search(buildQuery_(), 0, BATCH_SIZE);
  var sent = 0, failed = 0;

  for (var t = 0; t < threads.length; t++) {
    var messages = threads[t].getMessages();
    var threadOk = true;

    for (var m = 0; m < messages.length; m++) {
      var message = messages[m];
      try {
        var response = UrlFetchApp.fetch(url, {
          method: 'post',
          contentType: 'application/json',
          headers: { 'x-ingest-secret': secret },
          muteHttpExceptions: true,
          payload: JSON.stringify({
            // The portal dedupes on this, so a retry cannot create a second
            // purchase.
            messageId: message.getId(),
            from: message.getFrom(),
            to: message.getTo(),
            subject: message.getSubject(),
            body: message.getPlainBody().slice(0, 180000),
            receivedAt: message.getDate().toISOString()
          })
        });

        var code = response.getResponseCode();
        if (code >= 200 && code < 300) {
          sent++;
          Logger.log('%s → %s', message.getSubject(), response.getContentText());
        } else {
          failed++;
          threadOk = false;
          Logger.log('HTTP %s for "%s": %s', code, message.getSubject(), response.getContentText());
        }
      } catch (err) {
        failed++;
        threadOk = false;
        Logger.log('Error on "%s": %s', message.getSubject(), err);
      }
    }

    // Only label the thread once every message in it landed, so a transient
    // failure is retried on the next run rather than silently dropped.
    if (threadOk) threads[t].addLabel(label);
  }

  Logger.log('Done: %s sent, %s failed, %s threads', sent, failed, threads.length);
  return { sent: sent, failed: failed };
}

/** Run every 15 minutes. Safe to run again — it replaces the old trigger. */
function installTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'runOnce') ScriptApp.deleteTrigger(existing[i]);
  }
  ScriptApp.newTrigger('runOnce').timeBased().everyMinutes(15).create();
  Logger.log('Trigger installed: runOnce every 15 minutes');
}

function removeTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'runOnce') ScriptApp.deleteTrigger(existing[i]);
  }
  Logger.log('Trigger removed');
}
