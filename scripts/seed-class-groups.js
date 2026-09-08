#!/usr/bin/env node
/**
 * Creates the six class groups, if they are not already there.
 *
 *   Children  - Male / Female
 *   Teenagers - Male / Female
 *   Adults    - Male / Female
 *
 * IDEMPOTENT, and matched on the age band and gender rather than the name, so
 * running it twice does not produce twelve groups and renaming one in the admin
 * screen does not make this script create a duplicate of it.
 *
 * IT TOUCHES NOTHING THAT EXISTS. Classes already in the database are left
 * exactly as they are, students included — moving somebody between groups is a
 * decision for whoever knows them, not for a seed script. Older ungrouped
 * classes can be switched to inactive in Admin -> Classes once their students
 * have been moved across.
 *
 * Teachers are deliberately left empty. Who teaches which group is the one
 * thing here that cannot be guessed, and a wrong guess would hand a teacher
 * somebody else's students.
 *
 *   node scripts/seed-class-groups.js --key ./serviceAccount.json
 *   node scripts/seed-class-groups.js --key ./serviceAccount.json --dry-run
 */

const path = require('path');

const BANDS = [
  { ageBand: 'children', label: 'Children', code: 'CH' },
  { ageBand: 'teenagers', label: 'Teenagers', code: 'TN' },
  { ageBand: 'adults', label: 'Adults', code: 'AD' },
];

const GENDERS = [
  { gender: 'male', label: 'Male', code: 'M' },
  { gender: 'female', label: 'Female', code: 'F' },
];

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

  const existing = await db.collection('classes').get();

  // A branch is required on a class. Any existing class knows one; failing
  // that, the first branch there is. Without one the groups would be created
  // unreachable, which is worse than not creating them.
  const branches = await db.collection('branches').limit(1).get();
  const branchId =
    existing.docs.map((d) => d.data().branchId).find(Boolean) ||
    (branches.empty ? null : branches.docs[0].id);

  if (!branchId) {
    console.error('\n  ✗ No branch exists yet. Create one in Admin → Branches first.\n');
    process.exit(1);
  }

  const have = new Set(
    existing.docs
      .map((d) => d.data())
      .filter((c) => c.ageBand && c.gender)
      .map((c) => `${c.ageBand}/${c.gender}`)
  );

  let created = 0;
  let skipped = 0;

  for (const band of BANDS) {
    for (const g of GENDERS) {
      const key = `${band.ageBand}/${g.gender}`;
      if (have.has(key)) {
        console.log(`  = ${band.label} – ${g.label}  (already there)`);
        skipped += 1;
        continue;
      }

      const record = {
        name: `${band.label} – ${g.label}`,
        // A short, sayable id: "join JDC-CHM" works over the phone in a way a
        // generated string never does.
        code: `JDC-${band.code}${g.code}`,
        description: '',
        ageBand: band.ageBand,
        gender: g.gender,
        branchId,
        teacherId: null,
        teacherIds: [],
        teacherNames: [],
        schedule: '',
        language: 'en',
        status: 'active',
        deleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: 'seed-class-groups',
      };

      if (args['dry-run']) {
        console.log(`  + ${record.name}  ${record.code}   (dry run)`);
      } else {
        await db.collection('classes').add(record);
        console.log(`  + ${record.name}  ${record.code}`);
      }
      created += 1;
    }
  }

  console.log('');
  console.log(`  created ${created}, already present ${skipped}`);
  console.log(`  existing classes left untouched: ${existing.size}`);
  console.log('\n  Next: assign teachers to each group in Admin → Classes.\n');
}

main().catch((error) => {
  console.error('\n  ✗', error && error.message ? error.message : error, '\n');
  process.exit(1);
});
