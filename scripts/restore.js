#!/usr/bin/env node
/**
 * Writes a backup back into a Firestore project.
 *
 * WHY IT EXISTS. Until now there was a backup and no way to use it, which is a
 * comforting file rather than a safety net. It also happens to be the tool a
 * region migration needs: a backup taken from one project is exactly what the
 * next one has to be filled from.
 *
 * IT REFUSES BY DEFAULT. Restoring writes over live data, and the commonest way
 * that goes wrong is somebody running it against the project they meant to copy
 * FROM. So it prints what it would do and stops, and only writes when told
 * --confirm, and only into the project whose key you hand it.
 *
 *   node scripts/restore.js --from backups/2026-09-09T083000
 *   node scripts/restore.js --from backups/... --key ./target-key.json --confirm
 *
 * Documents are written by id, so restoring twice lands in the same place
 * rather than duplicating. Collections not present in the backup are untouched.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
/** Firestore's own ceiling on a batched write. */
const BATCH_LIMIT = 500;

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

function findFile(name) {
  for (const dir of [process.cwd(), ROOT]) {
    const candidate = path.resolve(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Undoes the tagging `backup.js` applies.
 *
 * The two must stay in step: anything encoded there has to be decoded here, or
 * a timestamp comes back as an object that looks like one and sorts like a
 * string.
 */
function decode(value, Firestore) {
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) return value.map((v) => decode(v, Firestore));

  switch (value.__type) {
    case 'timestamp':
      return new Date(value.value);
    case 'geopoint':
      return new Firestore.GeoPoint(value.lat, value.lng);
    case 'bytes':
      return Buffer.from(value.value, 'base64');
    case 'ref':
      // Restored as the path string. Turning it back into a live reference
      // would bind it to the OLD project, which during a migration is exactly
      // the thing being moved away from.
      return value.value;
    default:
      break;
  }

  const out = {};
  for (const [key, inner] of Object.entries(value)) out[key] = decode(inner, Firestore);
  return out;
}

async function main() {
  const args = parseArgs(process.argv);

  const from = args.from ? path.resolve(args.from) : null;
  if (!from || !fs.existsSync(from)) {
    console.error('\n  ✗ Pass --from <backup folder>, e.g. --from backups/2026-09-09T083000\n');
    process.exit(1);
  }

  const keyPath = findFile(args.key || 'serviceAccount.json');
  if (!keyPath) {
    console.error('\n  ✗ No service-account key found. Pass --key <file.json>\n');
    process.exit(1);
  }

  const { initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore, Firestore } = require('firebase-admin/firestore');
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const credentials = require(keyPath);
  initializeApp({ credential: cert(credentials) });
  const db = getFirestore();

  const files = fs
    .readdirSync(from)
    .filter((name) => name.endsWith('.json') && name !== '_manifest.json');

  console.log(`\n  From   : ${from}`);
  console.log(`  Into   : project ${credentials.project_id}`);
  console.log('');

  let grandTotal = 0;
  const plan = [];
  for (const file of files) {
    const docs = JSON.parse(fs.readFileSync(path.join(from, file), 'utf8'));
    const count = Object.keys(docs).length;
    plan.push({ collection: file.replace(/\.json$/, ''), docs, count });
    grandTotal += count;
    console.log(`   ${file.replace(/\.json$/, '').padEnd(24)} ${String(count).padStart(5)} docs`);
  }
  console.log(`\n  ${grandTotal} documents in ${plan.length} collections`);

  if (!args.confirm) {
    console.log(
      '\n  Nothing written. This was a dry run.\n' +
        '  Add --confirm to write these into ' +
        credentials.project_id +
        '.\n'
    );
    process.exit(0);
  }

  console.log('\n  Writing...\n');
  for (const { collection, docs } of plan) {
    const entries = Object.entries(docs);
    let written = 0;

    for (let i = 0; i < entries.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const [id, data] of entries.slice(i, i + BATCH_LIMIT)) {
        batch.set(db.collection(collection).doc(id), decode(data, Firestore));
      }
      await batch.commit();
      written += Math.min(BATCH_LIMIT, entries.length - i);
    }

    console.log(`   ${collection.padEnd(24)} ${String(written).padStart(5)} written`);
  }

  console.log(`\n  Done — ${grandTotal} documents restored into ${credentials.project_id}.\n`);
}

main().catch((error) => {
  console.error('\n  ✗', error && error.message ? error.message : error, '\n');
  process.exit(1);
});
