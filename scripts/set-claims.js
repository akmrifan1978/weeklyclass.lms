#!/usr/bin/env node
/**
 * Mirrors each user's Firestore role into a Firebase Auth custom claim.
 *
 * WHY THIS EXISTS
 * Cloud Storage security rules cannot read Firestore, so they cannot check
 * `users/{uid}.role`. Custom claims are the only way to give Storage rules a
 * trustworthy notion of who is staff. Running this script lets you tighten
 * firebase/storage.rules from `isSignedIn()` to `isStaff()` — see the comment
 * block at the top of that file.
 *
 * It is also how you create the FIRST ADMIN, because firestore.rules refuses to
 * let anyone self-register with `role: 'admin'`. (You can equally promote the
 * first admin by hand in the Firebase Console — see docs/FIREBASE.md. This
 * script is the repeatable version.)
 *
 * REQUIREMENTS
 *   npm install --no-save firebase-admin
 *   A service account key JSON from:
 *     Firebase Console > Project settings > Service accounts > Generate new key
 *
 * NEVER commit that key. `.gitignore` already excludes *serviceAccount*.json.
 *
 * USAGE
 *   # Promote one user to admin (sets both the Firestore role and the claim)
 *   node scripts/set-claims.js --key ./serviceAccount.json --email you@example.com --role admin
 *
 *   # Re-sync claims for every user from their Firestore role
 *   node scripts/set-claims.js --key ./serviceAccount.json --sync-all
 *
 * A user must sign out and back in (or wait up to an hour) before a changed
 * claim reaches their ID token.
 */

const path = require('node:path');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function fail(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv);

  if (args.help || (!args.email && !args['sync-all'])) {
    console.log(
      [
        '',
        'Usage:',
        '  node scripts/set-claims.js --key <serviceAccount.json> --email <email> --role <admin|teacher|student>',
        '  node scripts/set-claims.js --key <serviceAccount.json> --sync-all',
        '',
      ].join('\n')
    );
    process.exit(0);
  }

  let admin;
  try {
    admin = require('firebase-admin');
  } catch {
    fail('firebase-admin is not installed. Run:  npm install --no-save firebase-admin');
  }

  const keyPath = args.key || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    fail('Pass --key <serviceAccount.json> or set GOOGLE_APPLICATION_CREDENTIALS.');
  }

  let credential;
  try {
    // eslint-disable-next-line import/no-dynamic-require, global-require
    credential = require(path.resolve(process.cwd(), keyPath));
  } catch {
    fail(`Could not read the service account key at: ${keyPath}`);
  }

  admin.initializeApp({ credential: admin.credential.cert(credential) });
  const auth = admin.auth();
  const db = admin.firestore();

  if (args['sync-all']) {
    const snapshot = await db.collection('users').get();
    let updated = 0;
    let skipped = 0;

    for (const doc of snapshot.docs) {
      const data = doc.data();
      if (!data.role) {
        skipped += 1;
        continue;
      }
      try {
        await auth.setCustomUserClaims(doc.id, { role: data.role });
        updated += 1;
        console.log(`  ✓ ${data.email ?? doc.id} → ${data.role}`);
      } catch (error) {
        skipped += 1;
        console.warn(`  ! ${doc.id}: ${error.message}`);
      }
    }

    console.log(`\n  Synced ${updated} claim(s); skipped ${skipped}.\n`);
    console.log('  Users must sign out and back in for the new claim to take effect.\n');
    return;
  }

  const role = args.role || 'admin';
  if (!['admin', 'teacher', 'student'].includes(role)) {
    fail(`Unknown role "${role}". Use admin, teacher or student.`);
  }

  let user;
  try {
    user = await auth.getUserByEmail(args.email);
  } catch {
    fail(`No Firebase Auth account found for ${args.email}. Register in the app first.`);
  }

  await auth.setCustomUserClaims(user.uid, { role });

  // Keep Firestore authoritative for the in-app permission checks, and stamp
  // the audit trail so the promotion is not invisible.
  await db.collection('users').doc(user.uid).set(
    {
      role,
      status: 'active',
      deleted: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await db.collection('auditLogs').add({
    actorId: 'system',
    actorName: 'set-claims.js',
    actorRole: 'system',
    action: 'PERMISSION_CHANGED',
    collection: 'users',
    documentId: user.uid,
    summary: `Role set to ${role} for ${args.email} via set-claims.js`,
    changes: { role: { from: null, to: role } },
    deleted: false,
    at: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`\n  ✓ ${args.email} is now ${role} (uid ${user.uid}).`);
  console.log('  Sign out and back in for the claim to reach the ID token.\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
