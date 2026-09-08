import AsyncStorage from '@react-native-async-storage/async-storage';

import { AppError } from '@/utils/errors';
import type { LanguageCode } from '@/types';

/**
 * Qur'an text and translations, from the AlQuran.cloud API.
 *
 * Free, no key, no billing — the standing constraint on this project. The
 * alternative was bundling the text and three translations into the app, which
 * would add roughly 20 MB to every download to serve a section most people open
 * occasionally.
 *
 * Arabic is always fetched; the translation alongside it follows the Qur'an
 * dashboard's own language. A surah is cached after its first read, so going
 * back to one costs nothing and works with no connection.
 */

const ENDPOINT = 'https://api.alquran.cloud/v1';
const CACHE_PREFIX = '@weeklyclass/quran/v2/';

/**
 * Surahs cached before this version carry no page or juz, and the mushaf reader
 * reading them would run the whole surah together as one endless page. The
 * version in the prefix retires them. This clears what they left behind: on web
 * that cache is a 5 MB quota shared with the rest of the app, and abandoned
 * copies of Al-Baqara are an expensive thing to leave lying in it.
 */
const LEGACY_CACHE_PREFIX = '@weeklyclass/quran/';
let purgeStarted = false;
function purgeLegacyCache(): void {
  if (purgeStarted) return;
  purgeStarted = true;
  void (async () => {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const stale = keys.filter(
        (key) => key.startsWith(LEGACY_CACHE_PREFIX) && !key.startsWith(CACHE_PREFIX)
      );
      if (stale.length > 0) await AsyncStorage.multiRemove(stale);
    } catch {
      // Housekeeping. Not worth failing a read over.
    }
  })();
}
const TIMEOUT_MS = 20_000;

/** The Arabic edition. Uthmani script, which is what people expect to see. */
const ARABIC_EDITION = 'quran-uthmani';

/**
 * Translation editions per app language. Arabic readers get no second column —
 * the Arabic IS the text, and pairing it with a translation into Arabic would be
 * meaningless.
 */
const TRANSLATIONS: Record<LanguageCode, string | null> = {
  ar: null,
  ta: 'ta.tamil',
  si: 'si.naseemismail',
  en: 'en.sahih',
};

/**
 * Who produced each translation.
 *
 * Shown beside the rendering, because a reader is entitled to know whose
 * translation they are reading before they weigh it against the Arabic. All
 * four are published editions; nothing here is generated.
 */
const TRANSLATION_SOURCE: Record<string, string> = {
  'ta.tamil': 'Jan Trust Foundation',
  'si.naseemismail': 'Naseem Ismail & Masoor Maulana',
  'en.sahih': 'Saheeh International',
};

/** The named source of this language's translation, if one is approved. */
export function translationSourceFor(language: LanguageCode): string | undefined {
  const edition = TRANSLATIONS[language];
  return edition ? TRANSLATION_SOURCE[edition] : undefined;
}

export interface SurahSummary {
  number: number;
  name: string;
  englishName: string;
  englishNameTranslation: string;
  numberOfAyahs: number;
  revelationType: string;
}

export interface Ayah {
  /** Position within the surah - the number printed at the end of the verse. */
  number: number;
  /** Position within the whole Qur'an, which is how recitation files are named. */
  globalNumber: number;
  arabic: string;
  translation: string | null;
  /** Where this verse falls in the printed mushaf. */
  page: number;
  juz: number;
}

export interface Surah extends SurahSummary {
  ayahs: Ayah[];
  /** Identifier of the translation shown, or null for Arabic-only. */
  translationEdition: string | null;
}

async function fetchJson<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${ENDPOINT}${path}`, { signal: controller.signal });
    const payload = (await response.json()) as { code?: number; data?: T };
    if (!payload.data) throw new AppError('errors.generic', 'quran/malformed');
    return payload.data;
  } catch (error) {
    throw error instanceof AppError
      ? error
      : new AppError('errors.networkUnavailable', 'quran/unreachable');
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * The 114 surahs. Cached indefinitely — this list has not changed in fourteen
 * centuries and will not change now.
 */
export async function listSurahs(): Promise<SurahSummary[]> {
  const cacheKey = `${CACHE_PREFIX}index`;
  purgeLegacyCache();
  const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached) as SurahSummary[];

  const data = await fetchJson<SurahSummary[]>('/surah');
  void AsyncStorage.setItem(cacheKey, JSON.stringify(data)).catch(() => undefined);
  return data;
}

interface EditionPayload {
  number: number;
  name: string;
  englishName: string;
  englishNameTranslation: string;
  numberOfAyahs: number;
  revelationType: string;
  ayahs: { number: number; numberInSurah: number; text: string; page: number; juz: number }[];
  edition: { identifier: string };
}

/** One surah: Arabic, plus the translation for `language` when there is one. */
export async function getSurah(number: number, language: LanguageCode): Promise<Surah> {
  const translationEdition = TRANSLATIONS[language] ?? null;
  const cacheKey = `${CACHE_PREFIX}${number}/${translationEdition ?? 'ar'}`;

  purgeLegacyCache();
  const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached) as Surah;

  const editions = translationEdition
    ? `${ARABIC_EDITION},${translationEdition}`
    : ARABIC_EDITION;
  const data = await fetchJson<EditionPayload[]>(`/surah/${number}/editions/${editions}`);

  const arabic = data.find((e) => e.edition.identifier === ARABIC_EDITION) ?? data[0];
  const translated = translationEdition
    ? data.find((e) => e.edition.identifier === translationEdition)
    : undefined;

  const surah: Surah = {
    number: arabic.number,
    name: arabic.name,
    englishName: arabic.englishName,
    englishNameTranslation: arabic.englishNameTranslation,
    numberOfAyahs: arabic.numberOfAyahs,
    revelationType: arabic.revelationType,
    translationEdition,
    ayahs: arabic.ayahs.map((ayah, index) => ({
      number: ayah.numberInSurah,
      globalNumber: ayah.number,
      arabic: ayah.text,
      translation: translated?.ayahs[index]?.text ?? null,
      page: ayah.page,
      juz: ayah.juz,
    })),
  };

  void AsyncStorage.setItem(cacheKey, JSON.stringify(surah)).catch(() => undefined);
  return surah;
}

/** True when this language has a translation to show beside the Arabic. */
export function hasTranslation(language: LanguageCode): boolean {
  return TRANSLATIONS[language] != null;
}

// ---------------------------------------------------------------------------
// Pages, juz and audio — the units a reading plan is measured in
// ---------------------------------------------------------------------------

/** The mushaf everyone here counts by: 604 pages, 30 juz. */
export const TOTAL_PAGES = 604;
export const TOTAL_JUZ = 30;

/** Recitation used for the optional audio. Alafasy is the widely known one. */
const AUDIO_EDITION = 'ar.alafasy';

export interface PageAyah extends Ayah {
  surahNumber: number;
  surahName: string;
  surahEnglishName: string;
  /** Present only when audio was requested. */
  audio?: string | null;
}

export interface QuranPage {
  page: number;
  juz: number;
  ayahs: PageAyah[];
  /** Surahs appearing on this page, in order. */
  surahs: { number: number; englishName: string; name: string }[];
}

interface RawPageAyah {
  number: number;
  numberInSurah: number;
  text: string;
  juz: number;
  audio?: string;
  surah: { number: number; name: string; englishName: string };
}

async function fetchPageEdition(page: number, edition: string): Promise<RawPageAyah[]> {
  const data = await fetchJson<{ ayahs: RawPageAyah[] }>(`/page/${page}/${edition}`);
  return data.ayahs ?? [];
}

/**
 * One page of the mushaf, with the translation for `language` beside it.
 *
 * The page endpoint serves one edition at a time, so Arabic and the translation
 * are fetched together and zipped by position — both editions return the same
 * ayahs in the same order, which is what makes that safe.
 */
export async function getPage(
  page: number,
  language: LanguageCode,
  options: { audio?: boolean } = {}
): Promise<QuranPage> {
  const translationEdition = TRANSLATIONS[language] ?? null;
  const cacheKey = `${CACHE_PREFIX}page/${page}/${translationEdition ?? 'ar'}/${
    options.audio ? 'a' : 'n'
  }`;

  const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached) as QuranPage;

  const [arabic, translated] = await Promise.all([
    fetchPageEdition(page, options.audio ? AUDIO_EDITION : ARABIC_EDITION),
    translationEdition ? fetchPageEdition(page, translationEdition) : Promise.resolve([]),
  ]);

  // The audio edition carries the same Uthmani text, so requesting audio does
  // not cost a third round-trip.
  const ayahs: PageAyah[] = arabic.map((ayah, index) => ({
    number: ayah.numberInSurah,
    globalNumber: ayah.number,
    page,
    juz: ayah.juz,
    arabic: ayah.text,
    translation: translated[index]?.text ?? null,
    surahNumber: ayah.surah.number,
    surahName: ayah.surah.name,
    surahEnglishName: ayah.surah.englishName,
    audio: ayah.audio ?? null,
  }));

  const surahs: QuranPage['surahs'] = [];
  for (const ayah of ayahs) {
    if (surahs[surahs.length - 1]?.number === ayah.surahNumber) continue;
    surahs.push({
      number: ayah.surahNumber,
      englishName: ayah.surahEnglishName,
      name: ayah.surahName,
    });
  }

  const result: QuranPage = {
    page,
    juz: arabic[0]?.juz ?? 1,
    ayahs,
    surahs,
  };
  void AsyncStorage.setItem(cacheKey, JSON.stringify(result)).catch(() => undefined);
  return result;
}

/**
 * Where an ayah sits in the mushaf.
 *
 * A plan is set by surah and ayah, because that is how people describe where
 * they are, but progress is counted in pages and juz. This is the bridge.
 */
export async function locateAyah(
  surah: number,
  ayah: number
): Promise<{ page: number; juz: number }> {
  const cacheKey = `${CACHE_PREFIX}locate/${surah}:${ayah}`;
  const cached = await AsyncStorage.getItem(cacheKey).catch(() => null);
  if (cached) return JSON.parse(cached) as { page: number; juz: number };

  const data = await fetchJson<{ page: number; juz: number }>(
    `/ayah/${surah}:${ayah}/${ARABIC_EDITION}`
  );
  const located = { page: data.page, juz: data.juz };
  void AsyncStorage.setItem(cacheKey, JSON.stringify(located)).catch(() => undefined);
  return located;
}

// ---------------------------------------------------------------------------
// Recitation
// ---------------------------------------------------------------------------

/**
 * Named on screen, deliberately. A recitation is a particular person's reading,
 * not an anonymous audio file, and a listener is entitled to know whose.
 */
export const RECITER_NAME = 'Mishary Rashid Alafasy';

/**
 * Where one ayah's recitation lives.
 *
 * Keyed by the ayah's position in the whole Qur'an, not its number within the
 * surah — the same numbering the API returns as `number`. Free CDN, no key, run
 * by the same people as the text API.
 */
export function ayahAudioUrl(globalNumber: number): string {
  return `https://cdn.islamic.network/quran/audio/128/${AUDIO_EDITION}/${globalNumber}.mp3`;
}

// ---------------------------------------------------------------------------
// Shaping a page
// ---------------------------------------------------------------------------

/**
 * The basmala exactly as the Uthmani edition writes it, as escapes rather than
 * as Arabic letters on purpose.
 *
 * The comparison below is byte-for-byte, and in this edition the shadda comes
 * before the fatha (U+0651 then U+064E) — an order an editor or a copy-paste
 * through a normalising tool will silently swap, leaving a literal that looks
 * identical on screen and never matches again. Escapes cannot be reordered by
 * accident.
 */
const BASMALA =
  '\u0628\u0650\u0633\u0652\u0645\u0650\u0020\u0671\u0644\u0644\u0651\u064e\u0647\u0650' +
  '\u0020\u0671\u0644\u0631\u0651\u064e\u062d\u0652\u0645\u064e\u0670\u0646\u0650\u0020' +
  '\u0671\u0644\u0631\u0651\u064e\u062d\u0650\u064a\u0645\u0650';

/**
 * Separates the opening basmala from the first verse of a surah.
 *
 * The edition prefixes it to verse 1 of every surah except Al-Fatiha, which
 * counts it as verse 1 in its own right, and At-Tawba, which has none. Printed
 * mushafs set it as a heading on its own centred line, so the reader has to be
 * able to pull it out; running it into the verse would also put a verse number
 * after words that are not part of that verse.
 *
 * If the text ever stops matching, nothing is split and the verse is shown
 * whole — wrong-looking, but never truncated.
 */
export function splitBasmala(
  surah: number,
  ayahNumber: number,
  text: string
): { basmala: string | null; text: string } {
  // The edition ships a byte-order mark on the very first ayah of the Qur'an.
  const clean = text.replace(/^\uFEFF/, '');
  if (ayahNumber !== 1 || surah === 1 || surah === 9) return { basmala: null, text: clean };
  if (!clean.startsWith(BASMALA)) return { basmala: null, text: clean };
  return { basmala: BASMALA, text: clean.slice(BASMALA.length).trimStart() };
}
