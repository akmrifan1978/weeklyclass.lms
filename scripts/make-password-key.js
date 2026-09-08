#!/usr/bin/env node
/**
 * Generates the key pair that lets an admin set somebody's password.
 *
 * WHY A KEY PAIR AT ALL. Only the Admin SDK can set another account's password,
 * so a password typed in the browser has to reach the machine running the
 * sender — and the only channel between them is Firestore. Writing it there in
 * plain text would put a working password in the database and, worse, into
 * every nightly backup on disk. Encrypting it means the database only ever
 * holds ciphertext that nothing but this machine can open.
 *
 * The PUBLIC half ships inside the app, which is what public means: it can only
 * lock, never unlock. The PRIVATE half stays in .env on the machine that runs
 * the sender, and is not in git.
 *
 * RSA-OAEP with SHA-256, 2048 bits: available in every browser's Web Crypto
 * and in Node with no dependency, and comfortably large enough for a password.
 *
 *   node scripts/make-password-key.js
 *
 * Run once. Running it again invalidates anything already in flight, which is
 * at most a password change nobody has applied yet.
 */

const crypto = require('crypto');

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'der' },
  privateKeyEncoding: { type: 'pkcs8', format: 'der' },
});

console.log('\n  Add these two lines to .env:\n');
console.log(`EXPO_PUBLIC_PASSWORD_PUBLIC_KEY=${publicKey.toString('base64')}`);
console.log(`PASSWORD_PRIVATE_KEY=${privateKey.toString('base64')}`);
console.log(
  '\n  The first is shipped in the app and is meant to be public.\n' +
    '  The second must never leave this machine or enter git.\n' +
    '\n  Then rebuild and redeploy so the app carries the public half.\n'
);
