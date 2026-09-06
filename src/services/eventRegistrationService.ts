import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS } from '@/constants/app';
import { AppError } from '@/utils/errors';
import type {
  AgeGroup,
  AppUser,
  CalendarEvent,
  EventParticipant,
  EventRegistration,
  EventRegistrationSettings,
} from '@/types';

import { listPage, updateDocById, type Page } from './firestore';
import * as audit from './auditService';

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
  if (existing && existing.status === 'booked') return 'event.alreadyBooked';
  if (isFull(event)) return 'event.full';
  return null;
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
  reference?: string | null
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
  const registrationId = `${event.id}_${user.uid}`;
  const eventRef = doc(db, COLLECTIONS.calendarEvents, event.id);
  const bookingRef = doc(db, COLLECTIONS.eventRegistrations, registrationId);

  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(eventRef);
    if (!fresh.exists()) throw new AppError('errors.notFound', 'not-found');

    const current = fresh.data() as CalendarEvent;
    const taken = current.registeredCount ?? 0;
    const capacity = current.registration?.capacity ?? null;

    const existing = await tx.get(bookingRef);
    const alreadyBooked =
      existing.exists() && (existing.data() as EventRegistration).status === 'booked';
    if (alreadyBooked) throw new AppError('event.alreadyBooked', 'already-exists');

    if (capacity != null && taken + seats > capacity) {
      throw new AppError('event.notEnoughSeats', 'failed-precondition');
    }

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

    tx.set(bookingRef, {
      eventId: event.id,
      eventTitle: event.title,
      userId: user.uid,
      userName: user.fullName,
      userMobile: user.mobile ?? null,
      userEmail: user.email ?? null,
      participants,
      seats,
      // Frozen at booking time. A price raised next week must not silently
      // change what someone already agreed to pay.
      amount: participants.reduce((sum, p) => sum + p.price, 0),
      currency: settings.currency ?? '',
      reference: reference?.trim() || null,
      status: 'booked',
      paid: false,
      deleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: user.uid,
    });

    tx.update(eventRef, { registeredCount: taken + seats });
  });

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
 * Cancels a booking and returns the seats.
 *
 * The booking is marked cancelled rather than deleted: an admin reconciling
 * payments needs to see that somebody booked and pulled out, which a deleted
 * row cannot tell them.
 */
export async function cancel(
  registration: EventRegistration,
  actor: AppUser
): Promise<void> {
  const eventRef = doc(db, COLLECTIONS.calendarEvents, registration.eventId);
  const bookingRef = doc(db, COLLECTIONS.eventRegistrations, registration.id);

  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(eventRef);
    const booking = await tx.get(bookingRef);
    if (!booking.exists()) return;
    if ((booking.data() as EventRegistration).status === 'cancelled') return;

    tx.update(bookingRef, { status: 'cancelled', updatedAt: serverTimestamp() });

    if (fresh.exists()) {
      const taken = (fresh.data() as CalendarEvent).registeredCount ?? 0;
      // Clamped at zero: a count that has drifted must not be driven negative
      // by a cancellation, which would then let the event oversell.
      tx.update(eventRef, { registeredCount: Math.max(0, taken - registration.seats) });
    }
  });

  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.eventRegistrations,
    documentId: registration.id,
    summary: `Cancelled ${registration.userName}'s booking for "${registration.eventTitle}"`,
  });
}

/** Marks a booking as paid. Admin bookkeeping, not a payment gateway. */
export async function setPaid(
  registration: EventRegistration,
  paid: boolean,
  actor: AppUser
): Promise<void> {
  await updateDocById<EventRegistration>(
    COLLECTIONS.eventRegistrations,
    registration.id,
    { paid }
  );
  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.eventRegistrations,
    documentId: registration.id,
    summary: `Marked ${registration.userName}'s booking ${paid ? 'paid' : 'unpaid'}`,
  });
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
    'Booked by',
    'Mobile',
    'Email',
    'Reference',
    'Participant',
    'Gender',
    'Age group',
    'Price',
    'Currency',
    'Paid',
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
        index === 0 ? (row.paid ? 'Yes' : 'No') : '',
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
