import { COLLECTIONS } from '@/constants/app';
import { money, netReceivedOn, refundedOn } from '@/utils/bookingMoney';
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
  /** Of that, what has been received and KEPT — part payments less refunds. */
  bookedReceived: number;
  /** Money handed back on cancelled bookings. Already deducted above. */
  refunds: number;
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
  /**
   * What the event costs for each person coming, and what each must pay to
   * cover it. Zero when nobody has booked yet — dividing by no people would
   * report an infinite cost per head, which is both wrong and alarming.
   */
  costPerPerson: number;
  /** Expenses less income that did not come from attendees, per person. */
  breakEvenPerPerson: number;
  /** The budget's cost per person, for comparison while planning. */
  plannedCostPerPerson: number;
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

  /*
   * Received counts PART PAYMENTS, and every booking, cancelled ones included.
   *
   * Two things that look like details and are not. A deposit is money the
   * event is holding, so it counts towards income from the day it arrives
   * rather than the day the balance clears. And a cancelled booking is read
   * for money even though it is excluded from everything else: somebody who
   * paid and then cancelled may have been refunded in part or not at all, and
   * whatever the centre kept is income it has to account for. `netReceivedOn`
   * handles all three shapes a payment can take, old and new.
   */
  const bookedReceived = bookings.reduce((total, b) => total + netReceivedOn(b), 0);
  const refunds = bookings.reduce((total, b) => total + refundedOn(b), 0);

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

  const plannedIncome = sum(planned.filter((e) => e.type === 'income'));
  const plannedExpenses = sum(planned.filter((e) => e.type === 'expense'));
  const participants = live.reduce((total, b) => total + (b.participants?.length || 0), 0);

  /*
   * Per head, and only once there are heads to divide by.
   *
   * `costPerPerson` is what the event is costing for each person coming.
   * `breakEvenPerPerson` is what each must pay for it to cost the centre
   * nothing: the costs less the money that did not come from attendees, since
   * a donation covering half the hall genuinely lowers what the rest must pay.
   * Both are zero with nobody booked, rather than infinite.
   */
  const perHead = (value: number) => (participants > 0 ? money(value / participants) : 0);

  return {
    bookedDue,
    bookedReceived,
    refunds,
    otherIncome,
    expenses,
    plannedIncome,
    plannedExpenses,
    // Received, not due: a net flattered by money that has not arrived is the
    // number that gets a centre into trouble.
    net: bookedReceived + otherIncome - expenses,
    seats: live.reduce((total, b) => total + (Number(b.seats) || 0), 0),
    participants,
    bookings: live.length,
    currency: live[0]?.currency || entries[0]?.currency || fallbackCurrency,
    costPerPerson: perHead(expenses),
    breakEvenPerPerson: perHead(Math.max(0, expenses - otherIncome)),
    plannedCostPerPerson: perHead(plannedExpenses),
  };
}

/**
 * The shared plumbing of the reports below.
 *
 * Quote everything and double any inner quote, exactly as the attendee sheet
 * does: a venue called "Al Khair, Jeddah" must not become two columns. The
 * headers are in English on purpose, matching that sheet - these files are
 * opened in Excel months later, often by somebody auditing rather than the
 * person who made them.
 */
function sheet(lines: string[]): string {
  return lines.join('\n');
}

const cell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
const row = (...values: unknown[]) => values.map(cell).join(',');

/** Every category either side has used, so nothing is left out of a comparison. */
function categoriesIn(rows: EventFinanceEntry[]): string[] {
  const seen: string[] = [];
  for (const entry of rows) if (!seen.includes(entry.category)) seen.push(entry.category);
  return seen.sort();
}

function totalFor(
  rows: EventFinanceEntry[],
  type: 'income' | 'expense',
  category?: string
): number {
  return rows
    .filter((e) => e.type === type && (category === undefined || e.category === category))
    .reduce((total, e) => total + (Number(e.amount) || 0), 0);
}

/**
 * REPORT ONE: the budget against what actually happened, category by category.
 *
 * The question this answers is "where did we go over, and by how much", which
 * a single pair of totals cannot answer. Every category appearing in either
 * the plan or the accounts gets a line, so a cost nobody budgeted for shows up
 * as planned nothing, spent something, rather than quietly vanishing.
 *
 * ONE EVENT. The event is named in the first rows so a printed page found on a
 * desk says which gathering it accounts for.
 */
export function budgetReportCsv(
  eventTitle: string,
  eventDate: string,
  totals: EventTotals,
  entries: EventFinanceEntry[],
  budget: EventFinanceEntry[]
): string {
  /* What a budget for income is compared against: what attendees paid, less
     anything refunded, plus donations and sponsorship. */
  const income = totals.bookedReceived + totals.otherIncome;
  const categories = categoriesIn([...budget, ...entries]);

  // Costs: under the plan is the good direction, so the difference reads
  // planned less actual. Income is the other way round.
  const compare = (label: string, planned: number, actual: number, costs: boolean) =>
    row(label, planned, actual, costs ? planned - actual : actual - planned);

  return sheet([
    row('BUDGET AGAINST ACTUAL'),
    row('Event', eventTitle),
    row('Date', eventDate),
    row('Currency', totals.currency),
    '',
    row('', 'Planned', 'Actual', 'Difference'),
    compare('Income (total)', totals.plannedIncome, income, false),
    compare('Expenses (total)', totals.plannedExpenses, totals.expenses, true),
    '',
    row('EXPENSES BY CATEGORY', 'Planned', 'Actual', 'Difference'),
    ...categories
      .filter(
        (c) => totalFor(budget, 'expense', c) > 0 || totalFor(entries, 'expense', c) > 0
      )
      .map((c) =>
        compare(c, totalFor(budget, 'expense', c), totalFor(entries, 'expense', c), true)
      ),
    '',
    row('INCOME BY CATEGORY', 'Planned', 'Actual', 'Difference'),
    ...categories
      .filter((c) => totalFor(budget, 'income', c) > 0 || totalFor(entries, 'income', c) > 0)
      .map((c) =>
        compare(c, totalFor(budget, 'income', c), totalFor(entries, 'income', c), false)
      ),
    '',
    row('PER PERSON', 'Planned', 'Actual'),
    row('People', totals.participants, totals.participants),
    row('Cost per person', totals.plannedCostPerPerson, totals.costPerPerson),
    '',
    row('BUDGET LINES'),
    row('Line', 'Type', 'Category', 'Planned', 'Currency', 'Note'),
    ...budget.map((line) =>
      row(line.title, line.type, line.category, line.amount, line.currency, line.note ?? '')
    ),
  ]);
}

/**
 * REPORT TWO: the full income and expense account.
 *
 * Everything that moved, in one sheet: what attendees paid, what went back out
 * as refunds, every other riyal in, every riyal out, the per-person figures,
 * and then each entry behind them. This is the one handed to somebody who asks
 * where the money went.
 */
export function incomeExpenseCsv(
  eventTitle: string,
  eventDate: string,
  totals: EventTotals,
  entries: EventFinanceEntry[]
): string {
  const outstanding = totals.bookedDue - totals.bookedReceived;
  const income = totals.bookedReceived + totals.otherIncome;
  const categories = categoriesIn(entries);

  return sheet([
    row('INCOME AND EXPENSES'),
    row('Event', eventTitle),
    row('Date', eventDate),
    row('Currency', totals.currency),
    '',
    row('Bookings', totals.bookings),
    row('People', totals.participants),
    row('Seats', totals.seats),
    '',
    row('INCOME'),
    row('Due from attendees', totals.bookedDue),
    row('Received from attendees, net of refunds', totals.bookedReceived),
    row('Refunded', totals.refunds),
    row('Still outstanding', outstanding),
    row('Other income (donations, sponsorship)', totals.otherIncome),
    row('Total income', income),
    '',
    row('EXPENSES BY CATEGORY'),
    ...categories
      .filter((c) => totalFor(entries, 'expense', c) > 0)
      .map((c) => row(c, totalFor(entries, 'expense', c))),
    row('Total expenses', totals.expenses),
    '',
    row('Net (money actually moved)', totals.net),
    '',
    row('PER PERSON'),
    row('People counted', totals.participants),
    row('Cost per person', totals.costPerPerson),
    row('Needed per person to break even', totals.breakEvenPerPerson),
    '',
    row('EVERY ENTRY'),
    row(
      'Date',
      'Type',
      'Category',
      'Title',
      'Paid to / received from',
      'Amount',
      'Currency',
      'Note'
    ),
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
  ]);
}
