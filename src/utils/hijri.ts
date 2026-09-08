import type { CalendarSystem, LanguageCode } from '@/types';

/**
 * The Islamic calendar, alongside or instead of the Gregorian one.
 *
 * For a dawah centre this is not decoration. Ramadan, the two Eids, the Hajj
 * dates and the fasts of Dhul-Hijjah are all fixed in Hijri months and drift
 * through the Gregorian year, so "the class before Ramadan" is a Hijri fact
 * that a Gregorian date answers only by accident.
 *
 * Which one is shown is an organisation-wide setting rather than a per-person
 * one, because a date on a poster, a ticket and a lesson card has to be the
 * same date in every conversation about it.
 *
 * TWO IMPLEMENTATIONS, and the difference matters:
 *
 *   Intl with the `islamic-umalqura` calendar is used wherever the platform
 *   has it. That is the Umm al-Qura calendar Saudi Arabia actually prints,
 *   which is what the people using this app will have on the wall.
 *
 *   Where Intl cannot do it — an older React Native runtime with a trimmed
 *   ICU — the tabular arithmetic below stands in. Measured against ICU over
 *   six years it lands on the same day about half the time and is never more
 *   than two days out.
 *
 * Those two days matter, so they are never hidden: `isApproximate` says which
 * one answered, and the screens showing a Hijri date say so when it came from
 * the fallback. A date that might be a day or two out is useful. A date that
 * might be a day or two out while claiming to be exact is not.
 *
 * Neither is a moon sighting, and nothing here should be read as one. The
 * beginning of a month is declared by people looking at the sky, and no
 * calculation replaces that ruling.
 */

export type { CalendarSystem };

export interface HijriDate {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
  /** True when this came from the tabular fallback rather than from Intl. */
  isApproximate: boolean;
}

/**
 * Month names, transliterated, for the fallback path only.
 *
 * Proper nouns rather than translatable strings: a Tamil or Sinhala speaker
 * reading an Islamic date says "Ramadan", not a translated equivalent, and
 * inventing one would be less recognisable rather than more. Arabic gets the
 * Arabic script because that is how it is written, not a transliteration of
 * itself.
 */
const MONTHS_LATIN = [
  'Muharram',
  'Safar',
  "Rabi' al-Awwal",
  "Rabi' al-Thani",
  'Jumada al-Ula',
  'Jumada al-Akhirah',
  'Rajab',
  "Sha'ban",
  'Ramadan',
  'Shawwal',
  "Dhu al-Qi'dah",
  'Dhu al-Hijjah',
];

const MONTHS_SHORT_LATIN = [
  'Muh',
  'Saf',
  'Rab I',
  'Rab II',
  'Jum I',
  'Jum II',
  'Raj',
  'Sha',
  'Ram',
  'Shw',
  'Qid',
  'Hij',
];

const MONTHS_ARABIC = [
  'محرم',
  'صفر',
  'ربيع الأول',
  'ربيع الآخر',
  'جمادى الأولى',
  'جمادى الآخرة',
  'رجب',
  'شعبان',
  'رمضان',
  'شوال',
  'ذو القعدة',
  'ذو الحجة',
];

// --------------------------------------------------------------- Intl path

/**
 * Whether this runtime can produce Umm al-Qura dates, decided once.
 *
 * Probed by conversion rather than by feature detection: a runtime can have
 * `Intl.DateTimeFormat` and still silently ignore the calendar extension,
 * handing back a Gregorian date that looks like an answer. Converting a known
 * date and checking the year is in the Hijri range catches that.
 */
let intlWorks: boolean | null = null;

function canUseIntl(): boolean {
  if (intlWorks !== null) return intlWorks;
  try {
    const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).formatToParts(new Date(Date.UTC(2024, 0, 1)));
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    // 1 January 2024 is in 1445. Anything near 2024 means the calendar
    // extension was ignored.
    intlWorks = year > 1300 && year < 1600;
  } catch {
    intlWorks = false;
  }
  return intlWorks;
}

// ----------------------------------------------------------- tabular path

/** Gregorian date to Julian Day Number. */
function toJulianDay(date: Date): number {
  let year = date.getFullYear();
  let month = date.getMonth() + 1;
  const day = date.getDate();

  if (month < 3) {
    year -= 1;
    month += 12;
  }
  const a = Math.floor(year / 100);
  const b = 2 - a + Math.floor(a / 4);

  return (
    Math.floor(365.25 * (year + 4716)) +
    Math.floor(30.6001 * (month + 1)) +
    day +
    b -
    1524.5
  );
}

/** First Julian Day of a tabular Islamic month. */
function islamicMonthStart(year: number, month: number): number {
  return (
    Math.ceil(29.5 * (month - 1)) +
    (year - 1) * 354 +
    Math.floor((3 + 11 * year) / 30) +
    1948439.5
  );
}

function tabularHijri(date: Date): HijriDate {
  const jd = Math.floor(toJulianDay(date)) + 0.5;
  const year = Math.floor((30 * (jd - 1948439.5) + 10646) / 10631);
  const month = Math.min(
    12,
    Math.ceil((jd - (29 + islamicMonthStart(year, 1))) / 29.5) + 1
  );
  const day = Math.round(jd - islamicMonthStart(year, month)) + 1;
  return { year, month, day, isApproximate: true };
}

// -------------------------------------------------------------------- api

/** The Hijri date for a Gregorian one. Never throws. */
export function toHijri(date: Date): HijriDate {
  if (canUseIntl()) {
    try {
      const parts = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
      }).formatToParts(date);
      const read = (type: string) =>
        Number(parts.find((part) => part.type === type)?.value);
      const year = read('year');
      const month = read('month');
      const day = read('day');
      if (year && month && day) return { year, month, day, isApproximate: false };
    } catch {
      // Fall through to the arithmetic rather than fail a date on a card.
    }
  }
  return tabularHijri(date);
}

/**
 * `12 Ramadan 1447`, in the reader's script where the runtime can manage it.
 *
 * `short` shortens the month, for the places a date sits beside a title in a
 * list rather than standing on its own.
 */
export function formatHijri(
  date: Date,
  locale: LanguageCode | string = 'en',
  short = false
): string {
  if (canUseIntl()) {
    try {
      return new Intl.DateTimeFormat(`${localeTag(locale)}-u-ca-islamic-umalqura`, {
        day: '2-digit',
        month: short ? 'short' : 'long',
        year: 'numeric',
      }).format(date);
    } catch {
      // Fall through.
    }
  }

  const hijri = tabularHijri(date);
  const names =
    String(locale).startsWith('ar')
      ? MONTHS_ARABIC
      : short
        ? MONTHS_SHORT_LATIN
        : MONTHS_LATIN;
  const month = names[hijri.month - 1] ?? String(hijri.month);
  return `${hijri.day} ${month} ${hijri.year} AH`;
}

/**
 * The app's four languages are plain language tags already; anything else is
 * passed through and Intl decides whether it knows it.
 */
function localeTag(locale: LanguageCode | string): string {
  return String(locale || 'en');
}

/** True when the Hijri dates on screen came from the arithmetic fallback. */
export function hijriIsApproximate(): boolean {
  return !canUseIntl();
}
