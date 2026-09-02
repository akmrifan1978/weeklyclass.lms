# Deployment

One codebase, three targets. Web hosting is free; app-store builds are free to
produce, though the stores themselves charge to publish.

---

## Before any build

```bash
npm run typecheck
```

Then make sure rules and indexes are live — a build against an unsecured
database is worse than no build:

```bash
npm run firebase:deploy
```

---

## Web

The web build is a static export, so it can go anywhere. Two good free options.

### Firebase Hosting

Already in the same project as your database, no extra account.

```bash
npm run build:web
```

```bash
firebase init hosting
```

When asked for the public directory, answer **`dist`**, configure as a
single-page app (**yes**), and do not overwrite `index.html`.

```bash
firebase deploy --only hosting
```

Free tier: 10 GB stored, 360 MB/day transferred, SSL and a
`your-project.web.app` domain included.

### Vercel

`vercel.json` is already configured for the Expo web output — static build from
`dist` with an SPA rewrite so client-side routes resolve on refresh.

```bash
npm install -g vercel
```

```bash
vercel
```

Add the `EXPO_PUBLIC_FIREBASE_*` variables in the Vercel dashboard under
**Settings → Environment Variables** before the first production deploy, or the
app will boot without a Firebase config.

### After deploying to a domain

Add the domain to **Firebase Console → Authentication → Settings → Authorised
domains**, or sign-in will fail with `auth/unauthorized-domain`.

---

## Android

### Development build (for testing push on a real device)

Expo Go cannot deliver push notifications reliably; use a development build.

```bash
npm install -g eas-cli
```

```bash
eas login
```

```bash
eas build --profile development --platform android
```

Install the resulting APK on your phone, then `npm start` and connect.

### Production

`eas.json` already defines the profiles. For a shareable APK:

```bash
eas build --profile preview --platform android
```

For the Play Store (produces an `.aab`):

```bash
eas build --profile production --platform android
```

Then either upload the `.aab` in the Play Console manually, or:

```bash
eas submit --platform android
```

**Before your first Play Store build**, set a real `package` in `app.json`
(`com.yourorg.weeklyclass`) and increment `version`. Play requires a one-time
$25 developer registration.

### Icons and splash

`assets/` already contains an adaptive icon (background, foreground and
monochrome layers) and a splash image, wired up in `app.json`. Replace the PNGs
in place and rebuild — no config changes needed.

---

## iOS

Same commands, `--platform ios`:

```bash
eas build --profile production --platform ios
```

You need an Apple Developer account ($99/year) to build for a device or the
store. EAS handles certificates and provisioning profiles for you if you let it.

```bash
eas submit --platform ios
```

Set `ios.bundleIdentifier` in `app.json` before the first build.

---

## Environment variables

Everything the client needs is `EXPO_PUBLIC_`-prefixed, which means it is
compiled into the bundle. That is correct for Firebase web config — it
identifies the project, it does not authorise anything, and access is decided
entirely by the security rules.

| Variable | Required | Notes |
|---|---|---|
| `EXPO_PUBLIC_FIREBASE_API_KEY` | Yes | |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | Yes | |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | Yes | |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | Yes | |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | Yes | |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | Yes | |
| `EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID` | No | Analytics; omit to disable |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | For push | Also read from `app.json` |
| `EXPO_PUBLIC_RECAPTCHA_SITE_KEY` | No | Enables App Check on web |
| `EXPO_PUBLIC_USE_EMULATORS` | No | `true` to use local emulators |

A **service account key** is a different thing entirely and must never be
committed or bundled. It is only used by `scripts/*.js` on your machine.

For EAS builds, set the same variables as EAS secrets:

```bash
eas secret:create --scope project --name EXPO_PUBLIC_FIREBASE_API_KEY --value "AIza..."
```

---

## Release checklist

- [ ] `npm run typecheck` passes
- [ ] Rules and indexes deployed; indexes finished building
- [ ] `settings/app` seeded, with a real app name, tagline and support email
- [ ] At least one admin exists and can sign in
- [ ] `requireApproval` set the way you want it for a public launch
- [ ] App Check enabled (set `EXPO_PUBLIC_RECAPTCHA_SITE_KEY`, then enforce in
      the console)
- [ ] Custom claims synced if you tightened `storage.rules`
      (`npm run set-claims -- --sync-all`)
- [ ] Production domain added to Firebase authorised domains
- [ ] Tested in all four languages, including Arabic RTL
- [ ] Tested as all three roles, and as a teacher with only *some* permissions
- [ ] Push tested on a physical device

---

## Updating a released app

Web and any JavaScript-only change:

```bash
npm run build:web && firebase deploy --only hosting
```

For native, EAS Update ships JS changes without a store review:

```bash
eas update --branch production --message "Fix attendance summary rounding"
```

A new store build is only needed when native code changes — a new Expo SDK, a
new native module, or an icon/splash/permissions change in `app.json`.
