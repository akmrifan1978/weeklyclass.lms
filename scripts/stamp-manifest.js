#!/usr/bin/env node
/**
 * Puts the organisation's own logo and name into the built web manifest.
 *
 * Runs after the export and before the upload. A deploy therefore always
 * ships a manifest naming the current icons.
 *
 * Between deploys, scripts/sync-branding.js does the same job on a schedule,
 * so a logo changed in Settings reaches installed apps without anybody
 * rebuilding. Both use scripts/lib/branding-manifest.js, so they agree.
 *
 * Where a changed logo lands:
 *   - Inside the app and on the browser tab: straight away.
 *   - A NEW install, on any platform: the current logo.
 *   - An EXISTING install on Android or desktop: Chrome and Edge re-read the
 *     manifest and update the icon by themselves, usually within a day.
 *   - An EXISTING install on iOS: never updates. iOS copies the icon at "Add to
 *     Home Screen". Remove the app and add it again.
 *
 * Without a logo set, or without credentials, it leaves the bundled icons alone
 * and says so. A deploy must never fail because a logo could not be read.
 *
 *   node scripts/stamp-manifest.js
 */
const fs = require('fs');
const path = require('path');

const { applyBranding } = require('./lib/branding-manifest');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'dist', 'manifest.json');

async function settings() {
  const keyPath = path.join(ROOT, 'serviceAccount.json');
  if (!fs.existsSync(keyPath)) return null;

  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp({ credential: cert(require(keyPath)) });

  const snap = await getFirestore().collection('settings').doc('app').get();
  return snap.exists ? snap.data() : null;
}

async function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.log('  · stamp-manifest: no dist/manifest.json — run the export first');
    return;
  }

  let config;
  try {
    config = await settings();
  } catch (error) {
    console.warn('  ! stamp-manifest: could not read settings:', error.message);
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const branded = applyBranding(manifest, config);

  if (!branded) {
    console.log('  · stamp-manifest: nothing set in Settings, bundled icons kept');
    return;
  }

  fs.writeFileSync(MANIFEST, `${JSON.stringify(branded, null, 2)}\n`);
  console.log(
    `  ✓ stamp-manifest: ${branded.name || 'name unchanged'}, icons point at the uploaded logo` +
      (config?.logoShape ? ` (${config.logoShape})` : '')
  );
}

main().catch((error) => {
  // Never fails a deploy. A manifest with the old icons is a working app; a
  // deploy that stopped because a logo could not be fetched is not.
  console.warn('  ! stamp-manifest:', error && error.message ? error.message : error);
});
