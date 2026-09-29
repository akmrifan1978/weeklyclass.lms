import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS } from '@/constants/app';
import { gradeFor } from '@/utils/format';
import { AppError } from '@/utils/errors';
import type { AppUser, Question, Quiz, QuizAttempt, Result } from '@/types';
import {
  countWhere,
  createDoc,
  getById,
  listAll,
  listPage,
  softDelete,
  updateDocById,
  type Cursor,
  type Page,
} from './firestore';
import * as audit from './auditService';
import { announce } from './announceService';

/**
 * Quizzes.
 *
 * DATA LAYOUT — the split matters for integrity:
 *   quizzes/{quizId}                       quiz metadata
 *   quizzes/{quizId}/questions/{qId}       text + options, NO correct answer
 *   quizzes/{quizId}/answerKey/{qId}       { correctIndex } — read-gated
 *   quizAttempts/{attemptId}               one sitting, answers immutable once submitted
 *   results/{resultId}                     the graded outcome
 *
 * Security rules let a student read `answerKey` only once they have a
 * *submitted* attempt for that quiz, and let them create their own result
 * exactly once — never update or delete it. Grading therefore runs on the
 * client but cannot be replayed or edited afterwards.
 *
 * LIMITATION (documented in docs/SECURITY.md): a determined student could
 * submit an empty attempt, read the key, and post an inflated score. Closing
 * that hole needs server-side grading in a Cloud Function, which requires the
 * Blaze plan. `submitAttempt` below is the single seam to move there — nothing
 * else in the app changes. Teachers can always regrade from the results screen.
 */

const questionsPath = (quizId: string) => `${COLLECTIONS.quizzes}/${quizId}/questions`;
const answerKeyPath = (quizId: string) => `${COLLECTIONS.quizzes}/${quizId}/answerKey`;

// --- Quiz CRUD -------------------------------------------------------------

export function listQuizzes(options: {
  classId?: string;
  teacherId?: string;
  status?: Quiz['status'];
  cursor?: Cursor;
  pageSize?: number;
} = {}): Promise<Page<Quiz>> {
  return listPage<Quiz>(COLLECTIONS.quizzes, {
    filters: [
      options.classId ? ['classId', '==', options.classId] : null,
      options.teacherId ? ['teacherId', '==', options.teacherId] : null,
      options.status ? ['status', '==', options.status] : null,
    ],
    orderByField: 'createdAt',
    direction: 'desc',
    cursor: options.cursor ?? null,
    pageSize: options.pageSize,
  });
}

export function getQuiz(id: string): Promise<Quiz | null> {
  return getById<Quiz>(COLLECTIONS.quizzes, id);
}

export async function saveQuiz(
  data: Partial<Quiz> & { title: string; classId: string },
  actor: AppUser,
  id?: string
): Promise<string> {
  /*
   * AN UPDATE WRITES ONLY WHAT THE FORM SENT. The defaults below belong to
   * creation alone, and applying them to an edit as well was a real bug with a
   * confusing face: `questionCount` and `totalMarks` are not fields on the
   * form, so editing a title or a time limit quietly reset a finished
   * ten-question assignment to "0 Questions" — and because publishing refuses an
   * assignment with no questions, that assignment could no longer be published
   * either. `teacherId` went the same way: an admin editing a class's
   * assignment wiped the teacher off it.
   */
  if (id) {
    const patch: Partial<Quiz> = { ...data };
    if (actor.role === 'teacher') patch.teacherId = actor.uid;
    await updateDocById<Quiz>(COLLECTIONS.quizzes, id, patch);
    void audit.log({
      actor,
      action: 'UPDATE',
      collection: COLLECTIONS.quizzes,
      documentId: id,
      summary: `Updated quiz "${data.title}"`,
    });
    return id;
  }

  const payload = {
    description: '',
    language: 'en' as const,
    timeLimit: 0,
    totalMarks: 0,
    passMark: 50,
    questionCount: 0,
    maxAttempts: 1,
    status: 'draft' as const,
    teacherId: actor.role === 'teacher' ? actor.uid : (data.teacherId ?? null),
    ...data,
  };

  const newId = await createDoc(COLLECTIONS.quizzes, payload, { actorId: actor.uid });
  void audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.quizzes,
    documentId: newId,
    summary: `Created quiz "${data.title}"`,
  });
  return newId;
}

export interface PublishResult {
  /**
   * Active students in the class group the assignment belongs to, or null when
   * the count could not be taken (offline, or a status change that is not a
   * publish). Zero is a real answer, and the one that matters.
   */
  students: number | null;
}

export async function setQuizStatus(
  quizId: string,
  status: Quiz['status'],
  actor: AppUser
): Promise<PublishResult> {
  // Read before the write so we can tell a first publish from a re-publish of
  // something the class has already been told about.
  const before = await getQuiz(quizId);

  /*
   * Publishing has one precondition — there has to be something to answer —
   * and it is checked HERE, against the questions themselves, rather than
   * against the quiz's own `questionCount`. That field has been wrong in live
   * data (see `saveQuiz`), and a stale zero refused to publish an assignment
   * that was completely ready. One query, on a button nobody presses twice a
   * day, and the true count is written back in the same breath so the list
   * stops reporting "0 Questions" for ten questions.
   */
  const repair: Partial<Quiz> = {};
  if (status === 'published') {
    const questions = await listQuestions(quizId);
    if (questions.length === 0) {
      throw new AppError('validation.minOneQuestion', 'failed-precondition');
    }
    const totalMarks = questions.reduce((sum, q) => sum + (Number(q.marks) || 1), 0);
    if (before?.questionCount !== questions.length) repair.questionCount = questions.length;
    if (before?.totalMarks !== totalMarks) repair.totalMarks = totalMarks;
  }

  await updateDocById<Quiz>(COLLECTIONS.quizzes, quizId, { status, ...repair });
  void audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.quizzes,
    documentId: quizId,
    summary: `Quiz status set to ${status}`,
  });

  if (status !== 'published' || !before) return { students: null };

  // Announced here rather than on create, because an assignment is created as a
  // draft and only becomes something a student can open at this moment.
  // Reopening a closed assignment counts as an update, not as a new one.
  void announce(
    {
      kind: 'assignment',
      title: before.title,
      classId: before.classId,
      route: `/(student)/quiz/${quizId}`,
      isUpdate: before.status === 'closed',
    },
    actor
  );

  /*
   * HOW MANY PEOPLE CAN ACTUALLY SEE IT. An assignment belongs to one class
   * group, and students are only ever in the gendered groups — so an assignment
   * created for a leftover group reaches nobody at all, publishes without a word
   * of complaint, and looks from the outside exactly like an app that does not
   * publish assignments. This is what says so out loud.
   */
  return {
    students: await countWhere(COLLECTIONS.users, [
      ['role', '==', 'student'],
      ['classId', '==', before.classId],
      ['status', '==', 'active'],
    ]).catch(() => null),
  };
}

/**
 * A copy of an assignment — questions and answer key included — as a draft.
 *
 * WHY THIS EXISTS. An assignment is given to one class group, and the centre's
 * adults are two groups: male and female. The same weekly assignment therefore
 * has to exist twice, and re-typing ten questions to manage that is how a week
 * gets skipped. The copy is a draft in the same group: open it, change the
 * group, publish. Nothing is announced to anybody until that publish.
 */
export async function duplicateQuiz(
  quizId: string,
  actor: AppUser,
  title?: string
): Promise<string> {
  const source = await getQuiz(quizId);
  if (!source) throw new AppError('errors.notFound', 'not-found');

  const [questions, keys] = await Promise.all([
    listQuestions(quizId),
    getDocs(collection(db, answerKeyPath(quizId))),
  ]);
  const correctFor = new Map<string, number>(
    keys.docs.map((key) => [key.id, Number(key.data().correctIndex)])
  );
  // A copy whose answer key is incomplete would mark honest answers wrong, and
  // nothing on screen would show it. Refuse rather than guess at zero.
  if (questions.some((question) => !correctFor.has(question.id))) {
    throw new AppError('errors.generic', 'failed-precondition');
  }

  const totalMarks = questions.reduce((sum, q) => sum + (Number(q.marks) || 1), 0);
  const newId = await createDoc(
    COLLECTIONS.quizzes,
    {
      title: title ?? `${source.title} (copy)`,
      description: source.description ?? '',
      classId: source.classId,
      branchId: source.branchId ?? null,
      teacherId: actor.role === 'teacher' ? actor.uid : (source.teacherId ?? null),
      language: source.language,
      timeLimit: source.timeLimit ?? 0,
      passMark: source.passMark ?? 50,
      maxAttempts: source.maxAttempts ?? 1,
      questionCount: questions.length,
      totalMarks,
      status: 'draft' as const,
    },
    { actorId: actor.uid }
  );

  const batch = writeBatch(db);
  questions.forEach((question, index) => {
    const id = doc(collection(db, questionsPath(newId))).id;
    batch.set(doc(db, questionsPath(newId), id), {
      quizId: newId,
      text: question.text,
      options: question.options,
      marks: Number(question.marks) || 1,
      order: index,
      explanation: question.explanation ?? null,
      deleted: false,
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, answerKeyPath(newId), id), {
      quizId: newId,
      correctIndex: correctFor.get(question.id) ?? 0,
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();

  void audit.log({
    actor,
    action: 'CREATE',
    collection: COLLECTIONS.quizzes,
    documentId: newId,
    summary: `Copied quiz "${source.title}" with ${questions.length} question(s)`,
  });
  return newId;
}

export async function deleteQuiz(quizId: string, actor: AppUser): Promise<void> {
  const before = await getQuiz(quizId);
  await softDelete(COLLECTIONS.quizzes, quizId, actor.uid);
  void audit.log({
    actor,
    action: 'DELETE',
    collection: COLLECTIONS.quizzes,
    documentId: quizId,
    summary: `Removed quiz "${before?.title ?? quizId}"`,
  });
}

// --- Questions -------------------------------------------------------------

/** Question as authored, including the correct answer. Teachers/admins only. */
export interface QuestionDraft {
  id?: string;
  text: string;
  options: string[];
  correctIndex: number;
  marks: number;
  explanation?: string;
}

/** Student-facing questions: no `correctIndex` field exists on these documents. */
export async function listQuestions(quizId: string): Promise<Question[]> {
  const snap = await getDocs(query(collection(db, questionsPath(quizId)), orderBy('order', 'asc')));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as Question);
}

/** Merges questions with the answer key. Requires read access to `answerKey`. */
export async function listQuestionsWithAnswers(quizId: string): Promise<QuestionDraft[]> {
  const [questions, keySnap] = await Promise.all([
    listQuestions(quizId),
    getDocs(collection(db, answerKeyPath(quizId))),
  ]);
  const key = new Map<string, number>();
  for (const d of keySnap.docs) key.set(d.id, (d.data().correctIndex as number) ?? -1);

  return questions.map((q) => ({
    id: q.id,
    text: q.text,
    options: q.options,
    marks: q.marks,
    explanation: q.explanation,
    correctIndex: key.get(q.id) ?? -1,
  }));
}

/**
 * Replaces the whole question set in one batch, keeping the question documents
 * and the answer key in sync and updating the quiz totals.
 */
export async function saveQuestions(
  quizId: string,
  drafts: QuestionDraft[],
  actor: AppUser
): Promise<void> {
  if (drafts.length === 0) throw new AppError('validation.minOneQuestion', 'failed-precondition');

  for (const draft of drafts) {
    if (draft.options.filter((o) => o.trim()).length < 2) {
      throw new AppError('validation.needTwoOptions', 'failed-precondition');
    }
    if (draft.correctIndex < 0 || draft.correctIndex >= draft.options.length) {
      throw new AppError('validation.selectCorrectAnswer', 'failed-precondition');
    }
  }

  const existing = await listQuestions(quizId);
  const keepIds = new Set(drafts.map((d) => d.id).filter(Boolean) as string[]);

  const batch = writeBatch(db);

  // Remove questions the author deleted, key included.
  for (const q of existing) {
    if (!keepIds.has(q.id)) {
      batch.delete(doc(db, questionsPath(quizId), q.id));
      batch.delete(doc(db, answerKeyPath(quizId), q.id));
    }
  }

  let totalMarks = 0;
  drafts.forEach((draft, index) => {
    const id = draft.id ?? doc(collection(db, questionsPath(quizId))).id;
    const marks = Number(draft.marks) || 1;
    totalMarks += marks;

    batch.set(doc(db, questionsPath(quizId), id), {
      quizId,
      text: draft.text.trim(),
      options: draft.options.map((o) => o.trim()).filter(Boolean),
      marks,
      order: index,
      explanation: draft.explanation ?? null,
      deleted: false,
      updatedAt: serverTimestamp(),
    });

    batch.set(doc(db, answerKeyPath(quizId), id), {
      quizId,
      correctIndex: draft.correctIndex,
      updatedAt: serverTimestamp(),
    });
  });

  batch.update(doc(db, COLLECTIONS.quizzes, quizId), {
    questionCount: drafts.length,
    totalMarks,
    updatedAt: serverTimestamp(),
  });

  await batch.commit();

  void audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.quizzes,
    documentId: quizId,
    summary: `Saved ${drafts.length} question(s), ${totalMarks} total marks`,
  });
}

// --- Taking a quiz ---------------------------------------------------------

export async function attemptsByStudent(quizId: string, studentId: string): Promise<QuizAttempt[]> {
  return listAll<QuizAttempt>(COLLECTIONS.quizAttempts, {
    filters: [
      ['quizId', '==', quizId],
      ['studentId', '==', studentId],
    ],
    orderByField: 'attemptNumber',
    direction: 'desc',
    pageSize: 20,
  });
}

export interface StartResult {
  attempt: QuizAttempt;
  questions: Question[];
  quiz: Quiz;
}

/** Opens (or resumes) an attempt after checking the quiz is actually takeable. */
export async function startAttempt(quizId: string, student: AppUser): Promise<StartResult> {
  const quiz = await getQuiz(quizId);
  if (!quiz) throw new AppError('errors.notFound', 'not-found');
  if (quiz.status !== 'published') throw new AppError('quiz.closed', 'failed-precondition');

  const previous = await attemptsByStudent(quizId, student.uid);
  const inProgress = previous.find((a) => a.status === 'in_progress');
  const questions = await listQuestions(quizId);

  if (inProgress) return { attempt: inProgress, questions, quiz };

  const submittedCount = previous.filter((a) => a.status === 'submitted').length;
  if (quiz.maxAttempts > 0 && submittedCount >= quiz.maxAttempts) {
    throw new AppError('quiz.noAttemptsLeft', 'failed-precondition');
  }

  const attemptNumber = submittedCount + 1;
  const attemptId = `${quizId}_${student.uid}_${attemptNumber}`;

  const data = {
    quizId,
    quizTitle: quiz.title,
    studentId: student.uid,
    studentName: student.fullName,
    classId: quiz.classId,
    answers: {},
    attemptNumber,
    status: 'in_progress' as const,
    startedAt: serverTimestamp(),
    deleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: student.uid,
  };

  await setDoc(doc(db, COLLECTIONS.quizAttempts, attemptId), data);

  return {
    attempt: { id: attemptId, ...data, startedAt: new Date() } as unknown as QuizAttempt,
    questions,
    quiz,
  };
}

/** Saves progress mid-quiz so a dropped connection does not lose answers. */
export async function saveProgress(
  attemptId: string,
  answers: Record<string, number>
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.quizAttempts, attemptId), {
    answers,
    updatedAt: serverTimestamp(),
  });
}

export interface Graded {
  result: Omit<Result, 'id'>;
  /** Per-question breakdown for the review screen. */
  breakdown: {
    questionId: string;
    correctIndex: number;
    givenIndex: number | null;
    correct: boolean;
    marks: number;
  }[];
}

/**
 * Submits and grades an attempt.
 *
 * Order matters: the attempt is marked `submitted` *first*, because that is
 * what unlocks the answer key for this student under the security rules.
 */
export async function submitAttempt(
  attemptId: string,
  answers: Record<string, number>,
  student: AppUser
): Promise<Graded> {
  const attemptRef = doc(db, COLLECTIONS.quizAttempts, attemptId);
  const attemptSnap = await getDoc(attemptRef);
  if (!attemptSnap.exists()) throw new AppError('errors.notFound', 'not-found');

  const attempt = { id: attemptSnap.id, ...(attemptSnap.data() as object) } as QuizAttempt;
  if (attempt.studentId !== student.uid) {
    throw new AppError('errors.permissionDenied', 'permission-denied');
  }

  await updateDoc(attemptRef, {
    answers,
    status: 'submitted',
    submittedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const [quiz, questions, keySnap] = await Promise.all([
    getQuiz(attempt.quizId),
    listQuestions(attempt.quizId),
    getDocs(collection(db, answerKeyPath(attempt.quizId))),
  ]);

  const key = new Map<string, number>();
  for (const d of keySnap.docs) key.set(d.id, (d.data().correctIndex as number) ?? -1);

  let score = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;
  const breakdown: Graded['breakdown'] = [];

  for (const question of questions) {
    const given = answers[question.id];
    const correctIndex = key.get(question.id) ?? -1;
    const answered = typeof given === 'number';
    const correct = answered && given === correctIndex;

    if (!answered) unansweredCount += 1;
    else if (correct) {
      correctCount += 1;
      score += question.marks;
    } else wrongCount += 1;

    breakdown.push({
      questionId: question.id,
      correctIndex,
      givenIndex: answered ? given : null,
      correct,
      marks: question.marks,
    });
  }

  const totalMarks = questions.reduce((sum, q) => sum + q.marks, 0) || 1;
  const percentage = Math.round((score / totalMarks) * 1000) / 10;
  const passMark = quiz?.passMark ?? 50;

  const result: Omit<Result, 'id'> = {
    attemptId,
    quizId: attempt.quizId,
    quizTitle: attempt.quizTitle,
    studentId: student.uid,
    studentName: student.fullName,
    classId: attempt.classId,
    branchId: student.branchId ?? null,
    score,
    totalMarks,
    percentage,
    correctCount,
    wrongCount,
    unansweredCount,
    grade: gradeFor(percentage),
    passed: percentage >= passMark,
    completedAt: new Date(),
  };

  // Deterministic id: one result per attempt, so a retry cannot duplicate it.
  await setDoc(doc(db, COLLECTIONS.results, attemptId), {
    ...result,
    completedAt: serverTimestamp(),
    deleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: student.uid,
  });

  return { result, breakdown };
}

// --- Results ---------------------------------------------------------------

export function listResults(options: {
  studentId?: string;
  classId?: string;
  quizId?: string;
  cursor?: Cursor;
  pageSize?: number;
} = {}): Promise<Page<Result>> {
  return listPage<Result>(COLLECTIONS.results, {
    filters: [
      options.studentId ? ['studentId', '==', options.studentId] : null,
      options.classId ? ['classId', '==', options.classId] : null,
      options.quizId ? ['quizId', '==', options.quizId] : null,
    ],
    orderByField: 'completedAt',
    direction: 'desc',
    cursor: options.cursor ?? null,
    pageSize: options.pageSize,
  });
}

export function getResult(id: string): Promise<Result | null> {
  return getById<Result>(COLLECTIONS.results, id);
}

/** Teacher/admin override, e.g. after a disputed question. */
export async function adjustResult(
  resultId: string,
  score: number,
  actor: AppUser
): Promise<void> {
  const before = await getResult(resultId);
  if (!before) throw new AppError('errors.notFound', 'not-found');

  const percentage = Math.round((score / (before.totalMarks || 1)) * 1000) / 10;
  await updateDocById<Result>(COLLECTIONS.results, resultId, {
    score,
    percentage,
    grade: gradeFor(percentage),
    passed: percentage >= 50,
  });

  void audit.log({
    actor,
    action: 'UPDATE',
    collection: COLLECTIONS.results,
    documentId: resultId,
    summary: `Adjusted result for ${before.studentName}: ${before.score} -> ${score}`,
    changes: { score: { from: before.score, to: score } },
  });
}

export function summariseResults(results: Result[]): {
  count: number;
  average: number;
  best: number;
  passRate: number;
} {
  if (results.length === 0) return { count: 0, average: 0, best: 0, passRate: 0 };
  const total = results.reduce((sum, r) => sum + r.percentage, 0);
  const best = results.reduce((max, r) => Math.max(max, r.percentage), 0);
  const passed = results.filter((r) => r.passed).length;
  return {
    count: results.length,
    average: Math.round((total / results.length) * 10) / 10,
    best,
    passRate: Math.round((passed / results.length) * 1000) / 10,
  };
}

/** Quizzes a student can currently take, with their attempt state attached. */
export async function availableForStudent(
  classId: string,
  studentId: string
): Promise<{ quiz: Quiz; attemptsUsed: number; lastResultId: string | null }[]> {
  const page = await listQuizzes({ classId, status: 'published', pageSize: 30 });
  const enriched = await Promise.all(
    page.items.map(async (quiz) => {
      const attempts = await attemptsByStudent(quiz.id, studentId);
      const submitted = attempts.filter((a) => a.status === 'submitted');
      return {
        quiz,
        attemptsUsed: submitted.length,
        lastResultId: submitted[0]?.id ?? null,
      };
    })
  );
  return enriched;
}
