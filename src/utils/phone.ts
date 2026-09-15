/**
 * Phone numbers: a country code picked from a list, and the number exactly as
 * the person typed it.
 *
 * WHY THE TWO ARE KEPT APART. A number used to be one free-text field, and the
 * unique key was its last nine digits. That happens to fit a Saudi or Sri Lankan
 * mobile and nothing else: an Indian mobile has ten digits, so two different
 * Indian numbers could share a key, and a UAE 050 number and a Saudi 050 number
 * with the same digits WERE the same key. Nobody could tell from "0567560387" on
 * a profile which country it belonged to, either.
 *
 * Now the code is chosen, the number keeps its leading zero, and the key is the
 * full international number without that zero:
 *
 *   +966 and 0567560387   ->   key 966567560387   ->   shown "+966 0567560387"
 *
 * No imports, on purpose: the migration script and the checks run this file
 * directly under Node.
 */

export interface DialCountry {
  /** ISO 3166-1 alpha-2, e.g. "SA". */
  iso: string;
  /** With the plus, e.g. "+966". */
  dial: string;
  flag: string;
  name: string;
}

/** The centre's own families first, then the Gulf and the region, then the rest. */
export const DIAL_COUNTRIES: DialCountry[] = [
  { iso: 'SA', dial: '+966', flag: '🇸🇦', name: 'Saudi Arabia' },
  { iso: 'LK', dial: '+94', flag: '🇱🇰', name: 'Sri Lanka' },
  { iso: 'IN', dial: '+91', flag: '🇮🇳', name: 'India' },
  { iso: 'AE', dial: '+971', flag: '🇦🇪', name: 'United Arab Emirates' },
  { iso: 'QA', dial: '+974', flag: '🇶🇦', name: 'Qatar' },
  { iso: 'KW', dial: '+965', flag: '🇰🇼', name: 'Kuwait' },
  { iso: 'BH', dial: '+973', flag: '🇧🇭', name: 'Bahrain' },
  { iso: 'OM', dial: '+968', flag: '🇴🇲', name: 'Oman' },
  { iso: 'PK', dial: '+92', flag: '🇵🇰', name: 'Pakistan' },
  { iso: 'BD', dial: '+880', flag: '🇧🇩', name: 'Bangladesh' },
  { iso: 'MV', dial: '+960', flag: '🇲🇻', name: 'Maldives' },
  { iso: 'NP', dial: '+977', flag: '🇳🇵', name: 'Nepal' },
  { iso: 'MY', dial: '+60', flag: '🇲🇾', name: 'Malaysia' },
  { iso: 'SG', dial: '+65', flag: '🇸🇬', name: 'Singapore' },
  { iso: 'ID', dial: '+62', flag: '🇮🇩', name: 'Indonesia' },
  { iso: 'PH', dial: '+63', flag: '🇵🇭', name: 'Philippines' },
  { iso: 'EG', dial: '+20', flag: '🇪🇬', name: 'Egypt' },
  { iso: 'JO', dial: '+962', flag: '🇯🇴', name: 'Jordan' },
  { iso: 'YE', dial: '+967', flag: '🇾🇪', name: 'Yemen' },
  { iso: 'SD', dial: '+249', flag: '🇸🇩', name: 'Sudan' },
  { iso: 'GB', dial: '+44', flag: '🇬🇧', name: 'United Kingdom' },
  { iso: 'US', dial: '+1', flag: '🇺🇸', name: 'United States / Canada' },
  { iso: 'AU', dial: '+61', flag: '🇦🇺', name: 'Australia' },
];

/** Jeddah. Every account that existed before country codes is a Saudi number. */
export const DEFAULT_DIAL = '+966';

/**
 * Countries whose numbers are eight digits after the code. Only used to decide
 * whether "97433123456", typed without a plus, carries its own country code.
 */
const EIGHT_DIGIT_CODES = new Set(['974', '973', '965', '968', '65']);

const digitsOf = (value?: string | null): string => String(value ?? '').replace(/[^0-9]/g, '');

/** Longest code first, so "+971…" is never read as a shorter code. */
const BY_LENGTH = [...DIAL_COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

/** "+966", "966" and "00966" all become "+966". Anything empty becomes the default. */
export function cleanDial(dial?: string | null): string {
  const digits = digitsOf(dial).replace(/^00/, '');
  return digits ? `+${digits}` : DEFAULT_DIAL;
}

export function countryForDial(dial?: string | null): DialCountry | undefined {
  const clean = cleanDial(dial);
  return DIAL_COUNTRIES.find((country) => country.dial === clean);
}

export function dialForCountry(iso?: string | null): string | undefined {
  const code = String(iso ?? '').trim().toUpperCase();
  return DIAL_COUNTRIES.find((country) => country.iso === code)?.dial;
}

/**
 * A number typed WITH its country code — "+966 50…" or "00966 50…" — split into
 * the code and the rest. Null when there is no international prefix, so the
 * caller keeps the code already chosen.
 */
export function splitInternational(
  text?: string | null
): { dial: string; national: string } | null {
  const trimmed = String(text ?? '').trim();
  if (!/^(\+|00)/.test(trimmed)) return null;
  const digits = digitsOf(trimmed).replace(/^00/, '');
  const match = BY_LENGTH.find((country) => digits.startsWith(digitsOf(country.dial)));
  if (!match) return null;
  return { dial: match.dial, national: digits.slice(digitsOf(match.dial).length) };
}

/** Country code digits, and the number without its trunk zero. */
export function phoneParts(
  mobile?: string | null,
  dial?: string | null
): { code: string; number: string } {
  const intl = splitInternational(mobile);
  const code = digitsOf(intl ? intl.dial : cleanDial(dial));
  let number = digitsOf(intl ? intl.national : mobile).replace(/^0+/, '');

  // Typed with the country code but no plus: "966567560387". Stripped only when
  // what remains is still a whole number, so an Indian mobile that happens to
  // begin with 91 is not cut short.
  const wholeNumber = EIGHT_DIGIT_CODES.has(code) ? 8 : 9;
  if (!intl && number.startsWith(code) && number.length - code.length >= wholeNumber) {
    number = number.slice(code.length);
  }
  return { code, number };
}

/** The unique key for a phone, e.g. "966567560387". Empty when there is no number. */
export function phoneKey(mobile?: string | null, dial?: string | null): string {
  const { code, number } = phoneParts(mobile, dial);
  return number ? `${code}${number}` : '';
}

/** "+966567560387", for tel: and WhatsApp links. */
export function toE164(mobile?: string | null, dial?: string | null): string {
  const key = phoneKey(mobile, dial);
  return key ? `+${key}` : '';
}

/**
 * The key used before country codes existed: the last nine digits.
 *
 * Read only as a fallback when signing in, so an index row written by an
 * out-of-date copy of the app still finds its account. Never written.
 */
export function legacyPhoneKey(mobile?: string | null): string {
  const digits = digitsOf(mobile);
  return digits.length > 9 ? digits.slice(-9) : digits;
}

/** How a number is shown: "+966 0567560387", the number exactly as given. */
export function formatPhone(mobile?: string | null, dial?: string | null): string {
  const raw = String(mobile ?? '').trim();
  if (!raw) return '';
  if (/^(\+|00)/.test(raw)) return raw;
  return `${cleanDial(dial)} ${raw}`;
}

/** True when text typed into a sign-in or search box is a phone number, not a name. */
export function looksLikePhone(text?: string | null): boolean {
  const trimmed = String(text ?? '').trim();
  return /^[+0-9\s()-]+$/.test(trimmed) && digitsOf(trimmed).length >= 4;
}

/**
 * Every form somebody might type to find this number in an admin search box:
 * as saved (0567560387), without the zero (567560387), with it (0567560387),
 * and international (966567560387). The index stores prefixes of each.
 */
export function phoneSearchForms(mobile?: string | null, dial?: string | null): string[] {
  const { code, number } = phoneParts(mobile, dial);
  if (!number) return [];
  const typed = digitsOf(splitInternational(mobile)?.national ?? mobile);
  return Array.from(new Set([typed, number, `0${number}`, `${code}${number}`].filter(Boolean)));
}

/** A search term that is a phone number, reduced to digits the index holds. Null otherwise. */
export function phoneSearchTerm(term: string): string | null {
  if (!looksLikePhone(term)) return null;
  const intl = splitInternational(term);
  const digits = intl
    ? `${digitsOf(intl.dial)}${digitsOf(intl.national).replace(/^0+/, '')}`
    : digitsOf(term).replace(/^00/, '');
  // The index keeps prefixes up to twelve characters long.
  return digits.slice(0, 12);
}
