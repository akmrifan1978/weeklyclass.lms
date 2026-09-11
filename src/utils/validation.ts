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

/**
 * Six characters, and nothing else prescribed.
 *
 * Six is also Firebase Authentication's own floor, so this is as low as the
 * minimum can go without the form accepting a password the server then
 * refuses.
 *
 * The letter-and-digit rule went because composition rules do not buy what they
 * appear to: they rule out a long passphrase somebody can actually remember
 * while permitting "Passw0rd", and the predictable response to them is a digit
 * bolted onto the end of the same weak word. Length is the property that
 * actually costs an attacker something, and Firebase Authentication is what
 * stands between a password and an account regardless.
 */
export const passwordSchema = z.string().min(6, 'validation.passwordTooShort');

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

/**
 * Account recovery takes whatever identifier someone remembers. A mobile number
 * is the one that always works: it is the unique identity, while an address may
 * be shared between family members.
 */
export const recoverySchema = z
  .string()
  .trim()
  .min(3, 'validation.identifierRequired');

export const loginSchema = z.object({
  /** Accepts a mobile number, a username or an email address. */
  identifier: z.string().trim().min(1, 'validation.identifierRequired'),
  password: z.string().min(1, 'validation.passwordRequired'),
});

const baseRegistration = {
  fullName: fullNameSchema,
  username: usernameSchema,
  /**
   * Required, by the centre's decision.
   *
   * It was optional, and an account without one signed in at a mobile-derived
   * address instead. That worked, but it made the commonest failure
   * incomprehensible: a student who typed no address at all was told "an
   * account already exists with this email address", because the synthetic
   * address is an email as far as Firebase is concerned.
   *
   * An address also gives back the one thing an account without one cannot
   * have: a password reset that actually reaches somebody.
   *
   * The cost is real and should be understood — a student with no address
   * cannot register themselves and needs an admin to add them from the Users
   * screen, which does not go through this schema.
   */
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
    // Optional: an admin adding a teacher in a hurry knows who they are and can
    // fill in the credential later, and a blank field is honest where a typed
    // placeholder is not.
    qualification: z.string().trim().optional(),
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
/**
 * A WhatsApp GROUP invite link, or nothing.
 *
 * Only `chat.whatsapp.com` links are accepted, and deliberately so. The obvious
 * mistake here is pasting a `wa.me/<number>` link, which is a private chat with
 * whoever set the event up — handing every attendee an organiser's personal
 * number instead of a group. That is a mistake worth refusing rather than
 * storing, so this returns null and the form says why.
 *
 * Returns the trimmed link when it is one, null when the field is empty, and
 * throws nothing: the caller decides whether an unusable value is an error or
 * simply an empty field.
 */
export function whatsappGroupLink(value: string): { link: string | null; invalid: boolean } {
  const trimmed = value.trim();
  if (!trimmed) return { link: null, invalid: false };

  try {
    const url = new URL(trimmed);
    const ok =
      url.protocol === 'https:' &&
      url.hostname.toLowerCase() === 'chat.whatsapp.com' &&
      url.pathname.replace(/\/+$/, '').length > 1;
    return ok ? { link: trimmed, invalid: false } : { link: null, invalid: true };
  } catch {
    return { link: null, invalid: true };
  }
}

export function sanitiseDocId(value: string): string {
  return value.trim().replace(/[/\\.#$[\]]/g, '_').slice(0, 120);
}
