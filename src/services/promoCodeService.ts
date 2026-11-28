import { COLLECTIONS } from '@/constants/app';
import { toISODate } from '@/utils/date';
import type { AppUser, CalendarEvent, PromoCode } from '@/types';
import { getById, listAll, setDocById, softDelete, updateDocById } from './firestore';
import * as audit from './auditService';

/**
 * Codes that let somebody attend without paying.
 *
 * WHAT THIS IS FOR. A centre invites a speaker's family, sponsors a student
 * who cannot pay, or thanks a volunteer. Before this the only ways to do that
 * were to set the whole event free, to mark a booking paid for money that
 * never arrived — which quietly lies to the accounts — or to tell the person
 * to book and then argue about it at the door.
 *
 * THE CODE IS THE DOCUMENT ID, in capitals. Uniqueness comes free, looking one
 * up is a single read rather than a query, and the security rules can verify a
 * code claimed on a booking with one `get`.
 *
 * WHAT IT DOES NOT DO. It takes no money and gives none back: a free place is
 * recorded as a booking that owes nothing, so the event's accounts show one
 * more person and no more income, which is the truth. It is not a discount
 * system; see PromoCode.kind for why that door is left ajar.
 */

/** Capitals, digits, and nothing else — a code is read aloud and typed in. */
export function normaliseCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 24);
}

export type PromoRejection =
  | 'promo.notFound'
  | 'promo.inactive'
  | 'promo.expired'
  | 'promo.usedUp'
  | 'promo.wrongEvent';

export interface PromoCheck {
  ok: boolean;
  /** An i18n key when it was refused, so the caller only has to translate. */
  reason?: PromoRejection;
  promo?: PromoCode;
}

/**
 * Is this code good for this event, right now?
 *
 * ONE PLACE, used by the booking form to tell somebody before they commit and
 * by `book()` to decide what they actually owe. Two copies of these conditions
 * would eventually disagree, and the disagreement would be money.
 */
export function check(promo: PromoCode | null, event: CalendarEvent): PromoCheck {
  if (!promo) return { ok: false, reason: 'promo.notFound' };
  if (promo.active !== true) return { ok: false, reason: 'promo.inactive' };
  if (promo.expiresOn && promo.expiresOn < toISODate()) {
    return { ok: false, reason: 'promo.expired' };
  }
  if (promo.maxUses != null && (promo.usedCount ?? 0) >= promo.maxUses) {
    return { ok: false, reason: 'promo.usedUp' };
  }
  // A code tied to one event is refused elsewhere; a code with no event works
  // on any event that charges.
  if (promo.eventId && promo.eventId !== event.id) {
    return { ok: false, reason: 'promo.wrongEvent' };
  }
  return { ok: true, promo };
}

/** Reads one code by its text. Returns null when there is no such code. */
export async function lookup(rawCode: string): Promise<PromoCode | null> {
  const code = normaliseCode(rawCode);
  if (!code) return null;
  return getById<PromoCode>(COLLECTIONS.promoCodes, code);
}

/** Checks a typed code against an event in one call, for the booking form. */
export async function verify(rawCode: string, event: CalendarEvent): Promise<PromoCheck> {
  return check(await lookup(rawCode), event);
}

export function listCodes(): Promise<PromoCode[]> {
  return listAll<PromoCode>(COLLECTIONS.promoCodes, {
    orderByField: 'createdAt',
    direction: 'desc',
    pageSize: 200,
  });
}

/**
 * Creates or updates a code.
 *
 * The id is the code, so RENAMING one is not an edit: it would leave the old
 * code working under its own document. The manager screen locks the text once
 * a code exists, and this refuses the write rather than relying on that.
 */
export async function saveCode(
  input: {
    code: string;
    eventId?: string | null;
    eventTitle?: string | null;
    maxUses?: number | null;
    active: boolean;
    expiresOn?: string | null;
    note?: string | null;
  },
  actor: AppUser,
  existing?: PromoCode | null
): Promise<string> {
  const code = normaliseCode(input.code);
  if (!code) throw new Error('A code needs at least one letter or digit.');
  if (existing && existing.code !== code) {
    throw new Error('A code cannot be renamed. Make a new one and switch this one off.');
  }

  if (existing) {
    await updateDocById<PromoCode>(COLLECTIONS.promoCodes, code, {
      eventId: input.eventId ?? null,
      eventTitle: input.eventTitle ?? null,
      maxUses: input.maxUses ?? null,
      active: input.active,
      expiresOn: input.expiresOn ?? null,
      note: input.note ?? null,
    });
    void audit.log({
      actor,
      action: 'UPDATE',
      collection: COLLECTIONS.promoCodes,
      documentId: code,
      summary: `Edited promo code ${code}`,
    });
    return code;
  }

  // setDocById, not createDoc: the id has to be the code itself.
  await setDocById(
    COLLECTIONS.promoCodes,
    code,
    {
      code,
      kind: 'free',
      eventId: input.eventId ?? null,
      eventTitle: input.eventTitle ?? null,
      maxUses: input.maxUses ?? null,
      // Never carried over from a previous document of the same name: a code
      // that was used ten times and deleted must not start life at ten.
      usedCount: 0,
      active: input.active,
      expiresOn: input.expiresOn ?? null,
      note: input.note ?? null,
    },
    { actorId: actor.uid }
  );
  void audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.promoCodes,
    documentId: code,
    summary: `Created promo code ${code}${input.eventTitle ? ` for "${input.eventTitle}"` : ''}`,
  });
  return code;
}

export async function removeCode(promo: PromoCode, actor: AppUser): Promise<void> {
  await softDelete(COLLECTIONS.promoCodes, promo.code, actor.uid);
  void audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.promoCodes,
    documentId: promo.code,
    summary: `Removed promo code ${promo.code}`,
  });
}
