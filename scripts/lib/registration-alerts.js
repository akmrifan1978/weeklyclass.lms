/**
 * New registrations waiting for approval, told to the admins.
 *
 * Runs inside the delivery job, which GitHub starts every five minutes, so it
 * needs nobody's laptop to be switched on. (While the admin panel is open, the
 * app itself announces a registration the moment it arrives — see
 * AdminLiveAlerts.)
 *
 * ONCE PER REGISTRATION, PER CHANNEL. What has been sent is recorded in
 * `registrationAlerts/{uid}`, and each channel is claimed in a transaction
 * BEFORE it is sent, exactly as the push queue is. A crash between claiming and
 * sending therefore loses that one alert rather than doubling it — a duplicate
 * is the failure people complain about, and the registration is still waiting
 * on the dashboard either way. A send that is refused outright (bad email
 * password, say) was never delivered, so it is released and tried again on the
 * next run, up to MAX_ATTEMPTS.
 *
 * CHANNELS, all free:
 *   email     — the SMTP settings the booking emails already use (a Gmail
 *               address with an app password costs nothing)
 *   push      — the admins' own phones and computers, through the push
 *               subscriptions the app already registers
 *   whatsapp  — CallMeBot, a free service that sends WhatsApp messages to YOUR
 *               OWN number. Off unless CALLMEBOT_PHONE and CALLMEBOT_APIKEY are
 *               set. The key is issued to that phone after it messages the
 *               CallMeBot contact, so it can only ever message the admin who set
 *               it up. It is not the paid WhatsApp Business API.
 */

const ALERTS = 'registrationAlerts';
/** An older registration is on the dashboard already; announcing it now is noise. */
const MAX_AGE_DAYS = 7;
const MAX_ATTEMPTS = 5;
const SYNTHETIC_DOMAIN = '@mobile.weeklyclass.app';

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/** "+966 0567560387", the way the app shows it. */
function phoneOf(user) {
  const mobile = String(user.mobile || '').trim();
  if (!mobile) return '';
  if (/^(\+|00)/.test(mobile)) return mobile;
  return `${user.mobileCountryCode || '+966'} ${mobile}`;
}

function registeredAt(user) {
  const date = user.createdAt && user.createdAt.toDate ? user.createdAt.toDate() : null;
  if (!date) return '';
  const when = date.toLocaleString('en-GB', {
    timeZone: 'Asia/Riyadh',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return `${when} (Saudi time)`;
}

function alertMessage(user, className, appUrl) {
  const name = user.fullName || 'Somebody';
  const email = String(user.email || '');
  const rows = [
    ['Name', name],
    ['Role', user.role === 'teacher' ? 'Teacher' : 'Student'],
    ['Mobile', phoneOf(user)],
    ['Email', email && !email.endsWith(SYNTHETIC_DOMAIN) ? email : ''],
    ['Class', className],
    ['Registered', registeredAt(user)],
  ].filter(([, value]) => value);
  const link = `${String(appUrl).replace(/\/$/, '')}/users`;

  return {
    subject: `New registration waiting for approval: ${name}`,
    short: `WeeklyClass: ${name} registered and is waiting for approval. ${link}`,
    text: [
      `${name} has registered and is waiting for approval.`,
      '',
      ...rows.map(([label, value]) => `${label}: ${value}`),
      '',
      `Approve or decline: ${link}`,
    ].join('\n'),
    html:
      `<p><strong>${escapeHtml(name)}</strong> has registered and is waiting for approval.</p>` +
      `<table cellpadding="4" style="border-collapse:collapse">${rows
        .map(
          ([label, value]) =>
            `<tr><td style="color:#667">${escapeHtml(label)}</td><td>${escapeHtml(value)}</td></tr>`
        )
        .join('')}</table>` +
      `<p><a href="${escapeHtml(link)}">Open the admin panel to approve or decline</a></p>`,
  };
}

/**
 * Takes each wanted channel that has not been sent, and has not run out of
 * attempts, in one transaction. Returns the channels this run now owns.
 */
async function claim(db, ref, uid, name, wanted) {
  return db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    const done = fresh.exists ? fresh.data() : {};
    const now = new Date();
    const taken = {};
    const owned = [];
    for (const channel of wanted) {
      if (done[`${channel}At`]) continue;
      const attempts = done[`${channel}Attempts`] || 0;
      if (attempts >= MAX_ATTEMPTS) continue;
      taken[`${channel}At`] = now;
      taken[`${channel}Attempts`] = attempts + 1;
      owned.push(channel);
    }
    if (owned.length) {
      tx.set(
        ref,
        { uid, fullName: name, ...taken, ...(fresh.exists ? {} : { firstSeenAt: now }) },
        { merge: true }
      );
    }
    return owned;
  });
}

/** Never delivered, so safe to try again next run. */
async function release(ref, channel, error) {
  const { FieldValue } = require('firebase-admin/firestore');
  await ref.set(
    {
      [`${channel}At`]: FieldValue.delete(),
      [`${channel}Error`]: String((error && error.message) || error).slice(0, 300),
    },
    { merge: true }
  );
}

async function pushToAdmins(webpush, subscriptions, uid, message) {
  const payload = JSON.stringify({
    title: 'New registration',
    body: message.subject.replace('New registration waiting for approval: ', '') + ' is waiting for approval',
    route: '/users',
    id: `registration-${uid}`,
    tag: `registration:${uid}`,
    timestamp: Date.now(),
  });

  let delivered = 0;
  let realErrors = 0;
  for (const sub of subscriptions) {
    const row = sub.data();
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload,
        { TTL: 60 * 60 * 24 }
      );
      delivered += 1;
    } catch (error) {
      const status = error && error.statusCode;
      if (status === 404 || status === 410) {
        // That browser is gone for good; retired, as the push queue does.
        await sub.ref.update({ deleted: true, retiredAt: new Date() }).catch(() => undefined);
      } else {
        realErrors += 1;
      }
    }
  }
  if (delivered === 0 && realErrors > 0) throw new Error('no admin device accepted the push');
}

async function whatsappToAdmin(whatsapp, message) {
  const url =
    'https://api.callmebot.com/whatsapp.php' +
    `?phone=${encodeURIComponent(whatsapp.phone)}` +
    `&text=${encodeURIComponent(message.short)}` +
    `&apikey=${encodeURIComponent(whatsapp.key)}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`CallMeBot answered ${response.status}`);
}

async function sendRegistrationAlerts({
  db,
  webpush,
  transport,
  from,
  env = process.env,
  appUrl = env.APP_URL || 'https://weeklyclass-lms.web.app',
}) {
  const snap = await db.collection('users').where('status', '==', 'pending').limit(50).get();
  const cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  const pending = snap.docs.filter((doc) => {
    const user = doc.data();
    if (user.deleted === true) return false;
    const created = user.createdAt && user.createdAt.toDate ? user.createdAt.toDate().getTime() : Date.now();
    return created >= cutoff;
  });
  if (pending.length === 0) return 0;

  const adminSnap = await db.collection('users').where('role', '==', 'admin').get();
  const admins = adminSnap.docs
    .map((doc) => doc.data())
    .filter((admin) => admin.deleted !== true && String(admin.status || '').toLowerCase() === 'active');

  const emails = [
    ...new Set(
      [...admins.map((admin) => admin.email), ...String(env.ADMIN_ALERT_EMAIL || '').split(',')]
        .map((address) => String(address || '').trim().toLowerCase())
        .filter((address) => address.includes('@') && !address.endsWith(SYNTHETIC_DOMAIN))
    ),
  ];

  const subscriptions = webpush
    ? (
        await db
          .collection('pushSubscriptions')
          .where('deleted', '==', false)
          .where('role', '==', 'admin')
          .get()
      ).docs
    : [];

  const whatsapp =
    env.CALLMEBOT_PHONE && env.CALLMEBOT_APIKEY
      ? { phone: env.CALLMEBOT_PHONE, key: env.CALLMEBOT_APIKEY }
      : null;

  const wanted = [];
  if (transport && emails.length) wanted.push('email');
  if (subscriptions.length) wanted.push('push');
  if (whatsapp) wanted.push('whatsapp');

  if (wanted.length === 0) {
    console.log(`  ${pending.length} registration(s) waiting — no alert channel is set up yet`);
    return 0;
  }

  let sent = 0;
  for (const doc of pending) {
    const user = doc.data();
    const ref = db.collection(ALERTS).doc(doc.id);
    const channels = await claim(db, ref, doc.id, user.fullName || '', wanted);
    if (channels.length === 0) continue;

    const className = user.classId
      ? await db
          .collection('classes')
          .doc(user.classId)
          .get()
          .then((snapshot) => (snapshot.exists ? snapshot.data().name || '' : ''))
          .catch(() => '')
      : '';
    const message = alertMessage(user, className, appUrl);

    for (const channel of channels) {
      try {
        if (channel === 'email') {
          await transport.sendMail({
            from,
            to: emails.join(', '),
            subject: message.subject,
            text: message.text,
            html: message.html,
          });
        } else if (channel === 'push') {
          await pushToAdmins(webpush, subscriptions, doc.id, message);
        } else if (channel === 'whatsapp') {
          await whatsappToAdmin(whatsapp, message);
        }
        sent += 1;
        console.log(`  registration alert by ${channel}: ${user.fullName || doc.id}`);
      } catch (error) {
        console.warn(`  ! registration alert by ${channel} failed: ${(error && error.message) || error}`);
        await release(ref, channel, error).catch(() => undefined);
      }
    }
  }
  return sent;
}

module.exports = { sendRegistrationAlerts, alertMessage };
