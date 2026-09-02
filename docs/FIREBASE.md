# Firebase setup

About ten minutes from an empty Firebase project to a working app with an admin
account. Everything here works on the free **Spark** plan.

---

## 1. Create the project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) →
   **Add project**.
2. Name it (e.g. `weeklyclass-lms`). Google Analytics is optional — the app
   works without it and skips analytics calls when it is absent.
3. Leave the plan as **Spark**. Do not add billing.

## 2. Enable the services

In the console's left-hand sidebar:

**Authentication** → Get started → **Sign-in method** → enable
**Email/Password**. Leave "Email link" off.

**Firestore Database** → Create database → **Production mode** (the rules in
this repo replace the defaults in step 5) → pick the region closest to your
users. *The region cannot be changed later.*

**Storage** → Get started → Production mode → same region.

## 3. Register a web app and copy the config

**Project settings** (gear icon) → **Your apps** → **Web** (`</>`) → give it a
nickname → Register.

Copy the `firebaseConfig` values into `.env` in the project root:

```bash
cp .env.example .env
```

```
EXPO_PUBLIC_FIREBASE_API_KEY=AIza...
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your-project
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1234567890
EXPO_PUBLIC_FIREBASE_APP_ID=1:1234567890:web:abc123
EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID=G-XXXXXXX
```

> **On the API key.** A Firebase web API key is not a secret — it identifies the
> project, it does not authorise anything. Access is decided entirely by the
> security rules. `EXPO_PUBLIC_` variables are compiled into the bundle by
> design. What must never be committed is a **service account key**, which is a
> different thing entirely; `.gitignore` already excludes `*serviceAccount*.json`.

## 4. Install the Firebase CLI

```bash
npm install -g firebase-tools
```

```bash
firebase login
```

```bash
firebase use --add
```

Pick your project and give it the alias `default`.

## 5. Deploy rules and indexes

This is the step that actually secures the project. Do it before letting anyone
register.

```bash
npm run firebase:deploy
```

That deploys all three files:

| File | What it does |
|---|---|
| `firebase/firestore.rules` | The real access control. Default-deny; every permission the UI checks is re-checked here. |
| `firebase/firestore.indexes.json` | 61 composite indexes — one for each multi-field query the app issues. |
| `firebase/storage.rules` | Path ownership, MIME type and size caps. |

Index builds take a few minutes on a new project. Until they finish, some
screens will show an error containing a "create index" link — the indexes here
already cover every query, so you should not need to click one. If you do, it
means a query was added without a matching index; add it to
`firestore.indexes.json` rather than only clicking the link, so the repo stays
the source of truth.

## 6. Seed the starting data

```bash
npm install --no-save firebase-admin
```

Download a service account key: **Project settings → Service accounts →
Generate new private key**. Save it as `serviceAccount.json` in the project root
(already git-ignored).

```bash
npm run seed -- --key ./serviceAccount.json
```

This writes `settings/app`, the four languages, fourteen starter countries and
one default organisation. It is idempotent — safe to re-run.

Nothing about geography is hard-coded in the app; those countries are only a
starting point, and admins add, rename or remove them from the Branches screen.

## 7. Create the first admin

`firestore.rules` deliberately refuses to let anyone self-register as an admin,
so the first one has to be made out-of-band. Two ways:

**Option A — the script (repeatable):**

Register normally in the app first (as a student or teacher), then:

```bash
npm run set-claims -- --key ./serviceAccount.json --email you@example.com --role admin
```

This sets both the Firestore role and the Auth custom claim, and records the
promotion in the audit log.

**Option B — the console (no extra install):**

Register in the app, then Firestore → `users` → your document → set `role` to
`admin` and `status` to `active`. This does *not* set the custom claim, so
Storage rules will still treat you as a plain signed-in user; see
[SECURITY.md](SECURITY.md) for what that affects.

Sign out and back in afterwards — claims only reach the ID token on a fresh
sign-in.

## 8. First run

```bash
npm start
```

Sign in as your admin and work through, roughly in this order:

1. **Settings** — app name, tagline, contact details, whether registration is
   open and whether new accounts need approval.
2. **Branches** — add a country if yours is missing, then an organisation, then
   your first branch.
3. **Classes** — create a class inside that branch.
4. **Teachers** — add a teacher, then open **Permissions** and grant exactly
   what they should be able to do.
5. **Students** — add students, or let them self-register and approve them from
   the pending list on the dashboard.

---

## Local emulators

To develop without touching production data:

```bash
npm run emulators
```

Ports: Auth `9099`, Firestore `8080`, Storage `9199`, UI `4000`.

Set `EXPO_PUBLIC_USE_EMULATORS=true` in `.env` and the app connects to them
automatically (`src/firebase/config.ts` handles the wiring). Emulator data is
wiped on exit unless you pass `--export-on-exit`.

Rules changes are picked up live by the emulator, which makes it the fastest way
to test a rule edit.

---

## Staying inside the free quota

The Spark plan gives **50,000 document reads, 20,000 writes and 20,000 deletes
per day**, 1 GiB stored, 5 GB in Cloud Storage and 1 GB/day of Storage
downloads. For a few hundred active students that is comfortable, and the app is
built to keep it that way:

- Every list is cursor-paginated; nothing fetches a whole collection.
- Dashboard counters use `getCountFromServer` — one read per 1,000 documents
  matched, not one per document.
- The notification badge polls every two minutes rather than holding a listener
  on a collection the user only partially matches.
- Only the signed-in user's own profile is held on a live listener, so a
  revoked permission takes effect immediately without polling anything else.
- No video or audio is ever uploaded to Storage.

If you do approach the limits, the first things to look at are the notification
badge interval (`app/(student)/(tabs)/_layout.tsx`) and `PAGE_SIZE` in
`src/constants/app.ts`.

---

## Troubleshooting

**"Missing or insufficient permissions"** — rules are not deployed, or the
signed-in user's `status` is not `active`. Check the user document first; a
`pending` account is blocked by design.

**"The query requires an index"** — an index is still building, or a query was
added without one. Wait, then add the index to `firestore.indexes.json`.

**Registration says it is closed** — `settings/app.registrationEnabled` is
false, or the document does not exist. Run the seed script.

**Login works but the app bounces back to the splash screen** — the
`users/{uid}` document is missing or `status` is not `active`. The session gate
signs out any account it cannot verify.

**Uploads fail for a teacher** — expected until custom claims are set for
`branding/`; other paths only require a signed-in user. See the comment block at
the top of `firebase/storage.rules`.
