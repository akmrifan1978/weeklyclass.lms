import { deleteDoc, doc, runTransaction, serverTimestamp } from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS, PUBLIC_SITE_URL } from '@/constants/app';
import { AppError } from '@/utils/errors';
import type {
  AgeGroup,
  AppUser,
  CalendarEvent,
  EventParticipant,
  EventRegistration,
  EventRegistrationSettings,
  Gender,
  PromoCode,
  PublicTicket,
} from '@/types';
import * as promo from './promoCodeService';

import { forgetCollection, getById, listPage, setDocById, updateDocById, type Page } from './firestore';

/**
 * Seats change inside transactions, which do not pass through the write helpers
 * that clear the query cache - so the lists that show how many are left are
 * told to forget here instead.
 */
function forgetBookings(): void {
  forgetCollection(COLLECTIONS.eventRegistrations);
  forgetCollection(COLLECTIONS.calendarEvents);
}
import { getSettings } from './settingsService';
import * as audit from './auditService';
import { formatPhone } from '@/utils/phone';
import {
  netReceivedOn,
  outstandingOn,
  paymentStateOf,
  receivedOn,
  refundedOn,
  type PaymentState,
} from '@/utils/bookingMoney';

/**
 * Booking a place at an event.
 *
 * The seat count is the whole difficulty here. Two people booking the last two
 * seats at the same moment must not both succeed, and a count kept by reading
 * then writing would let them. So a booking is a transaction that re-reads the
 * event, checks the remaining seats and writes both the booking and the new
 * count together — the only place `registeredCount` is ever changed.
 */

export interface RegistrationQuery {
  eventId?: string;
  userId?: string;
  pageSize?: number;
}

export function listRegistrations(
  options: RegistrationQuery = {}
): Promise<Page<EventRegistration>> {
  return listPage<EventRegistration>(COLLECTIONS.eventRegistrations, {
    filters: [
      options.eventId ? ['eventId', '==', options.eventId] : null,
      options.userId ? ['userId', '==', options.userId] : null,
    ],
    orderByField: 'createdAt',
    direction: 'desc',
    pageSize: options.pageSize ?? 200,
  });
}

/**
 * What one person of this age is charged.
 *
 * A band with no price of its own falls back to the event's base price, so an
 * organiser who only wants infants free sets that single number rather than
 * four. Returning the base price for an unknown band is the safe direction: it
 * charges rather than silently admitting someone free.
 */
export function priceFor(
  settings: EventRegistrationSettings,
  ageGroup: AgeGroup
): number {
  const banded = settings.pricesByAgeGroup?.[ageGroup];
  return typeof banded === 'number' ? banded : (settings.price ?? 0);
}

/** The total for a party, at the prices in force now. */
export function quote(
  settings: EventRegistrationSettings,
  participants: { ageGroup: AgeGroup }[]
): number {
  return participants.reduce((sum, p) => sum + priceFor(settings, p.ageGroup), 0);
}

/**
 * The code printed on the ticket.
 *
 * Derived from the booking id rather than stored, so it needs no second write
 * and no uniqueness check: the id is already unique, and the same booking
 * therefore always shows the same code — on the holder's phone, on the door
 * list, and on the exported sheet.
 *
 * Six characters from a 32-symbol alphabet with the letters that read as digits
 * left out, because this gets copied by hand and I/O/0/1 are where that goes
 * wrong.
 */
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function ticketCode(registrationId: string): string {
  // FNV-1a. Not for security — only to spread ids that share a long prefix,
  // which every booking for the same event does.
  let hash = 0x811c9dc5;
  for (let i = 0; i < registrationId.length; i += 1) {
    hash ^= registrationId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += CODE_ALPHABET[hash % CODE_ALPHABET.length];
    hash = Math.floor(hash / CODE_ALPHABET.length) + Math.imul(hash, 31);
    hash >>>= 0;
  }
  return code;
}

/** Seats left, or null when the event has no cap. */
export function seatsRemaining(event: CalendarEvent): number | null {
  const capacity = event.registration?.capacity ?? null;
  if (capacity == null) return null;
  return Math.max(0, capacity - (event.registeredCount ?? 0));
}

export function isFull(event: CalendarEvent): boolean {
  const left = seatsRemaining(event);
  return left !== null && left <= 0;
}

/** True when this person can book right now, with the reason if not. */
export function bookingBlockedReason(
  event: CalendarEvent,
  existing: EventRegistration | null
): string | null {
  const registration = event.registration;
  if (!registration) return 'event.notBookable';
  if (registration.status === 'openingSoon') return 'event.openingSoon';
  if (registration.status === 'closed') return 'event.registrationClosed';
  // A rejected request is finished, and asking again with the same button would
  // just overwrite the organiser's answer.
  if (existing && existing.status === 'rejected') return 'event.bookingRejected';
  if (existing && existing.status !== 'cancelled') return 'event.alreadyBooked';
  // Being full is deliberately NOT a block. It changes what the button means —
  // joining a waiting list rather than taking a seat — and the screen says so.
  return null;
}

/** True when a booking made right now would have to wait for the organiser. */
export function wouldWaitlist(event: CalendarEvent): boolean {
  return isFull(event);
}

/**
 * Books seats, atomically.
 *
 * The capacity check happens inside the transaction against a fresh read, not
 * against whatever the screen was showing — which may be a minute old and two
 * bookings out of date.
 */
export async function book(
  event: CalendarEvent,
  party: { name: string; gender: EventParticipant['gender']; ageGroup: AgeGroup }[],
  user: AppUser,
  reference?: string | null,
  /**
   * A code that admits this party free, if the organiser issued one.
   *
   * Checked here rather than trusted from the screen, and checked again by
   * the security rules on the write — the form's verdict is a courtesy to the
   * person typing, not an authority on what they owe.
   */
  promoCode?: string | null
): Promise<string> {
  const named = party.filter((p) => p.name.trim().length > 0);
  if (named.length < 1) throw new AppError('event.seatsRequired', 'invalid-argument');
  const seats = named.length;

  const registration = event.registration;
  if (!registration || registration.status !== 'open') {
    throw new AppError('event.registrationClosed', 'failed-precondition');
  }

  // One booking per person per event, so the id is derived rather than random.
  // A double tap then writes the same document twice instead of taking two
  // seats, which is the failure this shape makes impossible.
  //
  // The cost of that choice: booking again after cancelling writes over the
  // same document, which Firestore sees as an update rather than a create. The
  // rules allow it explicitly for a cancelled or declined booking — see the
  // eventRegistrations block — because otherwise cancelling once would lock
  // somebody out of the event for good.
  const registrationId = `${event.id}_${user.uid}`;
  const eventRef = doc(db, COLLECTIONS.calendarEvents, event.id);
  const bookingRef = doc(db, COLLECTIONS.eventRegistrations, registrationId);

  // Read before the transaction, not inside it: a transaction may be retried,
  // and a settings read is neither part of the contention nor cheap to repeat.
  const appSettings = await getSettings().catch(() => null);
  const requireApproval = appSettings?.requireBookingApproval === true;

  /*
   * The promo code, read and judged before the transaction for the same
   * reason, and REFUSED LOUDLY rather than ignored.
   *
   * A code that has expired or run out must not quietly charge full price: the
   * person typed it because they believe they have a free place, and silently
   * billing them is how an argument starts at the door. They are told what is
   * wrong with it and can book without it.
   */
  const typedCode = promo.normaliseCode(promoCode ?? '');
  let redeemed: PromoCode | null = null;
  if (typedCode) {
    const verdict = promo.check(await promo.lookup(typedCode), event);
    if (!verdict.ok) throw new AppError(verdict.reason ?? 'promo.notFound', 'failed-precondition');
    redeemed = verdict.promo ?? null;
  }

  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(eventRef);
    if (!fresh.exists()) throw new AppError('errors.notFound', 'not-found');

    const current = fresh.data() as CalendarEvent;
    const taken = current.registeredCount ?? 0;
    const capacity = current.registration?.capacity ?? null;

    const existing = await tx.get(bookingRef);
    const alreadyBooked =
      existing.exists() && (existing.data() as EventRegistration).status !== 'cancelled';
    if (alreadyBooked) throw new AppError('event.alreadyBooked', 'already-exists');

    // Being full is no longer a refusal. Somebody who wants a place they cannot
    // have should be able to ask for one, and the organiser decides — a hard
    // error at this point simply lost the request and told nobody about it.
    const roomFor = capacity == null || taken + seats <= capacity;

    // Priced against the event as it is NOW, not as the screen last saw it.
    // Someone sitting on the booking sheet while the organiser changes the
    // price should be charged what is actually being asked.
    const settings = current.registration!;
    const participants: EventParticipant[] = named.map((p) => ({
      name: p.name.trim(),
      gender: p.gender,
      ageGroup: p.ageGroup,
      price: priceFor(settings, p.ageGroup),
    }));
    /*
     * The code makes the place free, and says so on every line.
     *
     * Each participant's price goes to zero as well as the total, because the
     * attendee sheet is printed per person and a row showing 30 SAR under a
     * booking that owes nothing is a contradiction somebody has to resolve at
     * the door. The event's own prices are untouched — this is one party
     * admitted free, not a price change.
     */
    const priced = participants.reduce((sum, p) => sum + p.price, 0);
    const amount = redeemed ? 0 : priced;
    const finalParticipants = redeemed
      ? participants.map((p) => ({ ...p, price: 0 }))
      : participants;

    tx.set(bookingRef, {
      eventId: event.id,
      eventTitle: event.title,
      userId: user.uid,
      userName: user.fullName,
      userMobile: user.mobile ? formatPhone(user.mobile, user.mobileCountryCode) : null,
      userEmail: user.email ?? null,
      participants: finalParticipants,
      seats,
      // Frozen at booking time. A price raised next week must not silently
      // change what someone already agreed to pay.
      amount,
      currency: settings.currency ?? '',
      reference: reference?.trim() || null,
      // Recorded on the booking so the organiser can see WHY this party owes
      // nothing, and what it would have cost — a free place that leaves no
      // trace is indistinguishable from a mistake.
      promoCode: redeemed ? redeemed.code : null,
      promoWaived: redeemed ? priced : 0,
      // Availability decides, and it is decided HERE — inside the transaction,
      // against a count re-read a moment ago, not against whatever the screen
      // was showing when the button was pressed.
      //
      // Room means the place is theirs and the ticket exists immediately. No
      // room means the request stands as pending for the organiser to accept or
      // decline; it is a waiting list, not a rejection, and not a silent loss.
      //
      // An organiser who wants to see every booking before it counts turns
      // `requireBookingApproval` on, and then nothing self-confirms.
      /*
       * Self-confirming still stops short of a ticket when there is a price.
       *
       * With approval switched off a booking with room used to become
       * confirmed outright, which handed a valid QR code to somebody who had
       * paid nothing - the same hole approval was added to close, left open
       * whenever an organiser turned approval off. A free event is unaffected.
       */
      status:
        requireApproval || !roomFor
          ? 'pending'
          : amount > 0
            ? 'awaitingPayment'
            : 'confirmed',
      paid: false,
      // Null, not absent: this is the queue the mail service reads, and a
      // missing field is not something Firestore can filter on.
      confirmationEmailedAt: null,
      deleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: user.uid,
    });

    // Only a confirmed booking occupies seats. Counting a waitlisted request
    // would push the event further past its own capacity and make the next
    // reader's "places left" a lie.
    if (!requireApproval && roomFor) {
      tx.update(eventRef, { registeredCount: taken + seats });
    }
  });
  forgetBookings();
  await refreshPublicTicket(registrationId);

  /*
   * Count the redemption AFTER the booking exists, and never let it undo one.
   *
   * Counting first would spend a use on a booking that then failed, and a
   * code limited to five would quietly admit four. Counting after can in
   * theory let two people redeem the last use at the same moment — a race
   * worth one free place at most, which is the cheaper of the two mistakes
   * for a centre inviting guests. A failure here is swallowed for the same
   * reason: the place has been given, and throwing now would tell the person
   * their booking failed when it did not.
   */
  if (redeemed) {
    await updateDocById<PromoCode>(COLLECTIONS.promoCodes, redeemed.code, {
      usedCount: (redeemed.usedCount ?? 0) + 1,
    }).catch(() => undefined);
  }

  await audit
    .log({
      actor: user,
      action: 'CREATE',
      collection: COLLECTIONS.eventRegistrations,
      documentId: registrationId,
      summary: `${user.fullName} booked ${named.length} place(s) for "${event.title}"`,
    })
    .catch(() => undefined);

  return registrationId;
}

/**
 * Confirms a booking, which is what turns it into a ticket.
 *
 * No transaction: the seats were taken when the booking was made, so confirming
 * changes nothing that two people could race over. It is a decision being
 * recorded, not a resource being allocated.
 */
export async function confirmBooking(
  registration: EventRegistration,
  actor: AppUser
): Promise<void> {
  if (registration.status === 'cancelled') {
    throw new AppError('event.cannotConfirmCancelled', 'failed-precondition');
  }
  if (registration.status === 'confirmed') return;

  /**
   * Is the money already in?
   *
   * Read through `outstandingOn`, so a deposit counts for what it is: a
   * booking half paid is still awaiting payment, and only one settled in full
   * becomes a ticket on approval. A free event owes nothing and so settles
   * trivially, which is the behaviour it already had.
   */
  const settledAlready = outstandingOn(registration) <= 0;

  // A transaction, because confirming is the moment the seats are actually
  // taken. Between the organiser opening this list and pressing the button,
  // other people have been booking — so availability is checked again here,
  // against a fresh read, and the count moves in the same write.
  const eventRef = doc(db, COLLECTIONS.calendarEvents, registration.eventId);
  const bookingRef = doc(db, COLLECTIONS.eventRegistrations, registration.id);

  // Read inside the transaction and used after it: the event is already being
  // fetched there, and a second read afterwards could see a different one.
  let whatsappLink: string | null = null;

  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(eventRef);
    if (!fresh.exists()) throw new AppError('errors.notFound', 'not-found');

    const current = fresh.data() as CalendarEvent;
    const taken = current.registeredCount ?? 0;
    const capacity = current.registration?.capacity ?? null;
    whatsappLink = current.registration?.whatsappLink ?? null;

    // Refused rather than silently oversold. An organiser who genuinely wants
    // to go over capacity raises the capacity, which is a decision with a
    // number attached rather than a side effect of a button.
    if (capacity != null && taken + registration.seats > capacity) {
      throw new AppError('event.notEnoughSeats', 'failed-precondition');
    }

    tx.update(bookingRef, {
      /*
       * Approved is not confirmed. The seats are held from this moment, but a
       * paid event waits for the money before it becomes a ticket - see
       * BookingStatus. A free event has nothing to wait for.
       *
       * AND NEITHER DOES ONE ALREADY PAID FOR. An organiser is as likely to
       * take the money first and approve afterwards - somebody pays at the
       * desk, then the booking is let in - and this used to send that booking
       * to "awaiting payment" for money already in hand. The ticket could then
       * never be issued: approval had happened, payment had happened, and the
       * one state that produces a ticket was unreachable from there. Asking
       * what is still owed rather than what the event costs answers both
       * orders the same way.
       */
      status: settledAlready ? 'confirmed' : Number(registration.amount) > 0 ? 'awaitingPayment' : 'confirmed',
      // Re-queued on confirmation, which also picks up bookings made before
      // the field existed.
      confirmationEmailedAt: null,
      confirmedAt: serverTimestamp(),
      confirmedBy: actor.uid,
      updatedAt: serverTimestamp(),
    });
    tx.update(eventRef, { registeredCount: taken + registration.seats });
  });
  forgetBookings();
  await refreshPublicTicket(registration.id);

  // The ticket is worthless if nobody knows it exists. Best effort: a
  // notification that fails to send must not undo a confirmation that already
  // happened, so the admin is not told it failed either — the booking is
  // confirmed, which is what they asked for.
  // The group link rides along with the confirmation, because the moment
  // somebody learns they have a place is the moment they will join. Left unset
  // by the organiser, the sentence is simply absent — no empty heading, no
  // dead link.
  const joinLine = whatsappLink ? ` Join the event's WhatsApp group: ${whatsappLink}` : '';

  // What is STILL owed, not what the event costs: a booking already paid for
  // must not be told its ticket is waiting on money that has arrived.
  const owing = !settledAlready;

  await notify(
    registration,
    actor,
    owing ? 'Booking approved' : 'Booking confirmed',
    owing
      ? `Your place at "${registration.eventTitle}" is approved and your seats are held. ` +
        `Your ticket is issued once the payment of ${registration.amount} ` +
        `${registration.currency} is received.${joinLine}`
      : `Your place at "${registration.eventTitle}" is confirmed. Ticket ${ticketCode(
          registration.id
        )}.${joinLine}`
  );

  void audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.eventRegistrations,
    documentId: registration.id,
    summary: `Confirmed ${registration.userName}'s booking for "${registration.eventTitle}"`,
  });
}

/**
 * Cancels a booking and returns the seats.
 *
 * The booking is marked cancelled rather than deleted: an admin reconciling
 * payments needs to see that somebody booked and pulled out, which a deleted
 * row cannot tell them.
 */
export async function cancel(
  registration: EventRegistration,
  actor: AppUser,
  /**
   * Money handed back as part of the cancellation, if any.
   *
   * IN THE SAME WRITE AS THE CANCELLATION, and it has to be: the rules refuse
   * every later change to a cancelled booking, on purpose, so a refund
   * recorded afterwards would be rejected and the event would keep reporting
   * income for a seat nobody used. Undefined means no money changes hands —
   * a booking nobody had paid for, or one the centre is not refunding.
   */
  refund?: number
): Promise<void> {
  const eventRef = doc(db, COLLECTIONS.calendarEvents, registration.eventId);
  const bookingRef = doc(db, COLLECTIONS.eventRegistrations, registration.id);
  /**
   * Set inside the transaction, from the document as it really is.
   *
   * It used to be clamped against the copy the screen was holding, which can
   * be minutes old. An organiser who corrected a payment to zero and then
   * cancelled had 120 refunded against a booking showing nothing received —
   * leaving the event reporting MINUS 120 of income, money that had gone out
   * without ever having come in.
   */
  let given = 0;

  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(eventRef);
    const booking = await tx.get(bookingRef);
    if (!booking.exists()) return;
    const live = booking.data() as EventRegistration;
    const before = live.status;
    if (before === 'cancelled') return;

    // Against the document, not the screen's copy of it.
    given = Math.max(0, Math.min(Number(refund) || 0, receivedOn(live)));

    tx.update(bookingRef, {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
      ...(given > 0 ? { refundedAmount: given, refundedAt: serverTimestamp() } : {}),
    });

    /*
     * Every booking that was HOLDING seats gives them back.
     *
     * This used to release them only from `confirmed`, which was true when
     * confirming was the step that took them. It is not any more: approval
     * takes the seats and leaves the booking at `awaitingPayment` until the
     * money arrives. So a booking approved and then cancelled kept its seats
     * for ever — an event filling up with places nobody holds, and a "places
     * left" that only ever falls. A pending request still releases nothing,
     * because it was never given anything.
     *
     * The seat count comes from the fresh event read, and the seat NUMBER
     * from the booking as it stands, not from the copy passed in.
     */
    const heldSeats = before === 'confirmed' || before === 'awaitingPayment';
    if (fresh.exists() && heldSeats) {
      const taken = (fresh.data() as CalendarEvent).registeredCount ?? 0;
      // Clamped at zero: a count that has drifted must not be driven negative
      // by a cancellation, which would then let the event oversell.
      tx.update(eventRef, { registeredCount: Math.max(0, taken - (Number(live.seats) || 0)) });
    }
  });
  forgetBookings();
  await refreshPublicTicket(registration.id);

  // Only when somebody else cancelled it. A person who cancels their own
  // booking does not need to be told they did.
  if (actor.uid !== registration.userId) {
    await notify(
      registration,
      actor,
      'Booking cancelled',
      given > 0
        ? `Your booking for "${registration.eventTitle}" has been cancelled and ${given} ${registration.currency} is being refunded.`
        : `Your booking for "${registration.eventTitle}" has been cancelled by the organisers.`
    );
  }

  void audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.eventRegistrations,
    documentId: registration.id,
    summary:
      given > 0
        ? `Cancelled ${registration.userName}'s booking for "${registration.eventTitle}" and refunded ${given} ${registration.currency}`
        : `Cancelled ${registration.userName}'s booking for "${registration.eventTitle}"`,
  });
}

/**
 * Declines a pending request.
 *
 * Distinct from cancelling. Nothing is released, because a waitlisted request
 * was never holding anything — this is an answer, and the person is told they
 * have one so they are not left watching a list forever.
 */
export async function rejectBooking(
  registration: EventRegistration,
  actor: AppUser,
  reason?: string
): Promise<void> {
  if (registration.status === 'confirmed') {
    // Taking a place back is a cancellation, and it has to release the seat.
    // Routing it through here would leave the count holding a seat nobody has.
    throw new AppError('event.cannotRejectConfirmed', 'failed-precondition');
  }

  await updateDocById<EventRegistration>(COLLECTIONS.eventRegistrations, registration.id, {
    status: 'rejected',
    rejectedAt: serverTimestamp(),
    rejectedBy: actor.uid,
    rejectionReason: reason?.trim() || null,
  });

  await notify(
    registration,
    actor,
    'Booking not accepted',
    reason?.trim()
      ? `Your request for "${registration.eventTitle}" was not accepted: ${reason.trim()}`
      : `Your request for "${registration.eventTitle}" was not accepted. The event may be full.`
  );

  void audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.eventRegistrations,
    documentId: registration.id,
    summary: `Rejected ${registration.userName}'s request for "${registration.eventTitle}"`,
  });
}

/** Tells the booker what just happened to their booking. Never throws. */
async function notify(
  registration: EventRegistration,
  actor: AppUser,
  title: string,
  message: string
): Promise<void> {
  try {
    const notifications = await import('./notificationService');
    await notifications.send(
      {
        title,
        message,
        category: 'event_reminder',
        targetRole: 'user',
        userId: registration.userId,
      },
      actor
    );
  } catch {
    // Swallowed on purpose — see the call sites.
  }
}

/**
 * Where a scanned ticket leads.
 *
 * The origin is taken from the page the ticket was opened on, so a ticket
 * shown from the live site links to the live site and one shown from a test
 * build links to that. Native has no such page, and falls back to the address
 * the app is published at.
 */
export function ticketUrl(code: string): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : PUBLIC_SITE_URL;
  return `${origin}/ticket/${code}`;
}

/** "Mohamed Rifan" -> "Mohamed R." Enough to match a face, not a directory. */
function holderName(fullName: string): string {
  const parts = String(fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/**
 * Publishes the thin copy a scan reads, and keeps it true.
 *
 * Called after every change that alters what the door should be told:
 * booking, confirming, cancelling, declining, and marking paid. Best effort -
 * a booking that saved but whose public copy did not is a ticket that still
 * works at the door by its printed code, and rolling the booking back over it
 * would be the worse outcome by a wide margin.
 */
export async function syncPublicTicket(registration: EventRegistration): Promise<void> {
  const event = await getById<CalendarEvent>(
    COLLECTIONS.calendarEvents,
    registration.eventId
  ).catch(() => null);

  await setDocById(
    COLLECTIONS.publicTickets,
    ticketCode(registration.id),
    {
      code: ticketCode(registration.id),
      registrationId: registration.id,
      eventTitle: registration.eventTitle,
      date: event?.date ?? null,
      startTime: event?.startTime ?? null,
      venue: event?.venue ?? event?.location ?? null,
      holder: holderName(registration.userName),
      seats: registration.seats,
      status: registration.status,
      paid: registration.paid === true,
    },
    { actorId: registration.userId }
  ).catch((error: unknown) => {
    console.warn('[WeeklyClass] booking saved, but its public ticket did not:', error);
  });
}

/** Re-reads a booking and republishes its public copy. */
async function refreshPublicTicket(registrationId: string): Promise<void> {
  const row = await getById<EventRegistration>(
    COLLECTIONS.eventRegistrations,
    registrationId
  ).catch(() => null);
  if (row) await syncPublicTicket(row);
}

/** What a scanned ticket shows. Readable by anybody holding the code. */
export function publicTicket(code: string): Promise<PublicTicket | null> {
  return getById<PublicTicket>(COLLECTIONS.publicTickets, String(code ?? '').toUpperCase());
}

/** Marks a booking as paid. Admin bookkeeping, not a payment gateway. */
/*
 * A booking's money is worked out in `@/utils/bookingMoney`, and re-exported
 * here so every existing caller keeps one import. It lives there because the
 * accounts need the same arithmetic, and neither service should have to load
 * the other to get it.
 */
export { receivedOn, refundedOn, netReceivedOn, outstandingOn, paymentStateOf };
export type { PaymentState };

/**
 * Records money received against a booking — all of it, or part.
 *
 * THE TICKET WAITS FOR THE WHOLE AMOUNT. A deposit is real money and is
 * recorded as such, but it does not open the door: the booking stays waiting
 * until the balance is in, and only then is the ticket issued and the person
 * told. Recording a part payment against a booking that had been settled in
 * full takes the ticket back out of use, which is what reversing a payment
 * means.
 *
 * A booking that was never approved is left where it is: paying does not jump
 * the queue, and a cancelled or declined one is not revived by it.
 */
export async function setPaidAmount(
  registration: EventRegistration,
  amount: number,
  actor: AppUser
): Promise<void> {
  const total = Number(registration.amount) || 0;
  // Clamped to the booking: an organiser mistyping 5000 for 500 should not
  // leave the event showing income it never took.
  const received = Math.max(0, Math.min(Number(amount) || 0, total));
  const settled = total > 0 ? received >= total : received > 0;

  const next: Partial<EventRegistration> = {
    paidAmount: received,
    paid: settled,
    // Dated at the moment it is recorded, since that is the only moment that
    // knows it. Cleared when a payment is reversed to nothing.
    paidAt: received > 0 ? new Date() : null,
  };

  if (settled && registration.status === 'awaitingPayment') {
    next.status = 'confirmed';
    next.confirmedAt = new Date();
    next.confirmedBy = actor.uid;
  } else if (!settled && registration.status === 'confirmed') {
    next.status = 'awaitingPayment';
  }

  await updateDocById<EventRegistration>(COLLECTIONS.eventRegistrations, registration.id, next);
  forgetBookings();
  await refreshPublicTicket(registration.id);

  if (next.status === 'confirmed') {
    await notify(
      registration,
      actor,
      'Ticket ready',
      `Payment received for "${registration.eventTitle}". Your ticket ${ticketCode(
        registration.id
      )} is ready - show its QR code at the entrance.`
    ).catch(() => undefined);
  } else if (received > 0 && !settled) {
    // Told, and told what is left. A person who paid a deposit and hears
    // nothing assumes they are done.
    await notify(
      registration,
      actor,
      'Part payment received',
      `${received} ${registration.currency} received for "${registration.eventTitle}". ${
        total - received
      } ${registration.currency} is still to pay, and the ticket follows once it is settled.`
    ).catch(() => undefined);
  }

  void audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.eventRegistrations,
    documentId: registration.id,
    summary: `Recorded ${received} of ${total} ${registration.currency} on ${registration.userName}'s booking`,
  });
}

/**
 * The old yes/no call, kept so nothing that used it has to change.
 *
 * Paid means the whole amount, unpaid means nothing received — which is
 * exactly what this function has always meant.
 */
export function setPaid(
  registration: EventRegistration,
  paid: boolean,
  actor: AppUser
): Promise<void> {
  return setPaidAmount(registration, paid ? Number(registration.amount) || 0 : 0, actor);
}

/**
 * Corrects a booking: who is coming, what band they are in, the reference.
 *
 * ADMIN ONLY, matching the rule. The alternative was deleting the booking and
 * asking the person to make it again, which throws away the payment record
 * and the ticket to fix a misspelt name.
 *
 * REPRICED FROM THE EVENT, not from what the screen believes. A party of five
 * becoming four pays four people's prices at the event's CURRENT bands, worked
 * out here the same way `book()` works them out, so an organiser cannot set a
 * price by typing one and the two paths cannot drift apart.
 *
 * The seat count moves by the difference, and only when this booking is
 * actually holding seats. Growing a booking is checked against capacity for
 * the same reason booking is: the hall does not get bigger because the edit
 * came from an admin.
 */
export async function updateBooking(
  registration: EventRegistration,
  party: { name: string; gender: Gender; ageGroup: AgeGroup }[],
  reference: string,
  actor: AppUser
): Promise<void> {
  const named = party.filter((p) => p.name.trim().length > 0);
  if (named.length === 0) throw new AppError('event.nobodyNamed', 'failed-precondition');

  const eventRef = doc(db, COLLECTIONS.calendarEvents, registration.eventId);
  const bookingRef = doc(db, COLLECTIONS.eventRegistrations, registration.id);

  await runTransaction(db, async (tx) => {
    const eventSnap = await tx.get(eventRef);
    const bookingSnap = await tx.get(bookingRef);
    if (!eventSnap.exists() || !bookingSnap.exists()) {
      throw new AppError('errors.notFound', 'not-found');
    }

    const event = eventSnap.data() as CalendarEvent;
    const live = bookingSnap.data() as EventRegistration;
    if (live.status === 'cancelled') {
      throw new AppError('event.cannotEditCancelled', 'failed-precondition');
    }

    const settings = event.registration;
    if (!settings) throw new AppError('event.notBookable', 'failed-precondition');

    const participants: EventParticipant[] = named.map((p) => ({
      name: p.name.trim(),
      gender: p.gender,
      ageGroup: p.ageGroup,
      price: priceFor(settings, p.ageGroup),
    }));
    const amount = participants.reduce((sum, p) => sum + p.price, 0);

    // Holding seats, so a change in party size changes the event's count.
    const holds = live.status === 'confirmed' || live.status === 'awaitingPayment';
    const delta = participants.length - (Number(live.seats) || 0);
    const taken = event.registeredCount ?? 0;
    const capacity = settings.capacity ?? null;

    if (holds && delta > 0 && capacity != null && taken + delta > capacity) {
      throw new AppError('event.notEnoughSeats', 'failed-precondition');
    }

    tx.update(bookingRef, {
      participants,
      seats: participants.length,
      amount,
      reference: reference.trim() || null,
      updatedAt: serverTimestamp(),
    });

    if (holds && delta !== 0) {
      tx.update(eventRef, { registeredCount: Math.max(0, taken + delta) });
    }
  });

  forgetBookings();
  forgetCollection(COLLECTIONS.calendarEvents);
  // The public copy carries the seat count a steward reads at the door.
  await refreshPublicTicket(registration.id);

  void audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.eventRegistrations,
    documentId: registration.id,
    summary: `Edited ${registration.userName}'s booking for "${registration.eventTitle}" (${named.length} place(s))`,
  });
}

/**
 * Removes ONE booking, for good.
 *
 * Admin only, like the bulk version, and offered for every status — a
 * cancelled booking has no other button on its row, so without this the only
 * way to clear one was to delete every booking on the event.
 *
 * Releases the seats if that booking was still holding them, which a
 * cancelled one is not: cancelling gave them back already, and taking them
 * off twice would let the event oversell.
 */
export async function deleteBooking(
  registration: EventRegistration,
  actor: AppUser
): Promise<void> {
  // The public copy first — a copy outliving its booking is a QR code that
  // still opens the door.
  await deleteDoc(doc(db, COLLECTIONS.publicTickets, ticketCode(registration.id))).catch(
    () => undefined
  );
  await deleteDoc(doc(db, COLLECTIONS.eventRegistrations, registration.id));

  if (registration.status === 'confirmed' || registration.status === 'awaitingPayment') {
    const event = await getById<CalendarEvent>(COLLECTIONS.calendarEvents, registration.eventId);
    if (event) {
      await updateDocById<CalendarEvent>(COLLECTIONS.calendarEvents, registration.eventId, {
        registeredCount: Math.max(0, (event.registeredCount ?? 0) - (registration.seats || 0)),
      } as Partial<CalendarEvent>);
    }
  }

  forgetBookings();
  forgetCollection(COLLECTIONS.calendarEvents);

  void audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.eventRegistrations,
    documentId: registration.id,
    summary: `Deleted ${registration.userName}'s booking for "${registration.eventTitle}"`,
  });
}

/**
 * Removes every booking for one event, for good.
 *
 * ADMIN ONLY, and the security rules agree: `allow delete: if isAdmin()`. This
 * is the one genuinely destructive action in the booking screens, and it is a
 * HARD delete rather than the soft one used everywhere else — partly because
 * the rules refuse to update a cancelled booking at all, so a soft delete
 * could not touch those, and partly because the thing it exists for is
 * clearing test bookings off a real event, where a row that is merely hidden
 * is not actually gone.
 *
 * WHAT IT TAKES WITH IT, deliberately:
 *   - the public ticket copies, because those are what a scanned QR reads. A
 *     deleted booking whose public copy survived would go on admitting people
 *     at the door, which is the worst possible leftover.
 *   - the event's seat count, reset to zero, since every seat those bookings
 *     held has just been given back.
 *
 * WHAT IT DESTROYS, which is why the screen asks twice: the record of money
 * received. An event's accounts read the bookings, so deleting them erases
 * what attendees paid. On an event with real payments that is a decision for
 * the person who took the money, not a tidy-up.
 */
export async function deleteAllForEvent(
  event: CalendarEvent,
  actor: AppUser
): Promise<number> {
  // Soft-deleted ones included: "all" has to mean all, or a second press
  // would find rows the first one left behind.
  const page = await listPage<EventRegistration>(COLLECTIONS.eventRegistrations, {
    filters: [['eventId', '==', event.id]],
    excludeDeleted: false,
    orderByField: 'createdAt',
    pageSize: 500,
  });

  for (const row of page.items) {
    // The copy first. If the run stops half way, a booking without its public
    // copy is a ticket that stops working — the safe direction — while a
    // public copy without its booking is one that still opens the door.
    await deleteDoc(doc(db, COLLECTIONS.publicTickets, ticketCode(row.id))).catch(
      () => undefined
    );
    await deleteDoc(doc(db, COLLECTIONS.eventRegistrations, row.id));
  }

  if (page.items.length > 0) {
    await updateDocById<CalendarEvent>(COLLECTIONS.calendarEvents, event.id, {
      registeredCount: 0,
    } as Partial<CalendarEvent>);
  }

  forgetBookings();
  forgetCollection(COLLECTIONS.calendarEvents);

  void audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.eventRegistrations,
    documentId: event.id,
    summary: `Deleted all ${page.items.length} booking(s) for "${event.title}"`,
  });

  return page.items.length;
}

/**
 * The bookings as CSV, for Excel.
 *
 * CSV rather than a real .xlsx because Excel opens it natively and it needs no
 * library — a spreadsheet writer would add a megabyte to the bundle to produce
 * a file that opens the same way.
 */
export function toCsv(rows: EventRegistration[]): string {
  // One row per PERSON, not per booking. An organiser printing a list at the
  // door needs every name; a row saying "Rifan, 4 seats" makes them ask who the
  // other three are.
  const header = [
    // Ticket and event lead, because this sheet is now also produced across
    // every event at once, where "which event is this row" is the first
    // question a reader has.
    'Ticket',
    'Event',
    'Booked by',
    'Mobile',
    'Email',
    'Reference',
    'Participant',
    'Gender',
    'Age group',
    'Price',
    'Currency',
    // Three columns where there was one. "Paid: No" was the same answer for a
    // family who had paid half and one who had paid nothing, and said nothing
    // at all about money handed back on a cancellation.
    'Payment',
    'Received',
    'Refunded',
    'Outstanding',
    'Status',
    'Booked at',
  ];

  // Quote everything and double any inner quote. A name with a comma in it
  // would otherwise split into two columns and shift the whole row.
  const escape = (value: unknown): string =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;

  const lines = rows.flatMap((row) => {
    // A booking made before participants were recorded has none; it still needs
    // a row, so it contributes one line naming the booker alone.
    const people: EventParticipant[] = row.participants?.length
      ? row.participants
      : [
          {
            name: row.userName,
            gender: 'male',
            ageGroup: 'adult',
            price: row.amount,
          },
        ];

    return people.map((person, index) =>
      [
        ticketCode(row.id),
        row.eventTitle,
        row.userName,
        // Contact details on the first line only, so a family reads as a block
        // rather than repeating the same number four times.
        index === 0 ? (row.userMobile ?? '') : '',
        index === 0 ? (row.userEmail ?? '') : '',
        index === 0 ? (row.reference ?? '') : '',
        person.name,
        person.gender,
        person.ageGroup,
        person.price,
        row.currency,
        // On the first line of a booking only, so a family reads as a block
        // rather than repeating one payment against every name.
        index === 0 ? paymentStateOf(row) : '',
        index === 0 ? receivedOn(row) : '',
        index === 0 ? refundedOn(row) || '' : '',
        index === 0 ? outstandingOn(row) : '',
        index === 0 ? row.status : '',
        index === 0 ? toDateString(row.createdAt) : '',
      ]
        .map(escape)
        .join(',')
    );
  });

  // A BOM, so Excel reads the file as UTF-8 and Arabic and Tamil names survive
  // instead of arriving as mojibake.
  return '﻿' + [header.map(escape).join(','), ...lines].join('\r\n');
}

function toDateString(value: unknown): string {
  const date =
    value && typeof (value as { toDate?: () => Date }).toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : value instanceof Date
        ? value
        : null;
  return date ? date.toISOString().slice(0, 16).replace('T', ' ') : '';
}
