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
 * Edition prefix per app language.
 *
 * Only Bukhari and Muslim carry a Tamil translation in this dataset; everything
 * else falls back to English rather than showing nothing, and the screen says
 * which translation is on show.
 */
const LANGUAGE_PREFIX: Record<LanguageCode, string> = {
  ar: 'ara',
  ta: 'tam',
  en: 'eng',
  // No Sinhala edition exists here. English is the honest fallback.
  si: 'eng',
};

const TAMIL_AVAILABLE = new Set(['bukhari', 'muslim']);

/** The edition actually fetched, which may not be the language asked for. */
export function editionFor(
  collection: string,
  language: LanguageCode
): { edition: string; language: LanguageCode; fellBack: boolean } {
  if (language === 'ta' && !TAMIL_AVAILABLE.has(collection)) {
    return { edition: `eng-${collection}`, language: 'en', fellBack: true };
  }
  if (language === 'si') {
    return { edition: `eng-${collection}`, language: 'en', fellBack: true };
  }
  return {
    edition: `${LANGUAGE_PREFIX[language]}-${collection}`,
    language,
    fellBack: false,
  };
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
  const cacheKey = `${CACHE_PREFIX}collections/${language}`;
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
  }));

  void AsyncStorage.setItem(cacheKey, JSON.stringify(result)).catch(() => undefined);
  return result;
}

export interface Hadith {
  number: number;
  text: string;
  /** `book:hadith` as printed, which is how a narration is cited. */
  reference: string;
}

export interface HadithSection {
  collection: string;
  collectionName: string;
  section: number;
  sectionName: string;
  hadiths: Hadith[];
  /** Set when the requested language had no edition and English was used. */
  fellBackToEnglish: boolean;
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
export async function getSection(
  collection: string,
  section: number,
  language: LanguageCode
): Promise<HadithSection> {
  const { edition, fellBack } = editionFor(collection, language);
  const cacheKey = `${CACHE_PREFIX}${edition}/${section}`;

  const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached) as HadithSection;

  const data = await fetchJson<SectionPayload>(
    `${CDN}/editions/${edition}/${section}.json`
  );

  const sectionNames = data.metadata.section ?? {};
  const result: HadithSection = {
    collection,
    collectionName: data.metadata.name,
    section,
    sectionName: Object.values(sectionNames)[0] ?? String(section),
    fellBackToEnglish: fellBack,
    sectionCount: Object.keys(data.metadata.sections ?? sectionNames).length || 0,
    hadiths: data.hadiths.map((h) => ({
      number: h.hadithnumber,
      text: h.text,
      reference: h.reference
        ? `${h.reference.book}:${h.reference.hadith}`
        : String(h.hadithnumber),
    })),
  };

  void AsyncStorage.setItem(cacheKey, JSON.stringify(result)).catch(() => undefined);
  return result;
}
