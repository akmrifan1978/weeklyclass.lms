import { doc, runTransaction, serverTimestamp } from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS } from '@/constants/app';
import { AppError } from '@/utils/errors';
import type { AppUser, CalendarEvent, EventRegistration } from '@/types';

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
  seats: number,
  user: AppUser
): Promise<string> {
  if (seats < 1) throw new AppError('event.seatsRequired', 'invalid-argument');

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

    tx.set(bookingRef, {
      eventId: event.id,
      eventTitle: event.title,
      userId: user.uid,
      userName: user.fullName,
      userMobile: user.mobile ?? null,
      userEmail: user.email ?? null,
      seats,
      // Frozen at booking time. A price raised next week must not silently
      // change what someone already agreed to pay.
      amount: seats * (current.registration?.price ?? 0),
      currency: current.registration?.currency ?? '',
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
      summary: `${user.fullName} booked ${seats} seat(s) for "${event.title}"`,
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
  const header = [
    'Name',
    'Mobile',
    'Email',
    'Seats',
    'Amount',
    'Currency',
    'Paid',
    'Status',
    'Booked at',
  ];

  // Quote everything and double any inner quote. A name with a comma in it
  // would otherwise split into two columns and shift the whole row.
  const escape = (value: unknown): string =>
    `"${String(value ?? '').replace(/"/g, '""')}"`;

  const lines = rows.map((row) =>
    [
      row.userName,
      row.userMobile ?? '',
      row.userEmail ?? '',
      row.seats,
      row.amount,
      row.currency,
      row.paid ? 'Yes' : 'No',
      row.status,
      toDateString(row.createdAt),
    ]
      .map(escape)
      .join(',')
  );

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
