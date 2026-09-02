# Security model

The guiding rule of this project: **the client is never trusted.** Hiding a
button stops nobody who can call the Firestore API directly, so every permission
the UI checks is re-checked in `firebase/firestore.rules`.

This document explains what those rules guarantee, and — just as importantly —
what they do not.

---

## The three roles

| Role | How it is obtained | What it can do |
|---|---|---|
| `student` | Self-registration | Read content assigned to their class; write their own quiz attempts and results |
| `teacher` | Self-registration, or created by an admin | Exactly the permissions an admin has granted, limited to their own classes |
| `admin` | **Never** by self-registration — see below | Everything |

Self-registration is restricted at the rules level to `student` and `teacher`:

```
allow create: if isSelf(uid)
              && request.resource.data.role in ['student', 'teacher']
              && request.resource.data.status in ['pending', 'active']
```

and a self-registering account cannot hand itself the dangerous permissions:

```
&& !request.resource.data.get('permissions', {}).keys().hasAny([
     'MANAGE_USERS', 'MANAGE_SETTINGS', 'MANAGE_BRANCHES',
     'MANAGE_LANGUAGES', 'DELETE_STUDENTS', 'DELETE_TEACHERS'
   ])
```

So the first admin must be created out-of-band, with `scripts/set-claims.js` or
the Firebase Console. That is deliberate: there is no in-app path to
administrator.

---

## Permissions

34 flags, grouped in `src/types/permissions.ts`, stored as a map on
`users/{uid}.permissions`:

```
VIEW_STUDENTS   CREATE_STUDENTS   EDIT_STUDENTS   DELETE_STUDENTS
VIEW_TEACHERS   CREATE_TEACHERS   EDIT_TEACHERS   DELETE_TEACHERS
VIEW_CLASSES    CREATE_CLASSES    EDIT_CLASSES    DELETE_CLASSES
VIEW_LESSONS    CREATE_LESSONS    EDIT_LESSONS    DELETE_LESSONS
UPLOAD_VIDEO    DELETE_VIDEO      UPLOAD_MATERIAL DELETE_MATERIAL
VIEW_ATTENDANCE EDIT_ATTENDANCE
CREATE_QUIZ     EDIT_QUIZ         DELETE_QUIZ
VIEW_RESULTS    EDIT_RESULTS
MANAGE_CALENDAR MANAGE_ARTICLES   MANAGE_ANNOUNCEMENTS  SEND_NOTIFICATIONS
MANAGE_USERS    MANAGE_SETTINGS   MANAGE_BRANCHES       MANAGE_LANGUAGES
```

Admins hold all of them implicitly — the rules never read an admin's permission
map, so it cannot drift out of sync:

```
function can(permission) {
  return isAdmin()
    || (isTeacher() && userDoc().get('permissions', {}).get(permission, false) == true);
}
```

**Only an admin can change a permission map.** The self-update rule enumerates
the fields a user may edit about themselves, and `role`, `status` and
`permissions` are all absent from that list. That single omission is what
prevents privilege escalation.

---

## Class scoping

A permission alone is not enough for a teacher. `CREATE_LESSONS` lets them
create lessons *in their own classes*:

```
allow create: if can('CREATE_LESSONS')
              && teachesClass(request.resource.data.classId);
```

where

```
function teachesClass(classId) {
  return isAdmin()
    || (isTeacher()
        && exists(/databases/$(database)/documents/classes/$(classId))
        && request.auth.uid in classDoc(classId).get('teacherIds', []));
}
```

`classes/{id}.teacherIds` is the single source of truth for that, and
`orgService.saveClass` always merges the primary `teacherId` into it so the two
cannot disagree.

The UI mirrors this through `useTeacherScope()`, which loads the same list — so
a teacher is never offered a class the database would reject.

---

## Account status

A `pending`, `suspended` or `inactive` account can do **nothing**:

```
function isActive() {
  return userExists()
    && userDoc().status == 'active'
    && userDoc().get('deleted', false) == false;
}
```

Every other helper builds on `isActive()`, so suspending an account revokes
everything at once. The app also holds a live listener on the signed-in user's
own profile, so a suspension takes effect in an open app immediately — no
logout required, no polling.

---

## Quiz integrity

This is the most carefully designed part of the model, because grading has to
happen somewhere and the free tier has no server.

**Data layout:**

```
quizzes/{quizId}                     metadata
quizzes/{quizId}/questions/{qId}     text + options — NO correct answer
quizzes/{quizId}/answerKey/{qId}     { correctIndex } — read-gated
quizAttempts/{attemptId}             one sitting; frozen once submitted
results/{resultId}                   the graded outcome; write-once
```

**Three rules do the work:**

1. The answer key is unreadable until the student has a *submitted* attempt:

   ```
   allow read: if isStaff() || (isStudent() && hasSubmittedAttempt(quizId, request.auth.uid));
   ```

   So answers cannot be read in advance. Attempt ids are deterministic
   (`{quizId}_{uid}_{n}`), which makes this an `exists()` check rather than a
   query.

2. An attempt is immutable once submitted:

   ```
   allow update: if isStudent()
                 && resource.data.studentId == request.auth.uid
                 && resource.data.status == 'in_progress'
                 && ...
   ```

   Answers can be revised freely *during* the attempt and are frozen at
   submission — so a student cannot read the key and then change what they
   answered.

3. A result is written once, by its owner, and never edited by them:

   ```
   allow create: if isStudent()
                 && request.resource.data.studentId == request.auth.uid
                 && resultId == request.resource.data.attemptId
                 && request.resource.data.score <= request.resource.data.totalMarks;
   allow update: if can('EDIT_RESULTS') || isAdmin();
   ```

   The deterministic id means a retry cannot duplicate a result, and a student
   cannot revise their score afterwards.

### The residual gap, stated plainly

A determined student could submit a deliberately empty attempt, read the answer
key that unlocks, and then write an inflated score in the `results` document
they are allowed to create once. The rules bound the score to `totalMarks` but
cannot verify it is *correct* — checking that would mean re-grading inside a
security rule, which the rules language cannot do (no loops over a map).

**What limits the damage today:** it can only be done once per attempt, only for
a quiz they are entitled to take, only within the attempt limit the teacher set,
and the inflated result is visible to any teacher with `VIEW_RESULTS`, who can
regrade it.

**The fix,** when you move to the Blaze plan: grade in a Cloud Function and make
`results` client-writable never. `quizService.submitAttempt()` is deliberately
the single seam where that swap happens — no screen changes.

---

## The audit log

`auditLogs` is append-only *at the rules level*:

```
allow read:   if isAdmin();
allow create: if isSignedIn() && request.resource.data.actorId == request.auth.uid;
allow update, delete: if false;
```

Nobody — including admins — can edit or remove an entry from a client. Entries
record who, what action, which collection and document, a human summary, and a
field-level diff for updates.

Audit writes are fire-and-forget in `auditService.log()`: a logging failure
never breaks the action being logged. The trade-off is that a network failure
can lose an entry; that is the right way round for a classroom app.

---

## Storage rules and the custom-claims gap

**Cloud Storage rules cannot read Firestore.** There is no way to ask "does this
user hold `UPLOAD_MATERIAL`?" from a Storage rule, because that flag lives in a
Firestore document. Role-based Storage rules require Firebase Auth **custom
claims**, and claims can only be set by the Admin SDK.

So Storage uses two layers:

- **Layer 1 (`storage.rules`)** — authentication, path ownership, MIME type,
  size caps. `avatars/{uid}/` is genuinely owner-scoped because the uid is in
  the path. `branding/` requires a real admin claim.
- **Layer 2 (Firestore)** — the actual permission check. A file only becomes
  *discoverable* when a `materials` / `videos` / `articles` document points at
  its URL, and creating that document is permission-gated.

A signed-in student could push a stray 20 MB PDF into `materials/`, but nobody
would ever see it and no material record would exist.

**To close this properly:**

```bash
npm run set-claims -- --key ./serviceAccount.json --sync-all
```

then change `isSignedIn()` to `isStaff()` in the material, thumbnail and article
blocks of `firebase/storage.rules`. `isStaff()` is already defined there. On the
Blaze plan, a Firestore `onWrite` trigger on `users/{uid}` keeps claims in sync
automatically.

---

## Account enumeration

Signing in with a username means resolving it to an email *before*
authenticating, which needs a publicly readable index. Two exist:

```
usernames/{usernameLower}   -> { uid, email, role }
emailLookup/{sha256(email)} -> { username }
```

Both allow `get` but **deny `list`**:

```
allow get: if true;
allow list: if isAdmin();
```

You must already know the exact username — or the exact email, since the
document id is its SHA-256 — to read a row. Neither collection can be
enumerated, and the email index stores a hash rather than the address itself.

Related choices in the same spirit:

- A failed username lookup returns the *same* message as a wrong password, so
  login does not reveal which usernames exist.
- Password reset always reports success, whether or not the address is
  registered.
- Username claims run in a Firestore transaction, so two simultaneous
  registrations cannot both take the same name.

---

## What is deliberately not done

**No App Check enforcement by default.** `src/firebase/appCheck.ts` initialises
App Check when `EXPO_PUBLIC_RECAPTCHA_SITE_KEY` is set, and skips it otherwise.
Enabling enforcement without a configured key would lock out every client, so it
is opt-in. Turn it on before a public launch.

**No rate limiting.** Firestore has no client-side rate limiting. Firebase Auth
throttles repeated failed sign-ins on its own; anything beyond that needs a
server.

**No field-level encryption.** Nothing stored is more sensitive than a name,
email, phone number and date of birth. Encrypting those client-side would break
search and sorting for no real gain, given the rules already restrict who can
read them.

---

## Reviewing a change

When adding a collection or a query, work through:

1. Does `firestore.rules` have an explicit `match` block for it? Anything
   unmatched is denied — that is the default and should stay that way.
2. Is read access scoped to the narrowest sensible audience?
3. Is write access gated on `can(...)` *and*, for class content,
   `teachesClass(...)`?
4. Can a user escalate by writing a field they should not control? Prefer
   `onlyChanged([...])` allow-lists over `!changedKeys().hasAny([...])`
   deny-lists.
5. Does the query have a matching composite index in
   `firestore.indexes.json`?
6. Is the action audit-logged if it changes someone else's data?

Testing rule changes is fastest against the emulator (`npm run emulators`),
which reloads them on save.
