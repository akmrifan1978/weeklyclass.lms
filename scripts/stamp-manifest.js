#!/usr/bin/env node
/**
 * Puts the organisation's own logo and name into the built web manifest.
 *
 * WHY THIS IS NOT DONE AT RUNTIME. Every logo inside the app is read live from
 * settings, so changing it updates every screen at once. The installed app's
 * icon is different: the operating system copies it when somebody adds the app
 * to their home screen, and it reads the manifest to do that. A page cannot
 * reach back and change an icon the OS has already taken.
 *
 * What a page CAN do is nothing, and what a deploy can do is ship a manifest
 * that names the right icon in the first place. So this runs after the export
 * and before the upload, reads settings/app the same way the app does, and
 * rewrites the icons and the name to match.
 *
 * WHAT THIS MEANS IN PRACTICE, and it is worth being plain about:
 *   - Browser tab: already live, no deploy needed (see useDocumentBranding).
 *   - A NEW install, on any platform: gets the current logo.
 *   - An EXISTING install on Android: Chrome re-reads the manifest on later
 *     visits and updates the icon by itself, usually within a day or so.
 *   - An EXISTING install on iOS: never updates. iOS takes a copy at
 *     "Add to Home Screen" and there is no mechanism to change it. Remove the
 *     app and add it again.
 *
 * Without a logo set, or without credentials, it leaves the bundled icons alone
 * and says so. A deploy must never fail because a logo could not be read.
 *
 *   node scripts/stamp-manifest.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = path.join(ROOT, 'dist', 'manifest.json');

/**
 * The same image at a given size, asked of Cloudinary.
 *
 * Their delivery URLs carry the transformation in the path, so a width is
 * changed by rewriting that segment rather than by uploading anything. An icon
 * is square and the source usually is not, so it is padded rather than cropped
 * — a logo with its edges cut off is worse than one with space around it.
 *
 * Anything that is not a Cloudinary URL is returned untouched: it will still
 * work as an icon, just at whatever size it happens to be.
 */
function sized(url, size, maskable) {
  if (!/res\.cloudinary\.com\/.+\/image\/upload\//.test(url)) return url;

  // Two steps, chained, because the icon has to BE the size the manifest says
  // it is. Shrinking the logo and calling the result 192x192 would be a lie
  // Chrome checks: fit the artwork first, then pad the canvas out to the full
  // square.
  //
  // A maskable icon is cropped to a circle by the launcher, so its artwork is
  // fitted to 80% and the remaining fifth is margin it can afford to lose.
  const inner = maskable ? Math.round(size * 0.8) : size;
  const transform = [
    `c_fit,w_${inner},h_${inner}`,
    `c_pad,w_${size},h_${size},b_white`,
    'f_png,q_auto',
  ].join('/');

  return url.replace(/\/image\/upload\/[^/]*\//, `/image/upload/${transform}/`);
}

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

  const logo = (config?.faviconUrl || config?.logoUrl || '').trim();
  const name = (config?.appName || '').trim();

  if (!logo && !name) {
    console.log('  · stamp-manifest: nothing set in Settings, bundled icons kept');
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));

  if (name) {
    manifest.name = name;
    // The short name sits under the icon on a home screen, where there is room
    // for about twelve characters before the launcher truncates it.
    manifest.short_name = name.length <= 12 ? name : name.slice(0, 12).trim();
  }

  if (logo) {
    manifest.icons = [
      { src: sized(logo, 192, false), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: sized(logo, 512, false), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: sized(logo, 192, true), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: sized(logo, 512, true), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ];
  }

  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `  ✓ stamp-manifest: ${name || 'name unchanged'}` +
      (logo ? `, icons point at the uploaded logo` : ', icons unchanged')
  );
}

main().catch((error) => {
  // Never fails a deploy. A manifest with the old icons is a working app; a
  // deploy that stopped because a logo could not be fetched is not.
  console.warn('  ! stamp-manifest:', error && error.message ? error.message : error);
});
