#!/usr/bin/env node
/**
 * Stamps the build's identity into dist/sw.js, after `expo export`.
 *
 * WHY THIS EXISTS, because it is not obvious and removing it breaks updates
 * silently — the worst kind of break, since everything still looks deployed:
 *
 * A browser installs a new service worker only when the bytes of sw.js differ
 * from the copy it already holds. The file is static, so every deploy shipped
 * an identical one. `registration.update()` fetched it, found nothing new, and
 * stopped. No new worker installed, so `controllerchange` never fired, so the
 * reload that picks up the new bundle never happened. An installed app — which
 * nobody presses reload on, and which Android resumes rather than reopens —
 * could therefore run the same JavaScript for days while the site had moved on.
 *
 * The stamp is the entry bundle's content hash rather than a timestamp. That
 * way the worker changes when the app changes, and a redeploy of identical code
 * does not reload every phone for nothing.
 *
 * It FAILS LOUDLY. A stamping step that quietly does nothing would leave
 * exactly the bug it was written to fix, with a passing build to hide it.
 *
 *   node scripts/stamp-sw.js          (run for you by npm run build:web)
 */

const fs = require('fs');
const path = require('path');

const dist = path.resolve(process.cwd(), 'dist');
const indexPath = path.join(dist, 'index.html');
const swPath = path.join(dist, 'sw.js');

/** The line in public/sw.js this rewrites. Kept in step with that file. */
const STAMP = /const BUILD = '[^']*';/;

function fail(message) {
  console.error(`\n  ✗ stamp-sw: ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(indexPath)) {
  fail('dist/index.html is missing. Run `expo export --platform web` first.');
}
if (!fs.existsSync(swPath)) {
  fail('dist/sw.js is missing. It should have been copied from public/.');
}

const html = fs.readFileSync(indexPath, 'utf8');
// The one file whose name changes whenever any application code does.
const bundle = html.match(/entry-([0-9a-f]{8,})\.js/);
if (!bundle) {
  fail('No entry bundle found in dist/index.html. Has the export layout changed?');
}
const build = bundle[1].slice(0, 12);

const sw = fs.readFileSync(swPath, 'utf8');
if (!STAMP.test(sw)) {
  fail("No `const BUILD = '...';` line in dist/sw.js. Restore it in public/sw.js.");
}

const stamped = sw.replace(STAMP, `const BUILD = '${build}';`);
fs.writeFileSync(swPath, stamped);

console.log(`\n  ✓ stamp-sw: service worker stamped ${build}\n`);
