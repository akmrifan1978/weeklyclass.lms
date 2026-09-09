import AsyncStorage from '@react-native-async-storage/async-storage';

import { AppError } from '@/utils/errors';
import type { LanguageCode } from '@/types';

/**
 * Hadith, from the open fawazahmed0/hadith-api dataset on jsDelivr.
 *
 * Free, key-less and served from a CDN — the standing no-billing constraint.
 *
 * ON "AUTHENTIC": this app offers the collections whose authenticity is least
 * disputed — the two Ṣaḥīḥs first, then the remaining books of the Six, then the
 * two well-known forty-hadith compilations. That is not the same as vouching for
 * every narration: within the four Sunan, individual reports carry different
 * gradings, and this dataset does not include them. So each narration is shown
 * with its collection, book and number, which is what lets someone check it — and
 * the screen says which collections are the Ṣaḥīḥs rather than implying that
 * everything here carries the same weight.
 */

const CDN = 'https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1';
const CACHE_PREFIX = '@weeklyclass/hadith/';
const TIMEOUT_MS = 20_000;

export interface HadithCollection {
  id: string;
  name: string;
  /** True for Sahih al-Bukhari and Sahih Muslim. */
  sahih: boolean;
  /** Sections (books) available, by number. */
  sections: Record<string, string>;
  /**
   * True when this collection has an edition in the language asked for. Where
   * it is false the reader gets English beside the Arabic — and is told so on
   * the list, rather than discovering it after opening the book.
   */
  translated: boolean;
}

/**
 * The collections offered, in the order they are shown. The two Ṣaḥīḥs lead
 * because they are what someone looking for an authentic narration wants first.
 */
export const COLLECTIONS_ORDER = [
  'bukhari',
  'muslim',
  'nawawi',
  'qudsi',
  'abudawud',
  'tirmidhi',
  'nasai',
  'ibnmajah',
  'malik',
] as const;

export const SAHIH = new Set(['bukhari', 'muslim']);

/**
 * Published translation editions, per language and collection.
 *
 * English stands in where the reader's own language has no edition, and it is
 * ALWAYS named as English when it does. The rule this replaces refused any
 * substitute and showed the Arabic alone, to stop a reader mistaking one
 * translation for another. That concern was right; the remedy was too blunt.
 * Seven of the nine collections have no Tamil edition, so a Tamil reader was
 * being handed Arabic they may not read and nothing else, when a translation
 * they could read existed all along.
 *
 * What made the substitution dangerous was doing it silently. Saying which
 * language is on screen removes the danger and keeps the translation, so the
 * reader decides for themselves whether it is of use to them.
 *
 * These are published translations, which is what makes them approved. Nothing
 * here is generated, and nothing is machine-translated — a hadith rendered by
 * software is not a hadith anybody should be quoting.
 */
const EDITIONS: Record<LanguageCode, (collection: string) => string | null> = {
  // Arabic is not a translation; it is the text, and every collection has it.
  ar: () => null,
  ta: (c) => (TAMIL_AVAILABLE.has(c) ? `tam-${c}` : null),
  en: (c) => `eng-${c}`,
  // The dataset carries no Sinhala edition of any collection.
  si: () => null,
};

/*
 * Tamil exists for Bukhari and NOT for Muslim.
 *
 * Muslim was listed here because `tam-muslim` is a real file in the dataset. It
 * is an empty one — every section of it carries entries with no text at all,
 * checked across the whole collection. Claiming Tamil for it meant a Tamil
 * reader got the Arabic and nothing else, while the English translation that
 * would have helped them was never even offered, because the app believed it
 * had already found them something better.
 *
 * The runtime check below now catches this class of fault on its own, so this
 * list going stale again costs a wasted request rather than a missing
 * translation.
 */
const TAMIL_AVAILABLE = new Set(['bukhari']);

/** Named translators, so a reader can weigh the rendering they are given. */
const EDITION_SOURCE: Record<string, string> = {
  'tam-bukhari': 'Jan Trust Foundation',
  'tam-muslim': 'Jan Trust Foundation',
  'eng-bukhari': 'M. Muhsin Khan',
  'eng-muslim': 'Abdul Hamid Siddiqui',
};

export interface EditionChoice {
  edition: string | null;
  source?: string;
  /**
   * The language the edition is actually in, which is not always the one asked
   * for. Every screen showing this text is expected to say so.
   */
  language: LanguageCode | null;
  /** True when this is English standing in for a language with no edition. */
  isFallback: boolean;
}

/**
 * The best translation available for a reader, and which language it is in.
 *
 * Order: the reader's own language, then English, then nothing. Arabic is never
 * a fallback because it is never absent — it is the narration itself, shown
 * alongside whatever translation this returns.
 */
export function editionFor(collection: string, language: LanguageCode): EditionChoice {
  // An admin can add a language the app has no edition table for. Unknown means
  // no edition of its own, which is the safe answer rather than a crash.
  const own = EDITIONS[language]?.(collection) ?? null;
  if (own) {
    return { edition: own, source: EDITION_SOURCE[own], language, isFallback: false };
  }

  // Arabic readers are not offered an English stand-in: they can read the
  // narration itself, so a second language would be clutter rather than help.
  if (language === 'ar') {
    return { edition: null, language: null, isFallback: false };
  }

  const english = EDITIONS.en(collection);
  if (!english) return { edition: null, language: null, isFallback: false };
  return {
    edition: english,
    source: EDITION_SOURCE[english],
    language: 'en',
    isFallback: true,
  };
}

/**
 * True when this collection is published in the reader's OWN language.
 *
 * Deliberately not "is there anything to read" — the list uses this to mark
 * which collections carry a Tamil rendering and which fall back to English,
 * and a fallback must not be able to pass for the real thing.
 */
export function hasApprovedTranslation(
  collection: string,
  language: LanguageCode
): boolean {
  const choice = editionFor(collection, language);
  return choice.edition !== null && !choice.isFallback;
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new AppError('errors.notFound', 'hadith/missing');
    return (await response.json()) as T;
  } catch (error) {
    throw error instanceof AppError
      ? error
      : new AppError('errors.networkUnavailable', 'hadith/unreachable');
  } finally {
    clearTimeout(deadline);
  }
}

/** True when a section payload carries at least one non-empty narration. */
function hasAnyText(payload: { hadiths?: { text?: string }[] }): boolean {
  return (payload.hadiths ?? []).some((h) => (h.text ?? '').trim().length > 0);
}

interface EditionsPayload {
  [id: string]: {
    name: string;
    collection: { name: string; language: string }[];
  };
}

/** The collections, with their section (book) titles. Cached indefinitely. */
export async function listCollections(
  language: LanguageCode
): Promise<HadithCollection[]> {
  // Key is versioned: a list cached before `translated` existed would come back
  // without it, and an absent flag reads as "not translated" — mislabelling
  // every collection for anyone who had used the screen before this change.
  const cacheKey = `${CACHE_PREFIX}collections/${language}/v2`;
  const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached) as HadithCollection[];

  const editions = await fetchJson<EditionsPayload>(`${CDN}/editions.json`);

  const result: HadithCollection[] = COLLECTIONS_ORDER.filter(
    (id) => id in editions
  ).map((id) => ({
    id,
    name: editions[id].name,
    sahih: SAHIH.has(id),
    sections: {},
    translated: hasApprovedTranslation(id, language),
  }));

  void AsyncStorage.setItem(cacheKey, JSON.stringify(result)).catch(() => undefined);

  return result;
}

export interface Hadith {
  number: number;
  /** The Arabic narration. Always present, always shown, never altered. */
  arabic: string;
  /**
   * An approved translation, or null when none exists for this language.
   *
   * Null is the normal case for most collections in Tamil and for all of them
   * in Sinhala. It means the screen shows the Arabic alone — not English
   * standing in for the language that was asked for.
   */
  translation: string | null;
  /** `book:hadith` as printed, which is how a narration is cited. */
  reference: string;
}

export interface HadithSection {
  collection: string;
  collectionName: string;
  section: number;
  sectionName: string;
  hadiths: Hadith[];
  /** True when there is any translation on screen at all. */
  hasTranslation: boolean;
  /**
   * The language that translation is in. Not always the one asked for — see
   * editionFor — and the screen showing it has to say which.
   */
  translationLanguage: LanguageCode | null;
  /** True when English is standing in for a language with no edition. */
  isFallbackLanguage: boolean;
  /** Named translator of that edition, where known. */
  translationSource?: string;
  /** How many sections this collection has, for paging on. */
  sectionCount: number;
}

interface SectionPayload {
  metadata: {
    name: string;
    section: Record<string, string>;
    sections?: Record<string, string>;
  };
  hadiths: {
    hadithnumber: number;
    text: string;
    reference?: { book: number; hadith: number };
  }[];
}

/** One section (book) of a collection, in the closest available language. */
/** How far to look for a section with something in it before giving up. */
const MAX_EMPTY_SKIP = 6;

export async function getSection(
  collection: string,
  section: number,
  language: LanguageCode,
  /**
   * Move past sections that contain no narration.
   *
   * Sahih Muslim opens on an "Introduction" whose only entry has empty text,
   * and the two sections after it are the same. The screen opened every
   * collection at section 1, so Muslim looked broken — it was reported as not
   * appearing at all — while Bukhari, whose section 1 is Revelation with seven
   * narrations, was fine.
   *
   * Only set when a collection is first opened. Pressing Next onto an empty
   * section should show it as empty rather than silently skipping, because
   * then the reader is navigating and is owed an honest answer about where
   * they are.
   */
  options: { skipEmpty?: boolean } = {}
): Promise<HadithSection> {
  const { edition, source, language: editionLanguage, isFallback } = editionFor(
    collection,
    language
  );
  const cacheKey = `${CACHE_PREFIX}${collection}/${section}/${edition ?? 'ar-only'}/v4`;

  const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached) as HadithSection;

  // The Arabic is always fetched; it is the narration. The translation edition
  // is fetched only when one is approved for this language.
  const [arabicData, translationData] = await Promise.all([
    fetchJson<SectionPayload>(`${CDN}/editions/ara-${collection}/${section}.json`),
    edition
      ? fetchJson<SectionPayload>(`${CDN}/editions/${edition}/${section}.json`).catch(
          () => null
        )
      : Promise.resolve(null),
  ]);

  // Matched by hadith number rather than by position: a translation edition can
  // omit a narration, and zipping by index would then pair every later hadith
  // with the wrong translation — silently, and in a way nobody would spot.
  const translationByNumber = new Map<number, string>();
  for (const h of translationData?.hadiths ?? []) {
    translationByNumber.set(h.hadithnumber, h.text);
  }

  /*
   * The edition existed but had nothing in it.
   *
   * A file that is present and empty is indistinguishable from a real one until
   * it is opened, and the dataset contains several. Rather than trusting the
   * list above for ever, an empty result falls back to English here — the same
   * outcome as if the language had never been claimed, arrived at from
   * evidence rather than from a constant somebody has to remember to update.
   *
   * English falling back to English is skipped: there is nowhere further to go,
   * and the request would be the same one again.
   */
  let effectiveEdition = edition;
  let effectiveLanguage = editionLanguage;
  let effectiveSource = source;
  let effectiveFallback = isFallback;

  if (edition && translationData && !hasAnyText(translationData) && language !== 'en') {
    const english = EDITIONS.en(collection);
    if (english && english !== edition) {
      const rescued = await fetchJson<SectionPayload>(
        `${CDN}/editions/${english}/${section}.json`
      ).catch(() => null);

      if (rescued && hasAnyText(rescued)) {
        translationByNumber.clear();
        for (const h of rescued.hadiths ?? []) translationByNumber.set(h.hadithnumber, h.text);
        effectiveEdition = english;
        effectiveLanguage = 'en';
        effectiveSource = EDITION_SOURCE[english];
        effectiveFallback = true;
      }
    }
  }

  const sectionNames = arabicData.metadata.section ?? {};
  const result: HadithSection = {
    collection,
    collectionName: arabicData.metadata.name,
    section,
    sectionName: Object.values(sectionNames)[0] ?? String(section),
    hasTranslation: Boolean(effectiveEdition),
    translationLanguage: effectiveLanguage,
    isFallbackLanguage: effectiveFallback,
    translationSource: effectiveSource,
    sectionCount: Object.keys(arabicData.metadata.sections ?? sectionNames).length || 0,
    // Entries with no Arabic are dropped: the dataset carries placeholders for
    // sections it has no text for, and a placeholder is not a narration. Left
    // in, they rendered as blank cards that looked like a loading failure.
    hadiths: arabicData.hadiths
      .filter((h) => (h.text ?? '').trim().length > 0)
      .map((h) => ({
        number: h.hadithnumber,
        arabic: h.text,
        translation: translationByNumber.get(h.hadithnumber) ?? null,
        reference: h.reference
          ? `${h.reference.book}:${h.reference.hadith}`
          : String(h.hadithnumber),
      })),
  };

  void AsyncStorage.setItem(cacheKey, JSON.stringify(result)).catch(() => undefined);

  // Nothing readable here. Try the next one, up to a limit — a collection that
  // is empty all the way down is a broken source, not something to page
  // through for ever.
  if (
    options.skipEmpty &&
    result.hadiths.length === 0 &&
    section < MAX_EMPTY_SKIP
  ) {
    return getSection(collection, section + 1, language, options);
  }

  return result;
}
