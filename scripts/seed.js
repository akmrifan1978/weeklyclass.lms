#!/usr/bin/env node
/**
 * Seeds the minimum data a fresh project needs to be usable:
 *   settings/app        so the splash screen has a name and registration state
 *   languages/*         the four bundled languages
 *   countries/*         the full ISO 3166-1 list (admins can edit or remove any)
 *   organizations/*     one default organisation
 *
 * It creates NO users. The first admin comes from scripts/set-claims.js or the
 * Firebase Console — see docs/FIREBASE.md.
 *
 * The script is idempotent: re-running it merges rather than duplicates, so it
 * is safe to run against a project that already has data.
 *
 * REQUIREMENTS
 *   npm install --no-save firebase-admin
 *   A service account key (Console > Project settings > Service accounts)
 *
 * USAGE
 *   node scripts/seed.js --key ./serviceAccount.json
 *   node scripts/seed.js --key ./serviceAccount.json --countries-only
 */

const path = require('node:path');

const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', rtl: false, order: 0 },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்', rtl: false, order: 1 },
  { code: 'si', name: 'Sinhala', nativeName: 'සිංහල', rtl: false, order: 2 },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', rtl: true, order: 3 },
];

// The full ISO 3166-1 list, kept in its own module and shared with the Cloud
// Shell setup script. Seeded rather than hard-coded so an admin can rename,
// disable or remove any row without a release.
const { COUNTRIES } = require('./countries');

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

async function main() {
  const args = parseArgs(process.argv);

  // firebase-admin v13+ dropped the legacy `admin.credential` /
  // `admin.firestore()` namespace, so this script uses the modular entrypoints.
  let initializeApp, cert, getFirestore, FieldValue;
  try {
    ({ initializeApp, cert } = require('firebase-admin/app'));
    ({ getFirestore, FieldValue } = require('firebase-admin/firestore'));
  } catch {
    console.error(
      '\n  Missing dependency: firebase-admin.' +
        '\n  Run:  npm install --no-save firebase-admin\n'
    );
    process.exit(1);
  }

  const keyPath = args.key || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    console.error('\n  ✗ Pass --key <serviceAccount.json> or set GOOGLE_APPLICATION_CREDENTIALS.\n');
    process.exit(1);
  }

  // eslint-disable-next-line import/no-dynamic-require, global-require
  const serviceAccount = require(path.resolve(process.cwd(), keyPath));
  initializeApp({ credential: cert(serviceAccount) });

  const db = getFirestore();
  const now = FieldValue.serverTimestamp();
  const base = { deleted: false, createdAt: now, updatedAt: now };

  let batch = db.batch();
  let writes = 0;

  const queue = (ref, data) => {
    batch.set(ref, data, { merge: true });
    writes += 1;
  };

  for (const country of COUNTRIES) {
    // The ISO code is the document id, so re-running merges rather than
    // duplicating — the earlier auto-id version could create a second row for
    // the same country on every run.
    queue(db.collection('countries').doc(country.code), {
      ...base,
      ...country,
      status: 'active',
    });
  }

  if (!args['countries-only']) {
    for (const language of LANGUAGES) {
      queue(db.collection('languages').doc(language.code), {
        ...base,
        ...language,
        enabled: true,
      });
    }

    queue(db.collection('organizations').doc('default'), {
      ...base,
      name: 'WeeklyClass',
      description: 'Default organisation — rename this from the Branches screen.',
      status: 'active',
    });

    queue(db.collection('settings').doc('app'), {
      appName: 'WeeklyClass LMS',
      tagline: 'Empowering Islamic education through technology',
      logoUrl: null,
      faviconUrl: null,
      bannerUrl: null,
      primaryColor: '#041E4A',
      secondaryColor: '#ED5B03',
      supportEmail: '',
      contactPhone: '',
      social: {},
      defaultLanguage: 'en',
      availableLanguages: LANGUAGES.map((l) => l.code),
      // Approval is ON by default so a public project cannot be flooded with
      // self-activated accounts the moment it goes live.
      registrationEnabled: true,
      requireApproval: true,
      updatedAt: now,
    });
  }

  await batch.commit();

  console.log(`\n  ✓ Seeded ${writes} document(s).`);
  console.log('  Next: create your first admin with');
  console.log('    node scripts/set-claims.js --key <key.json> --email <you> --role admin\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
