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

/** Returns the i18n key that best describes `error`. */
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
export function friendlyMessage(error: unknown, translate: (key: string) => string): string {
  if (error instanceof AppError && !error.userMessage.includes('.')) {
    return error.userMessage;
  }
  return translate(errorKey(error));
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
