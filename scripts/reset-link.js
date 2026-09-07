#!/usr/bin/env node
/**
 * Makes a password-reset link for one person, and sends nothing.
 *
 * This is the free answer to "OTP instead of email". No SMS, no WhatsApp API,
 * no monthly bill and no third party: Firebase generates a one-time link, this
 * prints it, and an admin sends it to the person however they already talk to
 * them — WhatsApp, in person, a note. They open it and choose a new password.
 *
 * It works for accounts with no email at all. An account whose sign-in address
 * is the mobile-derived `…@mobile.weeklyclass.app` has no inbox, so Firebase's
 * own "send me a reset" is useless to it — but the LINK is still valid, because
 * the link is what does the work and the email was only ever the envelope.
 *
 * Usage
 *   node scripts/reset-link.js --key ./serviceAccount.json --user 0534802476
 *   node scripts/reset-link.js --key ./serviceAccount.json --user rifan
 *   node scripts/reset-link.js --key ./serviceAccount.json --user a@b.com
 *
 * The service-account key is the keys to the building. Keep it off shared
 * drives, out of git, and out of screenshots.
 */

const path = require('path');
const crypto = require('crypto');

const AUTH_EMAIL_DOMAIN = 'mobile.weeklyclass.app';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    args[key] = next && !next.startsWith('--') ? next : true;
  }
  return args;
}

/** Same normalisation the app uses, so a number typed either way still matches. */
function normaliseMobile(value) {
  return String(value).replace(/[^0-9]/g, '').replace(/^0+/, '');
}

function isEmail(value) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value));
}

async function main() {
  const args = parseArgs(process.argv);

  if (!args.user) {
    console.error(
      '\n  ✗ Pass --user <mobile | username | email>' +
        '\n    e.g. node scripts/reset-link.js --key ./serviceAccount.json --user 0534802476\n'
    );
    process.exit(1);
  }

  let initializeApp;
  let cert;
  let getFirestore;
  let getAuth;
  try {
    ({ initializeApp, cert } = require('firebase-admin/app'));
    ({ getFirestore } = require('firebase-admin/firestore'));
    ({ getAuth } = require('firebase-admin/auth'));
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
  const auth = getAuth();
  const input = String(args.user).trim();

  /**
   * Find the address the account actually signs in with.
   *
   * Not the address on their profile — a household shares one inbox, so the
   * profile email is often somebody else's sign-in. The indexes hold the real
   * one, which is exactly why they exist.
   */
  let authEmail = null;
  let via = '';

  if (isEmail(input)) {
    authEmail = input.toLowerCase();
    via = 'the address given';
  }

  if (!authEmail) {
    const key = normaliseMobile(input);
    if (key) {
      const snap = await db.collection('mobiles').doc(key).get();
      if (snap.exists) {
        authEmail = snap.data().authEmail || null;
        via = `mobiles/${key}`;
      }
    }
  }

  if (!authEmail) {
    const username = input.toLowerCase();
    const snap = await db.collection('usernames').doc(username).get();
    if (snap.exists) {
      const data = snap.data();
      authEmail = data.authEmail || data.email || null;
      via = `usernames/${username}`;
    }
  }

  if (!authEmail) {
    console.error(`\n  ✗ No account found for "${input}".`);
    console.error('    Try their mobile number, their username, or their email address.\n');
    process.exit(1);
  }

  // Confirm the auth account really exists before generating a link for it. A
  // stale index row would otherwise produce a link that fails when opened, and
  // the person would be told to try again on something that can never work.
  let user;
  try {
    user = await auth.getUserByEmail(authEmail);
  } catch {
    console.error(`\n  ✗ ${authEmail} is indexed at ${via} but has no sign-in account.`);
    console.error('    The index is stale — the account was probably removed by hand.\n');
    process.exit(1);
  }

  const link = await auth.generatePasswordResetLink(authEmail);

  const synthetic = authEmail.endsWith(`@${AUTH_EMAIL_DOMAIN}`);
  console.log('');
  console.log(`  Account   ${user.displayName || user.uid}`);
  console.log(`  Sign-in   ${authEmail}${synthetic ? '  (no real inbox)' : ''}`);
  console.log(`  Found via ${via}`);
  console.log('');
  console.log('  Send this link to them. It sets a new password and expires.');
  console.log('');
  console.log(`  ${link}`);
  console.log('');
  if (synthetic) {
    console.log('  This account has no inbox, so the link is the ONLY way in.');
    console.log('  Nothing was emailed — send it yourself.');
    console.log('');
  }

  // Not logged to the audit trail on purpose: this runs outside the app, as a
  // person rather than as an account, and writing a half-attributed entry would
  // make the trail less trustworthy rather than more.
  void crypto;
}

main().catch((error) => {
  console.error('\n  ✗', error && error.message ? error.message : error, '\n');
  process.exit(1);
});
