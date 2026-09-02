import { z } from 'zod';
import { LANGUAGES } from '@/constants/app';

const languageCodes = LANGUAGES.map((l) => l.code) as [string, ...string[]];

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4, 'validation.usernameTooShort')
  .max(24, 'validation.usernameTooLong')
  .regex(/^[a-z0-9._-]+$/, 'validation.usernameFormat');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'validation.emailRequired')
  .email('validation.emailInvalid');

/** 8+ chars with at least one letter and one digit — enforced client and rules side. */
export const passwordSchema = z
  .string()
  .min(8, 'validation.passwordTooShort')
  .regex(/[A-Za-z]/, 'validation.passwordNeedsLetter')
  .regex(/[0-9]/, 'validation.passwordNeedsNumber');

export const mobileSchema = z
  .string()
  .trim()
  .min(6, 'validation.mobileInvalid')
  .max(20, 'validation.mobileInvalid')
  .regex(/^[+]?[0-9\s()-]+$/, 'validation.mobileInvalid');

export const fullNameSchema = z
  .string()
  .trim()
  .min(2, 'validation.nameRequired')
  .max(80, 'validation.nameTooLong');

export const loginSchema = z.object({
  /** Accepts either an email address or a username. */
  identifier: z.string().trim().min(1, 'validation.identifierRequired'),
  password: z.string().min(1, 'validation.passwordRequired'),
});

const baseRegistration = {
  fullName: fullNameSchema,
  username: usernameSchema,
  email: emailSchema,
  mobile: mobileSchema,
  country: z.string().trim().min(1, 'validation.countryRequired'),
  language: z.enum(languageCodes),
  password: passwordSchema,
  confirmPassword: z.string(),
};

export const studentRegistrationSchema = z
  .object({
    ...baseRegistration,
    dateOfBirth: z.string().trim().min(1, 'validation.dobRequired'),
    gender: z.enum(['male', 'female']).nullable().optional(),
    branchId: z.string().trim().optional().nullable(),
    classId: z.string().trim().optional().nullable(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'validation.passwordsDoNotMatch',
    path: ['confirmPassword'],
  });

export const teacherRegistrationSchema = z
  .object({
    ...baseRegistration,
    qualification: z.string().trim().min(2, 'validation.qualificationRequired'),
    branchId: z.string().trim().optional().nullable(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'validation.passwordsDoNotMatch',
    path: ['confirmPassword'],
  });

export type LoginInput = z.infer<typeof loginSchema>;
export type StudentRegistrationInput = z.infer<typeof studentRegistrationSchema>;
export type TeacherRegistrationInput = z.infer<typeof teacherRegistrationSchema>;

/**
 * Flattens a Zod error into `{ field: i18nKey }` for inline form messages.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    if (!result[key]) result[key] = issue.message;
  }
  return result;
}

/** Runs a schema and returns either parsed data or per-field i18n keys. */
export function validate<T extends z.ZodTypeAny>(
  schema: T,
  value: unknown
): { ok: true; data: z.infer<T> } | { ok: false; errors: Record<string, string> } {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, errors: fieldErrors(parsed.error) };
}

export function isEmail(value: string): boolean {
  return emailSchema.safeParse(value).success;
}

/** Strips characters that would break a Firestore document id. */
export function sanitiseDocId(value: string): string {
  return value.trim().replace(/[/\\.#$[\]]/g, '_').slice(0, 120);
}
