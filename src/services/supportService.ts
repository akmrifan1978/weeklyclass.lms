import i18n from '@/i18n';
import { COLLECTIONS } from '@/constants/app';
import { toDate } from '@/utils/date';
import { AppError } from '@/utils/errors';
import type {
  AppUser,
  LanguageCode,
  QaQuestion,
  SupportKind,
  SupportRequest,
  SupportStatus,
} from '@/types';

import {
  createDoc,
  listPage,
  softDelete,
  updateDocById,
  type Cursor,
  type Page,
} from './firestore';
import { announce } from './announceService';
import * as notifications from './notificationService';
import * as audit from './auditService';

/**
 * Support requests and open Q&A.
 *
 * Two collections with deliberately opposite visibility. A support request is
 * private between one person and staff — a complaint about a teacher is not
 * something to publish to the class. A Q&A question is asked in the open,
 * because the answer teaches everyone who reads it, which is the entire reason
 * to ask it there rather than in a private message.
 */

// ---------------------------------------------------------------------------
// Support requests
// ---------------------------------------------------------------------------

export interface SupportQuery {
  kind?: SupportKind;
  status?: SupportStatus;
  userId?: string;
  cursor?: Cursor;
  pageSize?: number;
}

export function listRequests(options: SupportQuery = {}): Promise<Page<SupportRequest>> {
  return listPage<SupportRequest>(COLLECTIONS.supportRequests, {
    filters: [
      options.kind ? ['kind', '==', options.kind] : null,
      options.status ? ['status', '==', options.status] : null,
      options.userId ? ['userId', '==', options.userId] : null,
    ],
    orderByField: 'createdAt',
    direction: 'desc',
    cursor: options.cursor ?? null,
    pageSize: options.pageSize ?? 20,
  });
}

/** Everything one person has written in, newest first. */
export function listMyRequests(user: AppUser): Promise<Page<SupportRequest>> {
  return listRequests({ userId: user.uid, pageSize: 30 });
}

export async function submitRequest(
  input: {
    kind: SupportKind;
    subject: string;
    message: string;
    /** 1-5, and only meaningful on a `feedback` request. */
    rating?: number | null;
    language?: LanguageCode | null;
  },
  user: AppUser
): Promise<string> {
  const id = await createDoc(
    COLLECTIONS.supportRequests,
    {
      kind: input.kind,
      subject: input.subject.trim(),
      message: input.message.trim(),
      // Stored only where it means something. A star rating attached to a
      // complaint would be counted in the average alongside actual feedback and
      // quietly make it a different number.
      rating: input.kind === 'feedback' ? (input.rating ?? null) : null,
      language: input.language ?? null,
      userId: user.uid,
      userName: user.fullName,
      userRole: user.role,
      // Carried so an admin can call someone back about a complaint without
      // opening a second screen to find their number.
      userMobile: user.mobile ?? null,
      classId: user.classId ?? null,
      branchId: user.branchId ?? null,
      status: 'open' as SupportStatus,
      reply: null,
      repliedBy: null,
      repliedByName: null,
      repliedAt: null,
    },
    { actorId: user.uid }
  );

  // Deliberately NOT audit-logged with the message body. The audit trail is
  // readable by every admin; a complaint's contents belong in the request
  // itself, where the same people can read it in context.
  await audit
    .log({
      actor: user,
      action: 'CREATE',
      collection: COLLECTIONS.supportRequests,
      documentId: id,
      summary: `${user.fullName} submitted a ${input.kind}`,
    })
    .catch(() => undefined);

  return id;
}

/**
 * A plea for help from somebody who cannot sign in.
 *
 * Every other request here is written by an authenticated user, and this one
 * cannot be: the whole problem is that they are locked out. So it is the single
 * kind the rules accept from a signed-out client, under tight validation — a
 * fixed kind, a fixed open status, no reply fields, and short strings.
 *
 * The honest cost: an unauthenticated write is a spam surface, and Firestore
 * rules cannot rate-limit. Nothing here is secret and nothing is destroyed, so
 * the worst case is junk rows an admin deletes. That is a better trade than
 * leaving somebody with a synthetic sign-in address no way to ask for help.
 *
 * Deliberately NOT audit-logged: there is no actor to attribute it to, and the
 * request itself carries everything an admin needs.
 */
export async function requestPasswordHelp(input: {
  /** Whatever they tried to sign in with — mobile, username or email. */
  identifier: string;
  /** How to reach them back, since by definition we cannot email the account. */
  contact: string;
}): Promise<string> {
  const identifier = input.identifier.trim().slice(0, 120);
  const contact = input.contact.trim().slice(0, 120);

  return createDoc(COLLECTIONS.supportRequests, {
    kind: 'passwordHelp' as SupportKind,
    subject: `Password help: ${identifier}`,
    message: `Cannot sign in as "${identifier}". Contact back on: ${contact || 'not given'}.`,
    // No uid to record — that is the point. The name is what they typed, so an
    // admin can match it against the register themselves.
    userId: null,
    userName: identifier,
    userRole: null,
    userMobile: contact || null,
    classId: null,
    branchId: null,
    status: 'open' as SupportStatus,
    reply: null,
    repliedBy: null,
    repliedByName: null,
    repliedAt: null,
  });
}

/**
 * Answers a request and tells the person who wrote it.
 *
 * The notification is targeted at that one user rather than their class: they
 * wrote in privately and the reply stays private.
 */
/**
 * What happened when the reply was sent, so the admin can be told.
 *
 * `notified` is false when the reply saved but the student could not be told —
 * a real outcome that used to be swallowed, leaving an admin certain they had
 * answered somebody who never heard.
 */
export interface ReplyOutcome {
  notified: boolean;
  note: string | null;
}

export async function replyToRequest(
  requestId: string,
  reply: string,
  request: SupportRequest,
  actor: AppUser
): Promise<ReplyOutcome> {
  await updateDocById<SupportRequest>(COLLECTIONS.supportRequests, requestId, {
    reply: reply.trim(),
    repliedBy: actor.uid,
    repliedByName: actor.fullName,
    repliedAt: new Date(),
    status: 'answered',
  });

  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.supportRequests,
    documentId: requestId,
    summary: `Replied to ${request.userName}'s ${request.kind}`,
  });

  // A request filed by somebody who could not sign in has no account to
  // notify. The reply is still saved and still visible to staff; there is
  // simply nobody to send it to, which is not a failure.
  if (!request.userId) {
    return { notified: false, note: null };
  }

  try {
    const outcome = await notifications.send(
      {
        title: i18n.t('support.replyNotificationTitle'),
        message: request.subject,
        category: 'support_reply',
        targetRole: 'user',
        userId: request.userId,
        route: '/(student)/support',
      },
      actor
    );
    return { notified: true, note: outcome.note };
  } catch (error) {
    // Deliberately not rethrown: the reply itself is saved and undoing it
    // because the doorbell failed would be the worse outcome. But it is
    // reported, so the admin knows to reach the student another way.
    console.warn('[WeeklyClass] replied but could not notify:', error);
    return { notified: false, note: null };
  }
}

/**
 * Removes requests, one call for however many were selected.
 *
 * A soft delete, like everything else here: a complaint that an admin tidies
 * away is still a record of a complaint, and hard-deleting it would leave no
 * trace that it was ever made. It stops appearing in the inbox, which is what
 * "delete" means from where the admin is standing.
 *
 * Reported per id rather than as one pass/fail. Deleting twenty and having
 * three refused should say which three, not throw away the seventeen that
 * worked.
 */
export async function deleteRequests(
  ids: string[],
  actor: AppUser
): Promise<{ removed: number; failed: string[] }> {
  const failed: string[] = [];
  let removed = 0;

  for (const id of ids) {
    try {
      await softDelete(COLLECTIONS.supportRequests, id, actor.uid);
      removed += 1;
    } catch (error) {
      console.warn(`[WeeklyClass] could not delete supportRequests/${id}:`, error);
      failed.push(id);
    }
  }

  if (removed > 0) {
    await audit
      .log({
        actor,
        action: 'DELETE',
        collection: COLLECTIONS.supportRequests,
        documentId: ids[0] ?? '',
        summary: `Removed ${removed} support request(s)`,
      })
      .catch(() => undefined);
  }

  return { removed, failed };
}

export async function closeRequest(
  requestId: string,
  actor: AppUser
): Promise<void> {
  await updateDocById<SupportRequest>(COLLECTIONS.supportRequests, requestId, {
    status: 'closed',
  });
  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.supportRequests,
    documentId: requestId,
    summary: 'Closed a support request',
  });
}

// ---------------------------------------------------------------------------
// Live Q&A
// ---------------------------------------------------------------------------

export interface QaQuery {
  classId?: string | null;
  eventId?: string | null;
  cursor?: Cursor;
  pageSize?: number;
}

export async function listQuestions(options: QaQuery = {}): Promise<QaQuestion[]> {
  const page = await listPage<QaQuestion>(COLLECTIONS.qaQuestions, {
    filters: [
      options.classId ? ['classId', '==', options.classId] : null,
      options.eventId ? ['eventId', '==', options.eventId] : null,
    ],
    orderByField: 'createdAt',
    direction: 'desc',
    cursor: options.cursor ?? null,
    pageSize: options.pageSize ?? 40,
  });
  // Hidden questions are filtered here rather than in the query: adding a
  // `hidden == false` filter would need a composite index for every combination
  // of class and event, and would also hide older questions saved before the
  // field existed.
  return page.items.filter((q) => q.hidden !== true);
}

export async function askQuestion(
  input: {
    question: string;
    audioUrl?: string | null;
    audioSeconds?: number | null;
    classId?: string | null;
    eventId?: string | null;
  },
  user: AppUser
): Promise<string> {
  return createDoc(
    COLLECTIONS.qaQuestions,
    {
      question: input.question.trim(),
      audioUrl: input.audioUrl ?? null,
      audioSeconds: input.audioSeconds ?? null,
      askedBy: user.uid,
      askedByName: user.fullName,
      classId: input.classId ?? user.classId ?? null,
      eventId: input.eventId ?? null,
      answer: null,
      answeredBy: null,
      answeredByName: null,
      answeredAt: null,
      status: 'open' as const,
      hidden: false,
    },
    { actorId: user.uid }
  );
}

/**
 * Answers a question for the whole class to read.
 *
 * The class is notified, not just the asker — the answer is the teaching, and
 * the reason to ask in the open is that everyone else gets it too.
 */
export async function answerQuestion(
  questionId: string,
  answer: string,
  question: QaQuestion,
  actor: AppUser,
  audio?: { url: string | null; seconds: number | null }
): Promise<void> {
  await updateDocById<QaQuestion>(COLLECTIONS.qaQuestions, questionId, {
    answer: answer.trim(),
    answerAudioUrl: audio?.url ?? null,
    answerAudioSeconds: audio?.seconds ?? null,
    answeredBy: actor.uid,
    answeredByName: actor.fullName,
    answeredAt: new Date(),
    status: 'answered',
  });

  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.qaQuestions,
    documentId: questionId,
    summary: `Answered a question from ${question.askedByName}`,
  });

  void announce(
    {
      kind: 'article',
      // A spoken question carries no text to quote, and a notification with an
      // empty title reads as a bug. Name the asker instead.
      title:
        question.question.trim().slice(0, 80) ||
        `${question.askedByName}`.trim().slice(0, 80),
      classId: question.classId ?? null,
      route: '/(student)/qa',
    },
    actor
  );
}

/**
 * How long somebody may change their own question after asking it.
 *
 * Long enough to notice a typo, re-record a question that came out garbled, or
 * take one back that was asked in the wrong place. Short enough that nobody can
 * quietly rewrite a question after a teacher has started answering it, which
 * would leave the answer replying to words that are no longer there.
 */
export const QUESTION_EDIT_MINUTES = 10;

/** Minutes left to change this question, or 0 once the window has closed. */
export function editMinutesLeft(question: QaQuestion, now = Date.now()): number {
  // A question saved a moment ago has no server timestamp yet. It is, by
  // definition, inside its window.
  const asked = toDate(question.createdAt)?.getTime() ?? now;
  const left = asked + QUESTION_EDIT_MINUTES * 60_000 - now;
  return left > 0 ? Math.ceil(left / 60_000) : 0;
}

/**
 * Whether this person may still edit or delete this question themselves.
 *
 * Only their own, only while it is unanswered, and only inside the window.
 * The security rules check the same three things — this is what decides
 * whether the buttons are offered, not what enforces it.
 */
export function canChangeOwnQuestion(
  question: QaQuestion,
  user: AppUser | null,
  now = Date.now()
): boolean {
  if (!user || question.askedBy !== user.uid) return false;
  if (question.status !== 'open' || question.answeredBy) return false;
  return editMinutesLeft(question, now) > 0;
}

/**
 * Corrects a question. Text, recording, or both.
 *
 * The same "must contain something" rule as asking: an edit that empties both
 * the text and the recording is a deletion by accident, and deletion has its
 * own, confirmed, button.
 */
export async function editQuestion(
  question: QaQuestion,
  input: { question: string; audioUrl: string | null; audioSeconds: number | null },
  user: AppUser
): Promise<void> {
  if (!input.question.trim() && !input.audioUrl) {
    throw new AppError('qa.sayOrWriteSomething', 'invalid-argument');
  }
  await updateDocById<QaQuestion>(COLLECTIONS.qaQuestions, question.id, {
    question: input.question.trim(),
    audioUrl: input.audioUrl,
    audioSeconds: input.audioSeconds,
  });
  void audit.log({
    actor: user,
    action: 'UPDATE',
    collection: COLLECTIONS.qaQuestions,
    documentId: question.id,
    summary: 'Edited a question',
  });
}

/**
 * Removes a question.
 *
 * Soft, like everything else somebody wrote. The asker may do this inside
 * their window; an admin may do it at any time. A teacher hides rather than
 * deletes — see hideQuestion — so nothing a student wrote is destroyed by
 * anyone below an admin.
 */
export async function deleteQuestion(question: QaQuestion, user: AppUser): Promise<void> {
  await softDelete(COLLECTIONS.qaQuestions, question.id, user.uid);
  void audit.log({
    actor: user,
    action: 'DELETE',
    collection: COLLECTIONS.qaQuestions,
    documentId: question.id,
    summary:
      question.askedBy === user.uid
        ? 'Withdrew their own question'
        : `Deleted a question from ${question.askedByName}`,
  });
}

export async function hideQuestion(
  questionId: string,
  hidden: boolean,
  actor: AppUser
): Promise<void> {
  await updateDocById<QaQuestion>(COLLECTIONS.qaQuestions, questionId, { hidden });
  await audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.qaQuestions,
    documentId: questionId,
    summary: hidden ? 'Hid a question' : 'Restored a question',
  });
}
