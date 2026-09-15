# Notifications

What actually sends today on the free plan, what does not, and exactly what to
add when you upgrade.

---

## Three delivery paths

| Path | Reaches | Needs a server? |
|---|---|---|
| **In-app** | Everyone, on every platform | No |
| **Device push, sent now** | Android / iOS | No — Expo Push Service |
| **Local scheduled** | The device that scheduled it | No |
| **Device push, scheduled** | Android / iOS | **Yes** — Cloud Functions |
| **Web push** | Browsers | **Yes** — needs an FCM server key |

### In-app — always works

Every notification is written to the `notifications` collection.
`notificationService.inboxFor(user)` runs one small query per audience the user
belongs to — `all`, their role, their class, their branch, and anything
addressed to them personally — and merges the results. That is three to five
reads per refresh, comfortably inside the free quota.

The tab badge polls every two minutes rather than holding an open listener,
because a user only partially matches the collection and Firestore cannot OR
across fields in a single subscription.

### Device push, sent now — works, free

Native devices register an **Expo push token** (`pushService.registerForPush()`)
which is stored on `users/{uid}.pushTokens`, keyed by device.

When an admin sends immediately, `notificationService.send()` collects the
recipients' tokens and POSTs to:

```
https://exp.host/--/api/v2/push/send
```

This endpoint needs **no secret key**, which is what makes real device push
possible with no server at all. Tokens are sent in batches of 100 (Expo's
documented limit), and the call returns a report rather than throwing — a failed
push must never roll back the notification the user can still see in-app.

The admin sees the outcome on screen, e.g.
*"Delivered in-app to 143 user(s); pushed to 118/120 device(s)."*

### Local scheduled — works, free

`pushService.scheduleEventReminders()` schedules on-device notifications one
hour and fifteen minutes before each of a student's next few classes. These fire
even with the app closed, because the OS owns the schedule.

Re-opening the app clears and re-schedules, so reminders never stack up. This is
called from the student home screen.

---

## What does not work without billing

### Scheduled *device* push

An admin can schedule a notification for 8pm on Friday. The record is stored
with `status: 'scheduled'` and appears in-app at that time, because the inbox
query filters on `scheduledAt <= now`.

But firing a *device* push at that moment requires something running when nobody
has the app open — a server job. There is no way around that on Spark.

The app is honest about it rather than pretending: the compose screen shows this
warning as soon as a schedule is set, and the same text is stored on the record
as `deliveryNote`.

> Stored as a scheduled notification. It appears in the app at the chosen time.
> Device push at that exact moment requires a Cloud Function (Blaze plan).

### Web push

Sending to an FCM web token requires a **server key**, which must never ship in
client code. Web users therefore get in-app notifications only, and
`registerForPush()` returns `{ granted: false, reason: 'unsupported' }` on web
rather than asking for a permission it cannot honour.

---

## Turning on scheduled push later

Nothing in the app changes. Scheduled notifications are already stored in the
shape a server job wants; you only add the job.

**1.** Upgrade to Blaze (there is still a generous free allowance — a job this
small typically costs nothing).

**2.** `firebase init functions`

**3.** Add a scheduled function:

```js
const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');
admin.initializeApp();

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

exports.sendScheduledNotifications = onSchedule('every 5 minutes', async () => {
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();

  const due = await db
    .collection('notifications')
    .where('status', '==', 'scheduled')
    .where('scheduledAt', '<=', now)
    .limit(50)
    .get();

  for (const doc of due.docs) {
    const n = doc.data();

    // Reuse the same audience logic the client uses; see
    // notificationService.resolveRecipients for the filters.
    const recipients = await resolveRecipients(db, n);
    const tokens = recipients.flatMap((u) => Object.values(u.pushTokens ?? {}));

    for (let i = 0; i < tokens.length; i += 100) {
      await fetch(EXPO_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          tokens.slice(i, i + 100).map((to) => ({
            to,
            title: n.title,
            body: n.message,
            data: { notificationId: doc.id, route: n.route ?? null },
            sound: 'default',
            channelId: 'default',
          }))
        ),
      });
    }

    await doc.ref.update({
      status: 'sent',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      deliveryNote: `Pushed to ${tokens.length} device(s) by scheduler.`,
    });
  }
});
```

**4.** `firebase deploy --only functions`

The composite index this query needs (`deleted` + `status` + `createdAt`) is
already in `firestore.indexes.json`; add `scheduledAt` to it if you order by
that field instead.

Once deployed, remove the warning text from
`src/features/notifications/NotificationComposer.tsx` and the
`notification.scheduledNote` string — at that point it would be untrue.

---

## Notification categories

`NotificationCategory` in `src/types/models.ts` drives the icon shown in the
inbox:

```
general           class_reminder    new_lesson      new_video
quiz_available    quiz_closing      new_article     event_reminder
attendance_reminder                 announcement
```

Adding one means adding the union member, an icon in
`src/components/shared/NotificationList.tsx`, and an option in the composer.

---

## Notifications vs announcements

Two similar-looking features that are deliberately separate:

- **Notifications** are events. They arrive, they can push to a device, they are
  marked read per user (`readBy`), and they can carry a `route` that deep-links
  into a screen when tapped.
- **Announcements** are standing notices. They sit on the dashboard, have a
  priority (`low` → `urgent`) that affects styling and ordering, and expire on a
  date rather than being dismissed.

Use a notification for "tonight's class is cancelled". Use an announcement for
"term two begins on the 3rd".

---

## Testing push

Expo push tokens only exist on a **physical device** — `registerForPush()`
returns `{ reason: 'simulator' }` on a simulator, and `{ reason: 'unsupported' }`
on web.

1. Run the app on a real phone through Expo Go or a development build.
2. Sign in, open **Notifications**, tap **Enable push notifications**, accept.
3. Check `users/{uid}.pushTokens` in the console for an
   `ExponentPushToken[...]` value.
4. Send an immediate notification from the admin dashboard.

To test a token directly, Expo's push tool at
[expo.dev/notifications](https://expo.dev/notifications) accepts a token and a
message.

If a token is present but nothing arrives, the usual causes are notifications
disabled at the OS level, or a stale token from a reinstall — signing out and
back in re-registers it under the same device key.

## Booking confirmation email

A separate path from everything above, and the only one that leaves the app by
email. It exists because the browser cannot send mail and Firebase's own
templates belong to Google — they carry a password reset and nothing else, so
an event's date, ticket code and WhatsApp link have no way into them.

The local service sends it, in the same pass that sends push. Setting it up is
five variables and a free mailbox; without them the service says so once and
carries on, and every other delivery path is unaffected.

### What it costs

Nothing. It speaks plain SMTP, so any free mailbox works:

| Provider | Free allowance | Needs a domain? |
| --- | --- | --- |
| Gmail app password | 500 a day | No |
| Brevo | 300 a day | No, verify a sender address |
| Zoho Mail | Free tier | Yes |

Nothing in the code is tied to a provider. Point the five variables at whatever
you have.

### Setting it up with Gmail

1. The Google account needs 2-Step Verification switched on.
2. Visit <https://myaccount.google.com/apppasswords> and create an app password.
   It is sixteen characters. This is **not** the account password, it can be
   revoked on its own, and it is the only kind of password Gmail's SMTP accepts.
3. Add these to the same `.env` the push keys live in:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=you@gmail.com
SMTP_PASS=the sixteen character app password
MAIL_FROM="Jeddah Dawah Center" <you@gmail.com>
```

`MAIL_FROM` is optional and defaults to `SMTP_USER`. Port 465 is used with
implicit TLS; set 587 instead and STARTTLS is used, which is what Brevo wants.

### What goes out

One email per booking the organiser confirms, to the address on the account.
It carries the event title, when and where, the number of places, and the same
ticket code the app prints on the ticket — the code is generated by a copy of
the app's own function, so the two always agree.

When the event has a WhatsApp group link there is a green **Join WhatsApp
Group** button under the details. When it has none, that whole block is absent:
no heading, no gap, no dead button.

### How it avoids sending twice

The queue is a field on the booking. `confirmationEmailedAt` is written as
`null` when a booking is created or confirmed, and stamped with a time once the
mail is away. The service asks only for confirmed bookings where it is still
null.

A booking whose owner signs in by mobile number and has no address is stamped
as done rather than retried for ever.

The stamp is written *after* the send returns, so a service killed mid-pass
resends at worst. A duplicate confirmation is a far better failure than a
silent absence.

## New registration alerts

When somebody registers and is waiting for approval, the admins are told. It
only happens while **Automatically Approve New Registrations** is OFF in
Admin → Settings: with it ON nobody waits, so there is nothing to approve.

| Where | When | Needs |
| --- | --- | --- |
| A message at the top of the admin panel | the moment it happens, while the panel is open | nothing |
| The admins' phones and computers (push) | the next delivery run, within about five minutes | notifications switched on in the admin's profile |
| Email to every active admin | the next delivery run | the `SMTP_*` secrets below, as for booking emails |
| WhatsApp to the admin's own phone | the next delivery run | `CALLMEBOT_PHONE` and `CALLMEBOT_APIKEY` |

Each registration is announced **once per channel**. What was sent is kept in
`registrationAlerts/{uid}`, and each channel is claimed before it is sent, so a
retry or two copies of the job running together never repeat one. A send that
fails outright (a wrong email password, say) is tried again on the next run, up
to five times. Registrations older than seven days are not announced; they are
on the dashboard already.

### WhatsApp, for free

The official WhatsApp Business API is a paid service and is **not** used. The
alert uses CallMeBot, a free service that sends WhatsApp messages to **your own
number only**:

1. On the admin's phone, save the contact number shown on
   https://www.callmebot.com/blog/free-api-whatsapp-messages/ and send it the
   message given on that page.
2. It replies with an API key.
3. Add two repository secrets: `CALLMEBOT_PHONE` (the admin's number with its
   country code, e.g. `+9665XXXXXXXX`) and `CALLMEBOT_APIKEY` (the key).

Leave them out and WhatsApp is simply skipped; email and push carry on. CallMeBot
is run by a third party with no service guarantee, so treat it as a convenience,
not the only alert.

## Running it without a laptop

The service polls Firestore and sends what it finds. Nothing about it needs to
be on any particular machine, and a laptop that is closed most of the time is
the wrong machine: notifications and confirmation emails sit in the queue until
it wakes up.

`.github/workflows/notifications.yml` runs the same script on GitHub's machines
every half hour. It is free, needs no card, and needs no server.

### What still works when nothing is running at all

The website and the installed app, sign-in, registration, browsing, booking, the
in-app notification list and its unread badge, and Firebase's own password reset
email. All of those are Firebase Hosting and Firestore, which are always up.

What waits for the service is only outbound delivery: device push, booking
confirmation emails, admin-minted reset links and admin-set passwords.

### Setting it up

1. Create a **private** repository on GitHub and push this project to it. The
   credentials are already excluded — `.env` and `*serviceAccount*.json` are in
   `.gitignore` and have never been committed. Check `git status` shows neither
   before you push.
2. In the repository, open **Settings → Secrets and variables → Actions** and
   add:

   | Secret | Value |
   | --- | --- |
   | `FIREBASE_SERVICE_ACCOUNT` | the whole contents of `serviceAccount.json` |
   | `VAPID_PRIVATE_KEY` | from `.env` |
   | `VAPID_PUBLIC_KEY` | the `EXPO_PUBLIC_VAPID_PUBLIC_KEY` from `.env` |
   | `VAPID_SUBJECT` | from `.env` |
   | `PASSWORD_PRIVATE_KEY` | from `.env`, if admin-set passwords are in use |
   | `SMTP_HOST` `SMTP_PORT` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | only if confirmation email is wanted |
   | `ADMIN_ALERT_EMAIL` | optional: extra addresses for new-registration alerts, comma-separated |
   | `CALLMEBOT_PHONE` `CALLMEBOT_APIKEY` | optional: free WhatsApp alert to the admin's own phone |

3. Open the **Actions** tab, choose **Notifications**, and press **Run
   workflow**. It should finish in well under a minute and print either
   "Nothing waiting" or a list of what it delivered.

Anything left out simply switches that part off. No `SMTP_*` means no email and
everything else still runs; no `PASSWORD_PRIVATE_KEY` means admin-set passwords
are not applied.

### Why every half hour and not every five minutes

A private repository gets 2,000 free Actions minutes a month, and **every run is
billed as a whole minute** however briefly it actually runs. Half-hourly is
1,440 a month and fits. Quarter-hourly is 2,880 and does not.

GitHub's scheduler is also best effort — a run can arrive several minutes late,
particularly on the hour, and no setting makes it punctual.

So the honest expectation is: a push arrives within about half an hour, usually
sooner. If that is too slow, the options are a public repository (unlimited
minutes, but the code becomes readable by anyone) or a paid always-on host.

### Running both at once is safe

The laptop service can stay installed. When it is awake it polls every thirty
seconds and will almost always get there first; when it is closed the scheduled
job covers.

Neither can send the same thing twice. Both **claim** a notification in a
Firestore transaction before sending it — whoever writes `pushedAt` first owns
it and the other skips. Booking confirmation emails claim
`confirmationEmailedAt` the same way. The trade is deliberate: a crash between
claiming and sending loses that one push rather than duplicating it, and the
message is in the app's notification list either way.
