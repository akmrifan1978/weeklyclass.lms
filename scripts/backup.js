#!/usr/bin/env node
/**
 * Takes a full copy of the database to disk.
 *
 * WHY THIS EXISTS. There was no backup of any kind. Firestore is durable — it
 * will not lose a document on its own — but that is not what backups are for.
 * They are for the delete that should not have happened, the script run against
 * the wrong project, the admin who cleared the wrong list. Against any of those
 * a replicated database replicates the mistake perfectly.
 *
 * Google's own scheduled exports need the Blaze plan and a Cloud Storage
 * bucket. This needs neither: it reads through the admin SDK and writes JSON
 * next to the project, so it costs one read per document and nothing else.
 *
 * WHAT IT IS NOT. It is a copy of the data, not of the rules, the indexes, or
 * the Auth accounts — those live in git and in the Firebase console. Restoring
 * means putting documents back with restore.js, into a project whose rules and
 * indexes are already deployed.
 *
 *   node scripts/backup.js                    (into ./backups)
 *   node scripts/backup.js --out D:\Backups   (somewhere else - see below)
 *   node scripts/backup.js --keep 30          (how many to keep, default 14)
 *
 * A word on --out: a backup on the same disk as the thing it backs up survives
 * a mistake but not a dead disk. Point it at a second drive, or at a synced
 * folder, and it survives both.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_KEEP = 14;

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

/** The first of these that exists, or null. */
function findFile(name) {
  for (const dir of [process.cwd(), ROOT]) {
    const candidate = path.resolve(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Firestore values that JSON cannot hold on its own.
 *
 * Timestamps, references and GeoPoints all stringify to something useless or
 * lossy by default — a Timestamp becomes `{"_seconds":...}` in one SDK version
 * and something else in the next. Tagged explicitly so a restore can put back
 * exactly what was taken, and so a human reading the file can see what a value
 * was meant to be.
 */
function encode(value) {
  if (value === null || value === undefined) return null;

  if (typeof value.toDate === 'function') {
    return { __type: 'timestamp', value: value.toDate().toISOString() };
  }
  if (value.constructor && value.constructor.name === 'DocumentReference') {
    return { __type: 'ref', value: value.path };
  }
  if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
    return { __type: 'geopoint', lat: value.latitude, lng: value.longitude };
  }
  if (Buffer.isBuffer(value)) {
    return { __type: 'bytes', value: value.toString('base64') };
  }
  if (Array.isArray(value)) return value.map(encode);
  if (typeof value === 'object') {
    const out = {};
    for (const [key, inner] of Object.entries(value)) out[key] = encode(inner);
    return out;
  }
  return value;
}

/** Removes all but the newest `keep` backups. */
function prune(outDir, keep) {
  if (!fs.existsSync(outDir)) return 0;
  const runs = fs
    .readdirSync(outDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T\d{6}$/.test(name))
    .sort();
  const doomed = runs.slice(0, Math.max(0, runs.length - keep));
  for (const name of doomed) {
    fs.rmSync(path.join(outDir, name), { recursive: true, force: true });
  }
  return doomed.length;
}

async function main() {
  const args = parseArgs(process.argv);
  const keep = Number(args.keep) > 0 ? Number(args.keep) : DEFAULT_KEEP;

  const keyPath = findFile(
    args.key || process.env.GOOGLE_APPLICATION_CREDENTIALS || 'serviceAccount.json'
  );
  if (!keyPath) {
    console.error(
      '\n  ✗ No service-account key found.\n' +
        `\n    Looked in:\n      ${process.cwd()}\n      ${ROOT}\n` +
        '\n    Firebase console -> Project settings -> Service accounts\n' +
        `    -> Generate new private key, saved as ${path.join(ROOT, 'serviceAccount.json')}\n`
    );
    process.exit(1);
  }

  const { initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  // eslint-disable-next-line import/no-dynamic-require, global-require
  initializeApp({ credential: cert(require(keyPath)) });
  const db = getFirestore();

  const outRoot = path.resolve(args.out || path.join(ROOT, 'backups'));
  // 2026-09-08T130512 - sortable and filename-safe, so pruning is a string sort
  // and nothing more. Must keep matching the pattern `prune` looks for.
  const stamp = new Date().toISOString().replace(/:/g, '').slice(0, 17);
  const runDir = path.join(outRoot, stamp);
  fs.mkdirSync(runDir, { recursive: true });

  console.log(`\n  Backing up to ${runDir}\n`);

  const collections = await db.listCollections();
  let totalDocs = 0;
  let totalBytes = 0;
  const manifest = { startedAt: new Date().toISOString(), collections: {} };

  for (const collection of collections) {
    const snap = await collection.get();
    const docs = {};
    for (const doc of snap.docs) docs[doc.id] = encode(doc.data());

    const json = JSON.stringify(docs, null, 1);
    fs.writeFileSync(path.join(runDir, `${collection.id}.json`), json, 'utf8');

    manifest.collections[collection.id] = snap.size;
    totalDocs += snap.size;
    totalBytes += Buffer.byteLength(json);
    console.log(`   ${collection.id.padEnd(24)} ${String(snap.size).padStart(5)} docs`);
  }

  manifest.finishedAt = new Date().toISOString();
  manifest.documents = totalDocs;
  fs.writeFileSync(
    path.join(runDir, '_manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8'
  );

  const pruned = prune(outRoot, keep);

  console.log(
    `\n  ${totalDocs} documents in ${collections.length} collections, ` +
      `${(totalBytes / 1024 / 1024).toFixed(1)} MB` +
      (pruned ? `, ${pruned} old backup(s) removed` : '')
  );
  console.log(`  Keeping the newest ${keep}.\n`);
}

main().catch((error) => {
  console.error('\n  ✗', error && error.message ? error.message : error, '\n');
  process.exit(1);
});
