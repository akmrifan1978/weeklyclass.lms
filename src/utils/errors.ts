import { FirebaseError } from 'firebase/app';

/**
 * Turns raw Firebase errors into messages a student or teacher can act on.
 * Raw codes are never shown to end users — they go to the console/analytics.
 */

export class AppError extends Error {
  readonly code: string;
  readonly userMessage: string;

  constructor(userMessage: string, code = 'app/unknown', cause?: unknown) {
    super(userMessage);
    this.name = 'AppError';
    this.code = code;
    this.userMessage = userMessage;
    if (cause instanceof Error) this.stack = cause.stack;
  }
}

/** i18n keys, resolved by the caller through `t()`. */
const FIREBASE_ERROR_KEYS: Record<string, string> = {
  'auth/invalid-email': 'errors.invalidEmail',
  'auth/user-disabled': 'errors.accountDisabled',
  'auth/user-not-found': 'errors.invalidCredentials',
  'auth/wrong-password': 'errors.invalidCredentials',
  'auth/invalid-credential': 'errors.invalidCredentials',
  'auth/invalid-login-credentials': 'errors.invalidCredentials',
  'auth/email-already-in-use': 'errors.emailInUse',
  // Should no longer reach anyone — an account with no address now gets a
  // mobile-derived one — but a code that arrives unmapped is shown as "something
  // went wrong", which tells whoever hit it nothing at all.
  'auth/missing-email': 'errors.emailOrMobileNeeded',
  'auth/weak-password': 'errors.weakPassword',
  'auth/too-many-requests': 'errors.tooManyRequests',
  'auth/network-request-failed': 'errors.networkUnavailable',
  'auth/requires-recent-login': 'errors.sessionExpired',
  'auth/operation-not-allowed': 'errors.operationNotAllowed',
  'auth/missing-password': 'errors.passwordRequired',
  'permission-denied': 'errors.permissionDenied',
  unauthenticated: 'errors.sessionExpired',
  unavailable: 'errors.networkUnavailable',
  'deadline-exceeded': 'errors.networkUnavailable',
  'not-found': 'errors.notFound',
  'already-exists': 'errors.alreadyExists',
  'resource-exhausted': 'errors.quotaExceeded',
  'failed-precondition': 'errors.failedPrecondition',
  cancelled: 'errors.cancelled',
  'storage/unauthorized': 'errors.permissionDenied',
  'storage/canceled': 'errors.uploadCancelled',
  'storage/quota-exceeded': 'errors.quotaExceeded',
  'storage/retry-limit-exceeded': 'errors.uploadFailed',
  'storage/unknown': 'errors.uploadFailed',
  'storage/object-not-found': 'errors.notFound',
};

/**
 * Returns the i18n key that best describes `error`.
 *
 * A key may carry a detail after a pipe — `errors.fileTooLarge|2 MB` — which
 * `friendlyMessage` splits out and interpolates as {{detail}}.
 */
export function errorKey(error: unknown): string {
  if (error instanceof AppError) return error.userMessage;
  if (error instanceof FirebaseError) {
    return FIREBASE_ERROR_KEYS[error.code] ?? 'errors.generic';
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = String((error as { code: unknown }).code);
    return FIREBASE_ERROR_KEYS[code] ?? 'errors.generic';
  }
  if (error instanceof Error && /network|fetch|timeout/i.test(error.message)) {
    return 'errors.networkUnavailable';
  }
  return 'errors.generic';
}

/**
 * Resolves an error to a display string.
 * @param translate usually the `t` function from `useTranslation()`.
 */
export function friendlyMessage(
  error: unknown,
  translate: (key: string, options?: Record<string, unknown>) => string
): string {
  const raw = errorKey(error);

  // Keys may carry a detail after a pipe. Splitting it out here is what makes
  // "the file is too large (2 MB)" and "denied: countries/LK" possible without
  // every call site having to know about interpolation.
  const separator = raw.indexOf('|');
  const key = separator === -1 ? raw : raw.slice(0, separator);
  const detail = separator === -1 ? undefined : raw.slice(separator + 1);

  // An unrecognised failure becomes the generic "something went wrong", which
  // is right for the user and useless for whoever has to fix it. Log the real
  // error so it is never invisible — a mismapped code should cost one glance at
  // the console, not a debugging session.
  if (key === 'errors.generic' && error) {
    console.error('[WeeklyClass] unmapped error surfaced to the user:', error);
  }

  if (error instanceof AppError && !key.includes('.')) {
    return error.userMessage;
  }
  return translate(key, detail ? { detail } : undefined);
}

/**
 * Wraps a Firestore call so a refusal says WHICH document was refused.
 *
 * Firestore reports every denial as the same bare "Missing or insufficient
 * permissions", with no path attached. That single opaque sentence is the
 * hardest thing to debug in this whole app: it is indistinguishable whether the
 * rules are wrong, the caller's profile is missing, its role is misspelt, or the
 * auth token had not arrived yet. Naming the collection and document turns it
 * into a question with one answer.
 */
export async function denialContext<T>(
  operation: string,
  target: string,
  run: () => Promise<T>
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if ((error as { code?: string })?.code !== 'permission-denied') throw error;
    console.error(`[WeeklyClass] DENIED: ${operation} ${target}`, error);
    throw new AppError(
      `errors.permissionDeniedAt|${operation} ${target}`,
      'permission-denied',
      error instanceof Error ? error : undefined
    );
  }
}

export function isPermissionDenied(error: unknown): boolean {
  return (
    (error instanceof FirebaseError && error.code === 'permission-denied') ||
    (error instanceof AppError && error.code === 'permission-denied')
  );
}

export function isOffline(error: unknown): boolean {
  return errorKey(error) === 'errors.networkUnavailable';
}
