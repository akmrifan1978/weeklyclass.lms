import type { EventRegistration } from '@/types';

/**
 * What one booking has actually paid, in a world where that changed shape.
 *
 * READ A BOOKING'S MONEY THROUGH THESE FUNCTIONS, never off the fields. A
 * payment now comes in three shapes and the wrong answer looks exactly like
 * the right one:
 *
 *   - taken before part payments existed: only `paid`, a yes or no, where yes
 *     meant the whole amount;
 *   - taken since: `paidAmount`, which may be a deposit;
 *   - cancelled after paying: some or all of it handed back in `refundedAmount`.
 *
 * Pure arithmetic with no imports of its own, so both the bookings service and
 * the accounts can use it without one depending on the other — and so it can
 * be tested without a database.
 */

export type PaymentState = 'unpaid' | 'partial' | 'paid' | 'refunded';

/** Money received on this booking, before anything was handed back. */
export function receivedOn(registration: EventRegistration): number {
  const recorded = Number(registration.paidAmount);
  if (Number.isFinite(recorded)) return Math.max(0, recorded);
  return registration.paid === true ? Number(registration.amount) || 0 : 0;
}

export function refundedOn(registration: EventRegistration): number {
  const given = Number(registration.refundedAmount);
  return Number.isFinite(given) ? Math.max(0, given) : 0;
}

/** Received less refunded — what the event has actually kept. */
export function netReceivedOn(registration: EventRegistration): number {
  return receivedOn(registration) - refundedOn(registration);
}

/** Still owed. Never negative: an overpayment is not a debt the other way. */
export function outstandingOn(registration: EventRegistration): number {
  return Math.max(0, (Number(registration.amount) || 0) - receivedOn(registration));
}

export function paymentStateOf(registration: EventRegistration): PaymentState {
  if (refundedOn(registration) > 0) return 'refunded';
  const received = receivedOn(registration);
  if (received <= 0) return 'unpaid';
  return received >= (Number(registration.amount) || 0) ? 'paid' : 'partial';
}

/**
 * Money rounded the way money is written.
 *
 * Per-person figures divide, and a third of ten riyals is not a number anybody
 * writes on a sheet. Two decimals, and never a negative zero.
 */
export function money(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100 || 0;
}
