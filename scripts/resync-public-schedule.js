#!/usr/bin/env node
/**
 * Rebuilds `publicSchedule` from `calendarEvents`.
 *
 * The public copy is written whenever an event is saved, so it is normally
 * correct without anyone thinking about it. This exists for the one case that
 * breaks: the rules for what gets mirrored changed, and events saved under the
 * old rules are still filed under it. Re-saving every event by hand in the
 * admin screen would do the same job, one click at a time.
 *
 * The current rule, which this applies:
 *   mirrored     - anything open to everybody, class or ticketed event
 *   not mirrored - anything scoped to a single class, which is a private
 *                  arrangement and not a public advertisement
 *
 * Idempotent, and safe to run whenever the two look out of step.
 *
 *   node scripts/resync-public-schedule.js --key ./serviceAccount.json
 */

const path = require('path');

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

/** Same shape `calendarService.syncPublicSchedule` writes. */
function publicCopy(event) {
  const [y, m, d] = String(event.date || '').split('-').map(Number);
  const [hh, mm] = String(event.startTime || '').split(':').map(Number);
  const startsAt = new Date(y || 1970, (m || 1) - 1, d || 1, hh || 0, mm || 0, 0, 0);

  return {
    title: event.title ?? '',
    description: event.description ?? null,
    date: event.date ?? '',
    startTime: event.startTime ?? '',
    endTime: event.endTime ?? '',
    venue: event.venue ?? null,
    location: event.location ?? null,
    topic: event.topic ?? null,
    speaker: event.speaker ?? null,
    bannerUrl: event.bannerUrl ?? null,
    takesBookings: Boolean(event.registration),
    startsAt,
    deleted: false,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  const keyPath = args.key || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    console.error('\n  ✗ Pass --key <serviceAccount.json>\n');
    process.exit(1);
  }

  const { initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  // eslint-disable-next-line import/no-dynamic-require, global-require
  initializeApp({ credential: cert(require(path.resolve(process.cwd(), keyPath))) });
  const db = getFirestore();

  const events = await db.collection('calendarEvents').get();
  let written = 0;
  let withdrawn = 0;

  for (const snap of events.docs) {
    const event = snap.data();
    const ref = db.collection('publicSchedule').doc(snap.id);

    // A deleted or class-scoped event has no public copy. Deleting is
    // unconditional rather than checked first: removing something that is not
    // there is not an error, and one round trip beats two.
    if (event.deleted === true || event.classId) {
      await ref.delete();
      withdrawn += 1;
      continue;
    }

    await ref.set(publicCopy(event));
    written += 1;
  }

  console.log('');
  console.log(`  calendar events read : ${events.size}`);
  console.log(`  public copies written: ${written}`);
  console.log(`  public copies removed: ${withdrawn}`);
  console.log('');
}

main().catch((error) => {
  console.error('\n  ✗', error?.message ?? error, '\n');
  process.exit(1);
});
