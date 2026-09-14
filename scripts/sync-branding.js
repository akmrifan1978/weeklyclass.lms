#!/usr/bin/env node
/**
 * Keeps the installed app's icon in step with the logo, without a rebuild.
 *
 * WHY THIS EXISTS. Everything inside the app reads the logo live, and so does
 * the browser tab. The icon on a home screen or a desktop shortcut does not: the
 * operating system takes it from the web manifest, which is a file on the
 * hosting, and a file only changes when something publishes a new one. Before
 * this, changing the logo meant waiting for somebody to rebuild and deploy.
 *
 * WHAT IT DOES. Runs every few minutes from the scheduled GitHub workflow. When
 * the logo, its shape or the app name has changed since the last time, it takes
 * a copy of the LIVE site, replaces only manifest.json, and releases that copy.
 * No build, no new secrets — the same service account the notification job
 * already uses.
 *
 * WHAT HAPPENS NEXT, and what does not:
 *   - Android and desktop installs: Chrome and Edge re-read the manifest and
 *     update the icon on their own, typically within a day.
 *   - New installs anywhere: get the new icon straight away.
 *   - iPhone installs already on a home screen: never change. iOS copies the
 *     icon once, when it is added. Remove it and add it again.
 *
 * IT NEVER FAILS THE JOB. A stale icon is not worth a red run, and it must
 * never stand in the way of notifications going out.
 *
 *   node scripts/sync-branding.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

const { applyBranding, brandingSignature } = require('./lib/branding-manifest');

const ROOT = path.resolve(__dirname, '..');
const KEY = path.join(ROOT, 'serviceAccount.json');
const API = 'https://firebasehosting.googleapis.com/v1beta1';

const log = (message) => console.log(`  ${message}`);

async function main() {
  if (!fs.existsSync(KEY)) {
    log('· branding sync: no service account available, skipped');
    return;
  }

  const serviceAccount = JSON.parse(fs.readFileSync(KEY, 'utf8'));
  const site = process.env.FIREBASE_HOSTING_SITE || serviceAccount.project_id;

  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getFirestore, FieldValue } = require('firebase-admin/firestore');
  if (getApps().length === 0) initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  const settings = (await db.collection('settings').doc('app').get()).data() || {};
  const signature = brandingSignature(settings);
  const stateRef = db.collection('settings').doc('brandingSync');
  const state = (await stateRef.get()).data() || {};

  if (state.signature === signature) {
    log('· branding sync: installed-app icon already matches the logo');
    return;
  }

  // The manifest as the site serves it now, so the build's own fields survive.
  const liveUrl = `https://${site}.web.app/manifest.json`;
  const response = await fetch(liveUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`could not read ${liveUrl}: HTTP ${response.status}`);
  const live = await response.json();

  const wanted = applyBranding(live, settings);
  if (!wanted || JSON.stringify(wanted) === JSON.stringify(live)) {
    // Already right — a normal deploy stamped it. Remember, and do nothing.
    await stateRef.set({ signature, checkedAt: FieldValue.serverTimestamp(), released: false });
    log('· branding sync: live manifest already correct, nothing to release');
    return;
  }

  const { GoogleAuth } = require('google-auth-library');
  const auth = new GoogleAuth({
    credentials: serviceAccount,
    scopes: ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase'],
  });
  const client = await auth.getClient();
  const call = (url, options = {}) => client.request({ url, ...options }).then((r) => r.data);

  // 1. What is live now.
  const releases = await call(`${API}/sites/${site}/releases?pageSize=1`);
  const sourceVersion = releases.releases?.[0]?.version?.name;
  if (!sourceVersion) throw new Error('no live release found to copy');
  const source = await call(`${API}/${sourceVersion}`);

  // 2. A copy of it, without the manifest.
  let operation = await call(`${API}/sites/${site}/versions:clone`, {
    method: 'POST',
    data: { sourceVersion, finalize: false, exclude: { regexes: ['^/manifest\\.json$'] } },
  });
  for (let i = 0; i < 60 && !operation.done; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    operation = await call(`${API}/${operation.name}`);
  }
  if (!operation.done) throw new Error('copying the live site did not finish in time');
  if (operation.error) throw new Error(`copying the live site failed: ${operation.error.message}`);
  const version = operation.response?.name;
  if (!version) throw new Error('the copy did not report its version');

  // The copy must behave exactly like the original: same headers, same
  // rewrites. Carried across explicitly in case the clone left them behind.
  const cloned = await call(`${API}/${version}`);
  if (source.config && JSON.stringify(cloned.config || {}) !== JSON.stringify(source.config)) {
    await call(`${API}/${version}?updateMask=config`, { method: 'PATCH', data: { config: source.config } });
  }

  // 3. The new manifest into the copy.
  const body = zlib.gzipSync(Buffer.from(`${JSON.stringify(wanted, null, 2)}\n`, 'utf8'));
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  const populated = await call(`${API}/${version}:populateFiles`, {
    method: 'POST',
    data: { files: { '/manifest.json': hash } },
  });
  if ((populated.uploadRequiredHashes || []).includes(hash)) {
    await client.request({
      url: `${populated.uploadUrl}/${hash}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      data: body,
    });
  }

  // 4. Seal it and put it live.
  await call(`${API}/${version}?updateMask=status`, { method: 'PATCH', data: { status: 'FINALIZED' } });
  await call(`${API}/sites/${site}/releases?versionName=${encodeURIComponent(version)}`, {
    method: 'POST',
    data: { message: 'Branding sync: installed-app icon follows the current logo' },
  });

  await stateRef.set({
    signature,
    version,
    released: true,
    releasedAt: FieldValue.serverTimestamp(),
  });
  log(`✓ branding sync: released ${version.split('/').pop()} with icons from the current logo`);
}

main()
  .catch((error) => {
    console.warn('  ! branding sync:', error && error.message ? error.message : error);
  })
  .finally(() => process.exit(0));
