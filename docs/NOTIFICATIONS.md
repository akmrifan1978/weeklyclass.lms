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
