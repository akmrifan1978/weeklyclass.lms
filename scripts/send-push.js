#!/usr/bin/env node
/**
 * Delivers the app's notifications to people's phones.
 *
 * The app writes a notification to Firestore and shows it in its own
 * Notification Centre. That part never needed a server. Putting it on a lock
 * screen does: the Web Push protocol signs each message with a private key,
 * and a private key cannot live in an app that every student can read.
 *
 * So this runs where you control it — a laptop, a cron job, a free worker —
 * and pushes anything that has not been pushed yet.
 *
 * WHAT IT COSTS: nothing. Web Push is a browser standard; the push services
 * (Google's for Chrome, Mozilla's for Firefox, Apple's for Safari) are free
 * and unmetered for this volume. No Blaze plan, no third-party service.
 *
 * Usage
 *   node scripts/send-push.js --key ./serviceAccount.json
 *   node scripts/send-push.js --key ./serviceAccount.json --watch
 *
 * The VAPID private key comes from VAPID_PRIVATE_KEY in .env, which is not in
 * git. Losing it means every existing subscription stops working and everyone
 * has to switch notifications on again — so keep it.
 */

const fs = require('fs');
const path = require('path');
const { sendRegistrationAlerts } = require('./lib/registration-alerts');

/** Older than this and it is history, not news. */
/**
 * How stale a notification may be and still be pushed.
 *
 * Two days rather than one. A push is an interruption and an interruption about
 * last March is noise — but the service that sends these can now be a scheduled
 * job rather than a machine somebody is sitting at, and a single failed weekend
 * should not silently swallow every alert in it. Anything older stays in the
 * app's notification list, which keeps the full history regardless.
 */
const MAX_AGE_HOURS = 48;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const next = argv[i + 1];
    args[token.slice(2)] = next && !next.startsWith('--') ? next : true;
  }
  return args;
}

/**
 * The project, wherever this script was called from.
 *
 * It used to resolve .env and the service-account key against the working
 * directory, so running it from anywhere but the project root failed with
 * "VAPID_PRIVATE_KEY must be set in .env" - which is untrue, and sends you
 * looking in the wrong place entirely. The script knows where it lives; that
 * is the more reliable answer. The working directory is still tried first, so
 * pointing it at a different key on purpose keeps working.
 */
const ROOT = path.resolve(__dirname, '..');

/** The first of these paths that exists, or null. */
function findFile(name) {
  for (const dir of [process.cwd(), ROOT]) {
    const candidate = path.resolve(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Reads .env without adding a dependency for four lines of parsing. */
function loadEnv() {
  const file = findFile('.env');
  if (!file) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
}

/**
 * Who a notification is for.
 *
 * The same audiences the app itself uses, resolved here against the
 * subscriptions rather than the users — a person with no device registered is
 * simply not in the list, which is not a failure.
 */
async function recipientsFor(db, notification) {
  let query = db.collection('pushSubscriptions').where('deleted', '==', false);

  switch (notification.targetRole) {
    case 'user':
      if (!notification.userId) return [];
      query = query.where('userId', '==', notification.userId);
      break;
    case 'class':
      if (!notification.targetClassId) return [];
      query = query.where('classId', '==', notification.targetClassId);
      break;
    case 'branch':
      if (!notification.targetBranchId) return [];
      query = query.where('branchId', '==', notification.targetBranchId);
      break;
    case 'students':
      query = query.where('role', '==', 'student');
      break;
    case 'teachers':
      query = query.where('role', '==', 'teacher');
      break;
    case 'all':
    default:
      break;
  }

  const snap = await query.get();
  return snap.docs;
}

async function sendOne(webpush, db, doc) {
  const notification = doc.data();

  /**
   * Claimed before it is sent, not after.
   *
   * There can now be two of these services running — one on a laptop, one on a
   * schedule in the cloud — and both poll the same queue. Marking a
   * notification only after the push went out leaves a window where both read
   * it as unsent, and the phone buzzes twice for one message.
   *
   * The transaction is the claim: whoever writes `pushedAt` first owns it and
   * the other backs off. A crash between claiming and sending therefore loses
   * that ONE push rather than duplicating it — which is the right way round,
   * because the message is in the app's notification list either way, and a
   * duplicate alert is the failure people actually complain about.
   */
  const claimed = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(doc.ref);
    if (!fresh.exists || fresh.data().pushedAt) return false;
    tx.update(doc.ref, { pushedAt: new Date() });
    return true;
  });

  if (!claimed) return 0;

  const subscriptions = await recipientsFor(db, notification);

  const payload = JSON.stringify({
    title: notification.title || 'WeeklyClass LMS',
    body: notification.message || '',
    image: notification.image || undefined,
    // No page of its own: open the inbox at this notification, so the tap
    // shows the whole message instead of landing on the home screen.
    route: notification.route || `/notifications?open=${doc.id}`,
    id: doc.id,
    /*
     * The notification's own id, and it MUST match the tag the app uses when it
     * raises the same notification itself (see deviceNotify).
     *
     * This tagged by category instead, and the app tagged by id, so the browser
     * saw two unrelated notifications and showed both — the same message twice
     * on one phone. A tag is an identity: two notifications share one only if
     * they are the same notification, and these two are the same notification
     * arriving by two routes.
     *
     * Grouping by category, which this used to do, was worse than it looked
     * anyway: two different notices of the same kind would silently replace one
     * another on the lock screen, so the first was lost unread.
     */
    tag: `note:${doc.id}`,
    timestamp: Date.now(),
  });

  let sent = 0;
  let gone = 0;
  // Kept, not just printed. A run that reported "1 device, 0 sent" and put the
  // reason only on a console nobody was watching is why this went unexplained
  // for days — the record has to carry enough to diagnose it later.
  const errors = [];

  for (const sub of subscriptions) {
    const row = sub.data();
    try {
      await webpush.sendNotification(
        {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        },
        payload,
        { TTL: 60 * 60 * 24 }
      );
      sent += 1;
    } catch (error) {
      const status = error && error.statusCode;
      // 404 and 410 are the push service saying this browser is gone for good
      // — the app was uninstalled, or the subscription expired. Retrying it
      // tomorrow would fail identically, so it is retired.
      if (status === 404 || status === 410) {
        await sub.ref.update({ deleted: true, retiredAt: new Date() });
        gone += 1;
      } else {
        const reason = `${status || ''} ${error.body || error.message || error}`.trim();
        errors.push({ user: row.userName || row.userId || '?', reason: reason.slice(0, 200) });
        console.warn(`  ! ${row.userName || row.userId}: ${reason}`);
      }
    }
  }

  await doc.ref.update({
    pushReport: {
      devices: subscriptions.length,
      sent,
      retired: gone,
      errors: errors.slice(0, 5),
    },
  });

  console.log(
    `  ${JSON.stringify((notification.title || '').slice(0, 40))} -> ` +
      `${sent}/${subscriptions.length} device(s)` +
      (gone ? `, ${gone} retired` : '')
  );
  return sent;
}

/**
 * Turns pending password-reset requests into one-time links.
 *
 * WHY IT LIVES HERE. Only the Admin SDK can mint a reset link, so it has to
 * run on a trusted machine — and there is already exactly one of those,
 * running exactly one loop. A second service would be a second thing to
 * install and a second thing to notice had stopped.
 *
 * The link is written back for the admin to hand over. It is NOT sent
 * anywhere: a reset link is a working credential, and putting one into an
 * email or a message is the thing this design exists to avoid.
 *
 * A failure is recorded on the row rather than dropped, because an admin is
 * sitting in front of the screen waiting and "nothing happened" is not an
 * answer.
 */
async function mintResetLinks(auth, db) {
  const snap = await db
    .collection('passwordResets')
    .where('status', '==', 'pending')
    .limit(10)
    .get();

  if (snap.empty) return 0;

  let made = 0;
  for (const doc of snap.docs) {
    const row = doc.data();
    try {
      // Looked up by uid rather than trusting the address on the row: the
      // request was written by a client, and the account's real sign-in
      // address is something only Auth can answer for.
      const account = await auth.getUser(row.uid);
      if (!account.email) throw new Error('account has no sign-in address');

      const link = await auth.generatePasswordResetLink(account.email);
      await doc.ref.update({
        status: 'ready',
        link,
        email: account.email,
        error: null,
        readyAt: new Date(),
      });
      console.log(`  reset link ready for ${row.userName || row.uid}`);
      made += 1;
    } catch (error) {
      const message = String((error && error.message) || error).slice(0, 200);
      await doc.ref.update({ status: 'failed', error: message, readyAt: new Date() });
      console.warn(`  ! reset link failed for ${row.userName || row.uid}: ${message}`);
    }
  }
  return made;
}

/**
 * Applies password changes an admin queued from the Edit form.
 *
 * The password arrives sealed with this machine's public key, because the
 * only channel between the browser and here is Firestore and a password
 * written there in the clear would land in every nightly backup. Opening it
 * needs the private half, which lives in .env on this machine and nowhere
 * else.
 *
 * THE ROW IS DELETED, not marked done. A sealed password is still a password
 * to anybody who later gets hold of the key, and there is no reason to keep
 * one after it has been applied. The audit entry written by the app is the
 * lasting record; this is just the envelope it travelled in.
 *
 * A failure keeps the row so the admin can see why, but drops the sealed
 * value — whatever went wrong, another attempt has to start from a freshly
 * typed password rather than a stale envelope.
 */
async function applyPasswordChanges(auth, db) {
  const privateKey = process.env.PASSWORD_PRIVATE_KEY;
  if (!privateKey) return 0;

  const snap = await db
    .collection('passwordChanges')
    .where('status', '==', 'pending')
    .limit(10)
    .get();

  if (snap.empty) return 0;

  // eslint-disable-next-line global-require
  const crypto = require('crypto');
  const key = crypto.createPrivateKey({
    key: Buffer.from(privateKey, 'base64'),
    format: 'der',
    type: 'pkcs8',
  });

  let applied = 0;
  for (const doc of snap.docs) {
    const row = doc.data();
    try {
      const password = crypto
        .privateDecrypt(
          { key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
          Buffer.from(row.sealed, 'base64')
        )
        .toString('utf8');

      await auth.updateUser(row.uid, { password });

      // Gone entirely, envelope and all.
      await doc.ref.delete();
      console.log(`  password set for ${row.userName || row.uid}`);
      applied += 1;
    } catch (error) {
      const message = String((error && error.message) || error).slice(0, 200);
      await doc.ref.update({ status: 'failed', error: message, sealed: null });
      console.warn(`  ! password change failed for ${row.userName || row.uid}: ${message}`);
    }
  }
  return applied;
}

/**
 * The booking confirmation email.
 *
 * WHY IT LIVES HERE. The app is a browser page: it has no way to send mail, and
 * the only mail Firebase itself sends is the password reset, whose template
 * belongs to Google and cannot carry an event's details. This service already
 * runs on a machine the centre controls and already watches Firestore for work
 * to do, so the mail goes out from here alongside the push notifications.
 *
 * WHAT IT COSTS. Nothing. It speaks plain SMTP, so it works with any free
 * mailbox — a Gmail account with an app password sends 500 a day, Brevo's free
 * tier 300, and neither needs a domain of your own. Nothing here is tied to a
 * provider; set the five variables and it uses whatever you pointed it at.
 *
 * WITHOUT CONFIGURATION IT DOES NOTHING, and says so once. A centre that has
 * not set up mail still gets every push notification, and the ticket in the app
 * is unaffected — the email is an extra route to the same information, not the
 * only one.
 */
function mailer() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch {
    console.warn('  ! email is configured but nodemailer is missing — run: npm install');
    return null;
  }

  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host,
    port,
    // 465 is implicit TLS; 587 upgrades with STARTTLS. Deriving it from the
    // port rather than asking for a sixth setting nobody would get right.
    secure: port === 465,
    auth: { user, pass },
  });
}

/**
 * The SAME ticket code the app prints on the ticket.
 *
 * Deliberately a copy of eventRegistrationService.ticketCode rather than
 * something simpler: the code in the email is the code somebody reads out at
 * the door, and a second scheme here would hand every attendee a code the
 * organiser's screen does not recognise. If that function ever changes, this
 * one has to change with it.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function ticketCode(registrationId) {
  // FNV-1a. Not for security — only to spread ids that share a long prefix,
  // which every booking for the same event does.
  let hash = 0x811c9dc5;
  for (let i = 0; i < registrationId.length; i += 1) {
    hash ^= registrationId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += CODE_ALPHABET[hash % CODE_ALPHABET.length];
    hash = Math.floor(hash / CODE_ALPHABET.length) + Math.imul(hash, 31);
    hash >>>= 0;
  }
  return code;
}

/** Escapes text going into the HTML body. An event title is somebody's typing. */
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Builds the message.
 *
 * Table-based and inline-styled, which is not how anybody writes a web page and
 * is how mail clients still expect HTML: Outlook ignores most of a stylesheet
 * and several clients strip <style> entirely. A plain-text alternative goes
 * alongside, both because some people read mail that way and because a message
 * with no text part is treated as more likely to be spam.
 */
function confirmationEmail(registration, event, appName) {
  const ticket = ticketCode(String(registration.id || ''));
  const title = registration.eventTitle || event?.title || '';
  const when = [event?.date, event?.startTime].filter(Boolean).join(' at ');
  const where = [event?.venue, event?.location].filter(Boolean).join(', ');
  const whatsapp = event?.registration?.whatsappLink || null;
  const seats = registration.seats || 1;

  const row = (label, value) =>
    !value
      ? ''
      : `<tr>
           <td style="padding:6px 0;color:#6A7C9E;font-size:13px;width:110px;">${escapeHtml(label)}</td>
           <td style="padding:6px 0;color:#111A2E;font-size:14px;font-weight:600;">${escapeHtml(value)}</td>
         </tr>`;

  // Absent entirely when the organiser set no link — no empty heading, no
  // button that goes nowhere.
  //
  // Outside the details table on purpose. Inside it the button inherits that
  // table's narrow value column and wraps its own label onto three lines.
  const joinBlock = whatsapp
    ? `<div style="padding-top:22px;">
         <a href="${escapeHtml(whatsapp)}"
            style="display:block;background:#25D366;color:#ffffff;text-decoration:none;
                   font-size:15px;font-weight:700;padding:14px 20px;border-radius:8px;
                   text-align:center;white-space:nowrap;">
           Join WhatsApp Group
         </a>
         <div style="color:#6A7C9E;font-size:12px;padding-top:8px;">
           Join the group for updates about this event.
         </div>
       </div>`
    : '';

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <!-- Without this a phone lays the message out at desktop width and then
       shrinks the whole thing, which is how a perfectly good email arrives
       looking like a scanned document. -->
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:24px;background:#F5F7FA;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
    <tr><td style="background:#041E4A;padding:20px 24px;color:#ffffff;font-size:16px;font-weight:700;">
      ${escapeHtml(appName)}
    </td></tr>
    <tr><td style="padding:24px;">
      <div style="color:#1B8A5A;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
        Booking confirmed
      </div>
      <div style="color:#041E4A;font-size:20px;font-weight:700;padding-top:6px;">
        ${escapeHtml(title)}
      </div>
      <table role="presentation" cellpadding="0" cellspacing="0" style="padding-top:14px;">
        ${row('When', when)}
        ${row('Where', where)}
        ${row('Places', String(seats))}
        ${row('Ticket', ticket)}
      </table>
      ${joinBlock}
      <div style="color:#6A7C9E;font-size:12px;padding-top:24px;line-height:18px;">
        Show this ticket code at the door. You can also open it any time in the app.
      </div>
    </td></tr>
  </table>
</body></html>`;

  const text = [
    `Booking confirmed - ${title}`,
    when && `When: ${when}`,
    where && `Where: ${where}`,
    `Places: ${seats}`,
    `Ticket: ${ticket}`,
    whatsapp && `Join the WhatsApp group: ${whatsapp}`,
    '',
    'Show this ticket code at the door. You can also open it any time in the app.',
  ]
    .filter(Boolean)
    .join('\n');

  return { subject: `Booking confirmed - ${title}`, html, text };
}

/**
 * Sends one email per confirmed booking that has not had one.
 *
 * The queue is the `confirmationEmailedAt` field: null means owed, a timestamp
 * means claimed. Written by the app when a booking is confirmed and stamped
 * here BEFORE the send, so that two of these services running at once cannot
 * both post the same confirmation.
 *
 * A booking whose owner has no email address is stamped as done rather than
 * retried for ever — plenty of accounts here sign in by mobile number alone,
 * and there is no address to write to.
 */
async function sendConfirmationEmails(db) {
  const transport = mailer();
  if (!transport) return 0;

  const snap = await db
    .collection('eventRegistrations')
    .where('deleted', '==', false)
    .where('status', '==', 'confirmed')
    .where('confirmationEmailedAt', '==', null)
    .limit(25)
    .get();

  if (snap.empty) return 0;

  const settings = await db.collection('settings').doc('app').get();
  const appName = (settings.exists && settings.data().appName) || 'WeeklyClass LMS';
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;

  console.log(`\n  ${snap.size} confirmation email(s) to send`);
  let sent = 0;

  for (const doc of snap.docs) {
    const registration = { id: doc.id, ...doc.data() };
    const to = (registration.userEmail || '').trim();

    if (!to) {
      await doc.ref.update({ confirmationEmailedAt: new Date() });
      console.log(`    - ${registration.userName || doc.id}: no email address, skipped`);
      continue;
    }

    // Claimed before it is sent, for the same reason the push queue is: two
    // services now poll this one, and a booking confirmation arriving twice is
    // worse than one arriving never — the ticket is in the app either way.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists || fresh.data().confirmationEmailedAt) return false;
      tx.update(doc.ref, { confirmationEmailedAt: new Date() });
      return true;
    });
    if (!claimed) continue;

    try {
      const eventSnap = await db
        .collection('calendarEvents')
        .doc(registration.eventId)
        .get();
      const event = eventSnap.exists ? eventSnap.data() : null;

      const message = confirmationEmail(registration, event, appName);
      await transport.sendMail({ from, to, ...message });
      sent += 1;
      console.log(`    ✓ ${to}`);
    } catch (error) {
      console.warn(`    ! ${to}: ${error && error.message ? error.message : error}`);
    }
  }

  return sent;
}

async function run() {
  const args = parseArgs(process.argv);
  loadEnv();

  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const publicKey = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
  if (!privateKey || !publicKey) {
    // Says where it looked. The commonest cause by far is being run from
    // somewhere that is not this project at all.
    console.error(
      '\n  ✗ VAPID_PRIVATE_KEY and EXPO_PUBLIC_VAPID_PUBLIC_KEY are not set.\n' +
        `\n    Looked for .env in:\n      ${process.cwd()}\n      ${ROOT}\n` +
        '\n    Run it from the project folder:\n' +
        `      cd "${ROOT}"\n      npm run push:watch\n`
    );
    process.exit(1);
  }

  let webpush;
  try {
    webpush = require('web-push');
  } catch {
    console.error('\n  ✗ Missing dependency.\n' + `\n    cd "${ROOT}"\n    npm install\n`);
    process.exit(1);
  }

  // The contact address is part of the protocol: a push service that needs to
  // complain about this sender is entitled to somewhere to complain to.
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:support@weeklyclass.app',
    publicKey,
    privateKey
  );

  const keyPath = findFile(
    args.key || process.env.GOOGLE_APPLICATION_CREDENTIALS || 'serviceAccount.json'
  );
  if (!keyPath) {
    console.error(
      '\n  ✗ No service-account key found.\n' +
        `\n    Looked in:\n      ${process.cwd()}\n      ${ROOT}\n` +
        '\n    Firebase console -> Project settings -> Service accounts ->\n' +
        '    Generate new private key, then save it as:\n' +
        `      ${path.join(ROOT, 'serviceAccount.json')}\n`
    );
    process.exit(1);
  }

  const { initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  // The modular auth entry point. The namespaced `require('firebase-admin')`
  // form does not expose .auth() in v13 and later, and fails at the moment it
  // is called rather than at import — so it looked fine until an admin pressed
  // the button.
  // eslint-disable-next-line global-require
  const { getAuth } = require('firebase-admin/auth');
  // eslint-disable-next-line import/no-dynamic-require, global-require
  initializeApp({ credential: cert(require(keyPath)) });
  const db = getFirestore();

  const pass = async () => {
    // Anything sent and not yet pushed. `pushedAt` is the marker, so a
    // notification is never delivered twice however often this runs.
    const snap = await db
      .collection('notifications')
      .where('deleted', '==', false)
      .where('status', '==', 'sent')
      .orderBy('createdAt', 'desc')
      .limit(25)
      .get();

    // Not yet pushed, and not stale.
    //
    // The staleness guard matters on the first run and after any outage: every
    // notification ever sent is unpushed by definition, and without this the
    // first person to switch notifications on would be handed months of
    // backlog at once. A push is an interruption — an interruption about last
    // March is just noise, and the app's own Notification Centre already holds
    // the full history for anyone who wants it.
    const cutoff = Date.now() - MAX_AGE_HOURS * 60 * 60 * 1000;
    const pending = snap.docs.filter((doc) => {
      const data = doc.data();
      if (data.pushedAt) return false;
      const created = data.createdAt && data.createdAt.toDate ? data.createdAt.toDate() : null;
      if (created && created.getTime() < cutoff) {
        // Marked so it is not reconsidered on every pass for the rest of time.
        void doc.ref.update({ pushedAt: new Date(), pushReport: { skipped: 'too old' } });
        return false;
      }
      return true;
    });
    if (pending.length === 0) return 0;

    console.log(`\n  ${pending.length} notification(s) to push`);
    let total = 0;
    for (const doc of pending) total += await sendOne(webpush, db, doc);
    return total;
  };

  // Two jobs, one loop, one thing to keep running.
  const everyPass = async () => {
    const pushed = await pass();
    await mintResetLinks(getAuth(), db).catch((error) =>
      console.warn('  ! reset pass failed:', error.message)
    );
    await applyPasswordChanges(getAuth(), db).catch((error) =>
      console.warn('  ! password pass failed:', error.message)
    );
    await sendConfirmationEmails(db).catch((error) =>
      console.warn('  ! email pass failed:', error.message)
    );
    // New registrations waiting for approval: email, the admins' devices, and
    // WhatsApp where it has been switched on. Once each. See the lib file.
    await sendRegistrationAlerts({
      db,
      webpush,
      transport: mailer(),
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
    }).catch((error) => console.warn('  ! registration alert pass failed:', error.message));
    return pushed;
  };

  if (args.watch) {
    console.log('\n  Watching for new notifications. Ctrl-C to stop.');
    // Polling rather than a listener: this is meant to survive being run on a
    // laptop that sleeps, and a poll recovers from that by itself.
    for (;;) {
      await everyPass().catch((error) => console.warn('  ! pass failed:', error.message));
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }

  const sent = await everyPass();
  console.log(sent === 0 ? '\n  Nothing waiting.\n' : `\n  Done — ${sent} delivery(s).\n`);
}

// Only when this file is the thing being run. Requiring it — which is how the
// email template is checked without sending anything — should not start a
// service that polls Firestore.
if (require.main === module) {
  run().catch((error) => {
    console.error('\n  ✗', error && error.message ? error.message : error, '\n');
    process.exit(1);
  });
}

module.exports = { confirmationEmail, escapeHtml, ticketCode };
