#!/usr/bin/env node
/**
 * Starts the Expo web dev server on whatever port the harness assigned.
 *
 * WHY THIS EXISTS, because `npx expo start --web` looks like it would do the
 * same thing and quietly would not:
 *
 * The preview harness picks a free port and hands it over as the PORT
 * environment variable. Expo's CLI never reads PORT. It resolves its port from
 * the --port flag, and failing that from RCT_METRO_PORT, and failing that from
 * the hard default 8081 (see resolvePortAsync in @expo/cli/build/src/utils/port.js).
 *
 * So with PORT set and nothing translating it, Expo lands on 8081 regardless.
 * When another chat's dev server already holds 8081 the start fails, and when
 * it does not, Expo binds a port the harness is not watching and the preview
 * pane stares at an empty one. This script is the translation step: PORT in,
 * RCT_METRO_PORT out.
 *
 * The port is deliberately NOT pinned. Nothing in this project is bound to
 * 8081 — Firebase Auth authorises by domain rather than by origin, Cloudinary
 * uploads are unsigned POSTs to their own host, and service workers and web
 * push both treat any localhost port as a secure context. So any free port
 * works, which is what lets two chats run this app side by side.
 *
 *   node scripts/dev-web.js              (run for you by the preview pane)
 *   node scripts/dev-web.js --tunnel     (extra args are passed through)
 */

const { spawn } = require('child_process');

const cli = require.resolve('expo/bin/cli');

const env = { ...process.env };

// Expo reads RCT_METRO_PORT, not PORT. Translate, and only when the harness
// actually assigned one — an unset PORT means "run it however you normally do".
const assigned = process.env.PORT;
if (assigned) {
  const port = Number.parseInt(assigned, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`dev-web: PORT is set to "${assigned}", which is not a usable port.`);
    process.exit(1);
  }
  env.RCT_METRO_PORT = String(port);
  console.log(`dev-web: serving on port ${port} (PORT -> RCT_METRO_PORT)`);
}

const args = ['start', '--web', '--clear', ...process.argv.slice(2)];

const child = spawn(process.execPath, [cli, ...args], { stdio: 'inherit', env });

// Hand Ctrl+C and a harness shutdown straight through, so Metro gets the
// chance to clean up its watchers instead of being orphaned.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

child.on('error', (err) => {
  console.error(`dev-web: could not start the Expo CLI — ${err.message}`);
  process.exit(1);
});
