import { COLLECTIONS } from '@/constants/app';
import type { AppUser, EventFinanceEntry, EventRegistration } from '@/types';
import { createDoc, listAll, softDelete, updateDocById } from './firestore';
import * as audit from './auditService';

/**
 * What an event took and what it cost.
 *
 * ONE EVENT AT A TIME, ALWAYS. Every read here is filtered by `eventId`, and
 * nothing in this file adds two events together. That is a deliberate
 * constraint rather than an oversight: the centre runs a gathering, an Umrah
 * trip and a course in the same month out of different pockets, and a single
 * merged total would be a number nobody could act on. A figure spanning events
 * only ever appears where the screen says so in as many words.
 *
 * WHAT THIS IS NOT. It records money; it does not move any. No gateway, no card
 * details, no bank connection - an admin writes down what was received or paid,
 * exactly as the booking's `paid` flag already works.
 *
 * Income from bookings is NOT stored here. It is already on the bookings, frozen
 * at booking time, and copying it would give the same riyal two homes that
 * drift apart. `totalsFor` reads the bookings for that side and this collection
 * for the rest.
 */

export const FINANCE_CATEGORIES = [
  'venue',
  'food',
  'transport',
  'printing',
  'speaker',
  'equipment',
  'donation',
  'sponsorship',
  'other',
] as const;

export type FinanceCategory = (typeof FINANCE_CATEGORIES)[number];

export interface EventTotals {
  /** Owed by everyone who has booked, whether or not they have paid. */
  bookedDue: number;
  /** Of that, what has been marked received. */
  bookedReceived: number;
  /** Money in that did not come from a booking: donations, sponsorship. */
  otherIncome: number;
  expenses: number;
  /** What the event was BUDGETED to take and to cost. Planned, not real. */
  plannedIncome: number;
  plannedExpenses: number;
  /** Received plus other income, less expenses. Money that has actually moved. */
  net: number;
  seats: number;
  participants: number;
  bookings: number;
  currency: string;
}

/** Every entry for one event, newest first. Never more than one event. */
export function listEntries(eventId: string): Promise<EventFinanceEntry[]> {
  if (!eventId) return Promise.resolve([]);
  return listAll<EventFinanceEntry>(COLLECTIONS.eventFinance, {
    filters: [['eventId', '==', eventId]],
    orderByField: 'date',
    direction: 'desc',
    pageSize: 200,
  });
}

export async function saveEntry(
  data: Omit<EventFinanceEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
  actor: AppUser
): Promise<string> {
  const { id, ...fields } = data;

  if (id) {
    await updateDocById<EventFinanceEntry>(COLLECTIONS.eventFinance, id, fields);
    void audit.log({
      actor,
      action: 'UPDATE',
      collection: COLLECTIONS.eventFinance,
      documentId: id,
      summary: `Edited ${fields.type} "${fields.title}" (${fields.amount} ${fields.currency})`,
    });
    return id;
  }

  const newId = await createDoc(COLLECTIONS.eventFinance, fields, { actorId: actor.uid });
  void audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.eventFinance,
    documentId: newId,
    summary: `Recorded ${fields.type} "${fields.title}" (${fields.amount} ${fields.currency})`,
  });
  return newId;
}

export async function removeEntry(entry: EventFinanceEntry, actor: AppUser): Promise<void> {
  await softDelete(COLLECTIONS.eventFinance, entry.id, actor.uid);
  void audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.eventFinance,
    documentId: entry.id,
    summary: `Removed ${entry.type} "${entry.title}"`,
  });
}

/**
 * The one event's figures AND the entries they were worked out from.
 *
 * Both in one call on purpose. The accounts screen needs the list as well as
 * the totals, and asking for them separately read every entry twice — the same
 * documents, billed twice, on a free tier that has already run out once.
 *
 * `bookings` are read rather than counted so seats, people and amounts come
 * from the same pass; an event's bookings are tens, not thousands, and the
 * screen that calls this is opened by one or two people a week.
 */
export async function detailsFor(
  eventId: string,
  fallbackCurrency = 'SAR'
): Promise<{
  totals: EventTotals;
  /** What really happened. */
  entries: EventFinanceEntry[];
  /** What was planned to happen. */
  budget: EventFinanceEntry[];
}> {
  const [bookings, all] = await Promise.all([
    listAll<EventRegistration>(COLLECTIONS.eventRegistrations, {
      filters: [['eventId', '==', eventId]],
      pageSize: 300,
    }),
    listEntries(eventId),
  ]);
  // Split here, once, so no screen below has to remember which is which.
  return {
    totals: summarise(bookings, all, fallbackCurrency),
    entries: all.filter((entry) => entry.planned !== true),
    budget: all.filter((entry) => entry.planned === true),
  };
}

/** Just the figures, for the list of events. */
export async function totalsFor(eventId: string, fallbackCurrency = 'SAR'): Promise<EventTotals> {
  const { totals } = await detailsFor(eventId, fallbackCurrency);
  return totals;
}

function summarise(
  bookings: EventRegistration[],
  entries: EventFinanceEntry[],
  fallbackCurrency: string
): EventTotals {
  // A cancelled or declined booking owes nothing and holds no seat.
  const live = bookings.filter((b) => b.status !== 'cancelled' && b.status !== 'rejected');

  const bookedDue = live.reduce((sum, b) => sum + (Number(b.amount) || 0), 0);
  const bookedReceived = live
    .filter((b) => b.paid === true)
    .reduce((sum, b) => sum + (Number(b.amount) || 0), 0);

  /*
   * Planned and real are added up apart, and never mixed.
   *
   * A budget line is a hope; an entry is a fact. Letting one into the other's
   * total is the single worst thing this file could do - an event would report
   * money it never received, or costs it never paid, and the figure would look
   * exactly as solid as the true one.
   */
  const sum = (rows: EventFinanceEntry[]) =>
    rows.reduce((total, e) => total + (Number(e.amount) || 0), 0);
  const real = entries.filter((e) => e.planned !== true);
  const planned = entries.filter((e) => e.planned === true);

  const otherIncome = sum(real.filter((e) => e.type === 'income'));
  const expenses = sum(real.filter((e) => e.type === 'expense'));

  return {
    bookedDue,
    bookedReceived,
    otherIncome,
    expenses,
    plannedIncome: sum(planned.filter((e) => e.type === 'income')),
    plannedExpenses: sum(planned.filter((e) => e.type === 'expense')),
    // Received, not due: a net flattered by money that has not arrived is the
    // number that gets a centre into trouble.
    net: bookedReceived + otherIncome - expenses,
    seats: live.reduce((sum, b) => sum + (Number(b.seats) || 0), 0),
    participants: live.reduce((sum, b) => sum + (b.participants?.length || 0), 0),
    bookings: live.length,
    currency: live[0]?.currency || entries[0]?.currency || fallbackCurrency,
  };
}

/**
 * The event's accounts as a CSV an organiser can file, print or send on.
 *
 * Four blocks in one sheet: the summary a treasurer reads first, the budget
 * against what was actually spent, the budget's own lines, then every real
 * entry. The headers are in English on purpose, matching the attendee sheet -
 * this file is opened in Excel months later, often by somebody auditing rather
 * than the person who made it.
 *
 * ONE EVENT. The event is named in the first row so a printed page found on a
 * desk says which gathering it accounts for.
 */
export function accountsCsv(
  eventTitle: string,
  eventDate: string,
  totals: EventTotals,
  entries: EventFinanceEntry[],
  budget: EventFinanceEntry[] = []
): string {
  // Quote everything and double any inner quote, exactly as the attendee sheet
  // does: a venue called "Al Khair, Jeddah" must not become two columns.
  const cell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const row = (...values: unknown[]) => values.map(cell).join(',');

  const outstanding = totals.bookedDue - totals.bookedReceived;
  /* Everything that actually came in, which is what a budget for income is
     compared against: the attendees' payments plus donations and sponsorship. */
  const income = totals.bookedReceived + totals.otherIncome;

  const lines = [
    row('Event', eventTitle),
    row('Date', eventDate),
    row('Currency', totals.currency),
    '',
    row('Bookings', totals.bookings),
    row('People', totals.participants),
    row('Seats', totals.seats),
    '',
    row('Due from attendees', totals.bookedDue),
    row('Paid by attendees', totals.bookedReceived),
    row('Outstanding', outstanding),
    row('Other income', totals.otherIncome),
    row('Expenses', totals.expenses),
    row('Net (money actually moved)', totals.net),
    '',
    row('BUDGET', 'Planned', 'Actual', 'Difference'),
    row(
      'Income',
      totals.plannedIncome,
      income,
      // Income: over the plan is good, so the difference reads actual less
      // planned. Expenses are the other way round, below.
      income - totals.plannedIncome
    ),
    row('Expenses', totals.plannedExpenses, totals.expenses, totals.plannedExpenses - totals.expenses),
    '',
    row('Budget line', 'Type', 'Category', 'Planned', 'Currency', 'Note'),
    ...budget.map((line) =>
      row(line.title, line.type, line.category, line.amount, line.currency, line.note ?? '')
    ),
    '',
    row('Date', 'Type', 'Category', 'Title', 'Paid to / received from', 'Amount', 'Currency', 'Note'),
    ...entries.map((entry) =>
      row(
        entry.date,
        entry.type,
        entry.category,
        entry.title,
        entry.party ?? '',
        entry.amount,
        entry.currency,
        entry.note ?? ''
      )
    ),
  ];

  return lines.join('\n');
}
