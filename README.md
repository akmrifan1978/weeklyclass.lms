# WeeklyClass LMS

A multilingual learning-management app for Islamic weekly classes, built with
Expo (React Native) and Firebase. One codebase runs on **Android, iOS and the
web**, in **English, Tamil, Sinhala and Arabic** (with full right-to-left
support), for **students, teachers and admins**.

It is designed to run on Firebase's **free Spark plan** — no billing card
required — and the places where that constrains the design are called out
explicitly rather than glossed over. See [Free-tier honesty](#free-tier-honesty).

---

## What it does

**Students** get a home screen with the next class, the newest video release,
the latest article and quick access to weekly lessons, class recordings, study
materials, quizzes, attendance and results.

**Teachers** get whatever an admin has granted them — nothing more. A teacher
with `CREATE_LESSONS` sees a lessons screen; one without it does not, and the
database refuses the write regardless. Everything a teacher touches is scoped to
their own classes.

**Admins** get a full dashboard: users, students, teachers, branches, classes,
lessons, videos, articles, materials, calendar, attendance, quizzes, results,
reports, notifications, announcements, per-teacher permissions, languages,
settings and an append-only audit log.

---

## Quick start

```bash
npm install
```

```bash
cp .env.example .env
```

Fill `.env` with your Firebase web config (Console → Project settings → Your
apps → Web app), then:

```bash
npm start
```

Press `w` for web, `a` for Android, `i` for iOS, or scan the QR code with Expo
Go.

Before the app is useful you need Firebase set up and a first admin — that is
about ten minutes, and [docs/FIREBASE.md](docs/FIREBASE.md) walks through every
step.

---

## Project layout

```
app/                      expo-router routes (file path = URL)
  index.tsx               splash: role picker + language picker
  (auth)/                 login, register, forgot password, forgot username
  (student)/              student tabs + lesson/video/article/quiz/result screens
  (teacher)/              teacher tabs + the feature screens their permissions allow
  (admin)/                21 admin screens behind a responsive sidebar

src/
  components/ui/          the design system: Button, Card, Input, Select, states…
  components/shared/      cross-role pieces: profile, notifications, admin shell
  features/               feature managers reused by admin and teacher screens
  services/               all Firestore/Storage/Auth access — no I/O in components
  contexts/               auth session, language, toasts
  hooks/                  useAsync, usePaginated, useResponsive, useTeacherScope
  i18n/locales/           en.json, ta.json, si.json, ar.json — 514 keys each
  constants/              theme tokens, collection names, permission catalogue
  types/                  the data model and the permission union
  utils/                  dates, formatting, validation, error mapping

firebase/
  firestore.rules         the real access control — 500+ lines, default-deny
  storage.rules           path, type and size enforcement
  firestore.indexes.json  61 composite indexes, one per query the app issues

scripts/
  seed.js                 settings, languages, countries (idempotent)
  set-claims.js           create the first admin; mirror roles into custom claims
```

The rule of thumb: **components never call Firestore.** They call a service, and
the service is the only place that knows about collections, queries and writes.
That is what keeps the security model reviewable in one directory.

---

## Architecture notes worth knowing

**Permissions are data, not code.** A teacher's abilities live in
`users/{uid}.permissions` as a map of 34 flags. The UI reads them through
`useAuth().can()`; Firestore re-reads the same map in its rules. Adding a
capability means adding one entry to `src/types/permissions.ts` and one line to
the rules — not touching 20 screens.

**Every list is paginated.** There is no "fetch the whole collection" helper in
`src/services/firestore.ts`, on purpose. A branch with 5,000 students costs the
same first page as one with 20.

**Counts use aggregation queries.** The admin dashboard's eleven statistics are
`getCountFromServer` calls, billed one read per 1,000 matched documents rather
than one per document — so the dashboard stays cheap as the platform grows.

**Soft delete by default.** Removing a lesson sets `deleted: true` rather than
destroying the row, so attendance records and quiz results keep their subject.
Hard delete is admin-only.

**The audit log is append-only at the rules level.** Any signed-in user can
append (their own actions are logged), and *nobody* — admins included — can
edit or delete an entry from a client. Rewriting history is simply not
expressible.

---

## Free-tier honesty

Everything below works today on the Spark plan. Where a feature is genuinely
limited without billing, it says so here and in the app itself, rather than
appearing to work and quietly failing.

| Area | Works free | The honest limitation |
|---|---|---|
| Auth, Firestore, Storage, Hosting | Yes | 50k reads/day, 5 GB storage, 1 GB/day downloads |
| Push to devices, sent now | Yes | Via the Expo Push Service, which needs no secret key |
| Push to devices, **scheduled** | Partly | The record is stored and appears in-app at the chosen time. Firing a *device* push at that moment needs a server job (Cloud Functions → Blaze). The compose screen says this on the form. |
| Web push | No | Sending to FCM web tokens requires a server key, which must never ship in client code. Web users get in-app notifications. |
| Video hosting | Yes | Only URLs are stored. Uploading media would exhaust the quota immediately, so the app plays from YouTube/Vimeo/any direct link. |
| Creating users as an admin | Yes | Uses a throwaway secondary Firebase app so the admin is not signed out. The Admin SDK would be cleaner but needs a server. |
| Quiz grading | Yes | Graded on the client, with the answer key read-gated until the attempt is submitted and the result write-once. The residual gap and its fix are in [docs/SECURITY.md](docs/SECURITY.md). |
| Role checks in Storage rules | Partly | Storage rules cannot read Firestore. Run `npm run set-claims` to mirror roles into custom claims and tighten them. Explained at the top of `firebase/storage.rules`. |

---

## Documentation

| Document | What it covers |
|---|---|
| [docs/FIREBASE.md](docs/FIREBASE.md) | Project setup, rules and index deployment, the first admin, emulators |
| [docs/SECURITY.md](docs/SECURITY.md) | The permission model, what the rules guarantee, and the known gaps |
| [docs/I18N.md](docs/I18N.md) | How translation works and how to add a fifth language |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Building for Android, iOS and web; Vercel and Firebase Hosting |
| [docs/NOTIFICATIONS.md](docs/NOTIFICATIONS.md) | What sends today, and the Cloud Function to add when you upgrade |

---

## Commands

```bash
npm start                  # Expo dev server (web, Android, iOS)
npm run typecheck          # TypeScript, strict mode, zero errors expected
npm run build:web          # static web build
npm run firebase:deploy    # rules + indexes
npm run emulators          # local Auth/Firestore/Storage emulators
npm run seed               # settings, languages, countries
npm run set-claims         # first admin / role claims
```

---

## Licence

MIT — see [LICENSE](LICENSE).
