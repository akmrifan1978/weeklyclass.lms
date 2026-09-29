/**
 * Removes sign-ins that have no profile behind them, and nothing else.
 *
 * These are the wreckage of the registration bug: an account was created,
 * the next step was refused, and the half-made sign-in stayed behind holding
 * an email address hostage. Nobody can use one to sign in, because the app
 * has no profile to show them, and they appear nowhere in the admin
 * dashboard. An account with a profile is never touched here.
 */
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({ credential: cert(require('D:/Mobail.Apps/serviceAccount.json')) });
const db = getFirestore();

const authUsers = [];
let page = await getAuth().listUsers(1000);
authUsers.push(...page.users);
while (page.pageToken) {
  page = await getAuth().listUsers(1000, page.pageToken);
  authUsers.push(...page.users);
}

const profiles = await db.collection('users').get();
const known = new Set();
profiles.forEach((d) => {
  known.add(d.id);
  if (d.data().uid) known.add(d.data().uid);
});

const orphans = authUsers.filter((u) => !known.has(u.uid));
console.log(`${orphans.length} sign-ins with no profile\n`);

for (const u of orphans) {
  await getAuth().deleteUser(u.uid);
  console.log(`  removed  ${u.email}`);
}

const after = await getAuth().listUsers(1000);
console.log(`\nsign-ins now: ${after.users.length}   profiles: ${profiles.size}`);
process.exit(0);
