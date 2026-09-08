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

/** Older than this and it is history, not news. */
const MAX_AGE_HOURS = 24;

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
  const subscriptions = await recipientsFor(db, notification);

  const payload = JSON.stringify({
    title: notification.title || 'WeeklyClass LMS',
    body: notification.message || '',
    image: notification.image || undefined,
    route: notification.route || '/',
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
    pushedAt: new Date(),
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

  if (args.watch) {
    console.log('\n  Watching for new notifications. Ctrl-C to stop.');
    // Polling rather than a listener: this is meant to survive being run on a
    // laptop that sleeps, and a poll recovers from that by itself.
    for (;;) {
      await pass().catch((error) => console.warn('  ! pass failed:', error.message));
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
  }

  const sent = await pass();
  console.log(sent === 0 ? '\n  Nothing waiting.\n' : `\n  Done — ${sent} delivery(s).\n`);
}

run().catch((error) => {
  console.error('\n  ✗', error && error.message ? error.message : error, '\n');
  process.exit(1);
});
