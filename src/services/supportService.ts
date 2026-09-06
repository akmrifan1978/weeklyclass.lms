import { COLLECTIONS } from '@/constants/app';
import type {
  AppUser,
  QaQuestion,
  SupportKind,
  SupportRequest,
  SupportStatus,
} from '@/types';

import {
  createDoc,
  listPage,
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
  input: { kind: SupportKind; subject: string; message: string },
  user: AppUser
): Promise<string> {
  const id = await createDoc(
    COLLECTIONS.supportRequests,
    {
      kind: input.kind,
      subject: input.subject.trim(),
      message: input.message.trim(),
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
export async function replyToRequest(
  requestId: string,
  reply: string,
  request: SupportRequest,
  actor: AppUser
): Promise<void> {
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

  void notifications
    .send(
      {
        title: 'Reply from the team',
        message: request.subject,
        category: 'general',
        targetRole: 'user',
        userId: request.userId,
        route: '/(student)/support',
      },
      actor
    )
    .catch(() => undefined);
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
      title: question.question.slice(0, 80),
      classId: question.classId ?? null,
      route: '/(student)/qa',
    },
    actor
  );
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
