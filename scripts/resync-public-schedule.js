#!/usr/bin/env node
/**
 * Rewrites the public copy of every event from the event itself.
 *
 * The public schedule is written as a side effect of saving an event, which
 * means a field added to that copy only reaches events somebody happens to
 * save afterwards. `registrationStatus` was added so the website could say
 * "Opening soon" instead of announcing that booking was open when it was not —
 * and until this runs, every event saved before that change still reads the old
 * way.
 *
 * Safe to run whenever, and safe to run twice: it writes the same document the
 * app would have written, derived from the same source. It creates nothing for
 * an event that should not be public and removes the copy of one that has since
 * been narrowed to a single class.
 *
 *   node scripts/resync-public-schedule.js          # say what would change
 *   node scripts/resync-public-schedule.js --write  # actually change it
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WRITE = process.argv.includes('--write');

/** Same shape the app writes — see calendarService.syncPublicSchedule. */
function publicCopy(event) {
  const date = event.date || '';
  const startTime = event.startTime || '';
  return {
    title: event.title || '',
    description: event.description ?? null,
    date,
    startTime,
    endTime: event.endTime || '',
    venue: event.venue ?? null,
    location: event.location ?? null,
    topic: event.topic ?? null,
    speaker: event.speaker ?? null,
    bannerUrl: event.bannerUrl ?? null,
    takesBookings: Boolean(event.registration),
    registrationStatus: event.registration?.status ?? null,
    startsAt: startsAt(date, startTime),
    deleted: false,
  };
}

/**
 * The instant an event begins, from the two strings people actually type.
 *
 * Kept deliberately dumb and local: the app's own combineDateTime is a TypeScript
 * module this plain script cannot import, and the only thing that matters is
 * that both produce the same instant for the same two strings.
 */
function startsAt(date, time) {
  if (!date) return null;
  const [year, month, day] = String(date).split('-').map(Number);
  if (!year || !month || !day) return null;
  const [hour, minute] = String(time || '00:00').split(':').map(Number);
  return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0);
}

async function main() {
  const keyPath = path.join(ROOT, 'serviceAccount.json');
  if (!fs.existsSync(keyPath)) {
    console.error('\n  ✗ serviceAccount.json not found next to package.json\n');
    process.exit(1);
  }

  const { initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  initializeApp({ credential: cert(require(keyPath)) });
  const db = getFirestore();

  const events = await db.collection('calendarEvents').where('deleted', '==', false).get();
  console.log(`\n  ${events.size} event(s) to consider${WRITE ? '' : '  (dry run)'}\n`);

  let written = 0;
  let removed = 0;

  for (const doc of events.docs) {
    const event = doc.data();
    const ref = db.collection('publicSchedule').doc(doc.id);

    // Scoped to one class is not public, and never was. If a copy exists from
    // before it was narrowed, this is where it goes.
    if (event.classId) {
      const existing = await ref.get();
      if (existing.exists) {
        console.log(`  - ${event.title}: class-scoped, withdrawing public copy`);
        if (WRITE) await ref.delete();
        removed += 1;
      }
      continue;
    }

    const copy = publicCopy(event);
    console.log(
      `  ✓ ${event.title}: bookings=${copy.takesBookings} status=${copy.registrationStatus ?? '—'}`
    );
    if (WRITE) await ref.set(copy);
    written += 1;
  }

  console.log(
    WRITE
      ? `\n  Done — ${written} published, ${removed} withdrawn.\n`
      : `\n  Would publish ${written} and withdraw ${removed}. Re-run with --write.\n`
  );
}

main().catch((error) => {
  console.error('\n  ✗', error && error.message ? error.message : error, '\n');
  process.exit(1);
});
