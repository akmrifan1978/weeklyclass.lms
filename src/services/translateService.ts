import AsyncStorage from '@react-native-async-storage/async-storage';

import type { LanguageCode } from '@/types';

/**
 * Machine translation, on demand and clearly marked as such.
 *
 * This exists because seven of the nine hadith collections have no published
 * Tamil edition, and a Tamil reader was being shown English or nothing. It is
 * a worse rendering than a published translation and it is not a substitute for
 * one — every screen that uses it has to say so, and has to keep the source
 * text visible beside it so the reader can always check.
 *
 * Deliberately NOT used for the Qur'an. A machine rendering of a hadith is a
 * rough gloss somebody can weigh against the English printed next to it; a
 * machine rendering of the Qur'an is presented to a reader as the meaning of
 * revelation, and that is not a thing to generate.
 *
 * MyMemory is the service, because it is free, needs no key, and returns
 * Tamil of usable quality.
 *
 * Its quota is the whole design constraint. Anonymous, it allows roughly 5,000
 * characters a day per address — enough for a handful of passages and nothing
 * more. Naming a contact address raises that to roughly 50,000, ten times as
 * much, which is the difference between "translate this one thing on request"
 * and "translate what is on screen as you read".
 *
 * That address is an admin setting rather than a constant, because it is the
 * organisation's address being given to a third party and that is theirs to
 * decide. Blank is fine and everything still works — just less of it per day.
 */

const ENDPOINT = 'https://api.mymemory.translated.net/get';
const CACHE_PREFIX = 'mt/v1/';
const TIMEOUT_MS = 15_000;

/**
 * MyMemory rejects long queries, so text is split and rejoined.
 *
 * Under the documented limit rather than at it: the boundary is counted in
 * bytes, and Tamil is far from one byte per character.
 */
const MAX_CHUNK = 400;

/**
 * Why a translation could not be produced.
 *
 * `network` and `service` were the same thing until it mattered. MyMemory
 * answers roughly half of all requests with a 504 — measured, eight attempts,
 * four gateway timeouts — and every one of those was being reported to the
 * reader as "check your connection". Their connection was fine. Sending
 * somebody to restart their router because a service in Italy is overloaded
 * wastes their time and teaches them the message means nothing.
 */
export type TranslationFailure = 'quota' | 'network' | 'service' | 'refused';

export class TranslationUnavailable extends Error {
  readonly reason: TranslationFailure;
  constructor(reason: TranslationFailure) {
    super(reason);
    this.name = 'TranslationUnavailable';
    this.reason = reason;
  }
}

/**
 * How many times to ask before giving up.
 *
 * The failures are transient — the same text asked for again usually comes
 * back. At the observed success rate a single attempt works about half the
 * time and three attempts about seven times in eight, which is the difference
 * between a feature that seems broken and one that seems slow.
 */
const ATTEMPTS = 3;

/** Grows between tries, so a struggling service is not hammered. */
const RETRY_DELAY_MS = 700;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stable, short key for a piece of text. FNV-1a — not security, just identity. */
function fingerprint(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Splits on sentence ends, and only mid-sentence when a sentence is itself too
 * long. Cutting at an arbitrary character would hand the translator half a
 * clause and get back something worse than either half.
 */
function chunk(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const out: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (sentence.length > MAX_CHUNK) {
      if (current) {
        out.push(current);
        current = '';
      }
      for (let i = 0; i < sentence.length; i += MAX_CHUNK) {
        out.push(sentence.slice(i, i + MAX_CHUNK));
      }
      continue;
    }
    if ((current + sentence).length > MAX_CHUNK) {
      out.push(current);
      current = sentence;
    } else {
      current += sentence;
    }
  }

  if (current.trim()) out.push(current);
  return out;
}

/**
 * The contact address MyMemory raises the daily allowance for.
 *
 * Read once and held, rather than fetched per chunk: a long passage is several
 * requests and the setting cannot change between them.
 */
let contactAddress: string | null = null;

async function loadContactAddress(): Promise<string> {
  if (contactAddress !== null) return contactAddress;
  try {
    const { getSettings } = await import('./settingsService');
    const settings = await getSettings();
    contactAddress = settings.translationContactEmail?.trim() ?? '';
  } catch {
    contactAddress = '';
  }
  return contactAddress;
}

/** Forgets the cached address, so saving a new one takes effect at once. */
export function clearContactAddress(): void {
  contactAddress = null;
}

async function translateChunk(
  text: string,
  from: LanguageCode,
  to: LanguageCode
): Promise<string> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const contact = await loadContactAddress();
    const url =
      `${ENDPOINT}?q=${encodeURIComponent(text)}&langpair=${from}|${to}` +
      (contact ? `&de=${encodeURIComponent(contact)}` : '');
    const response = await fetch(url, { signal: controller.signal });

    // Checked before parsing. A 5xx from this service returns an HTML error
    // page, and calling .json() on it throws something that says nothing about
    // what actually happened.
    if (response.status >= 500) throw new TranslationUnavailable('service');
    if (!response.ok) throw new TranslationUnavailable('refused');

    const payload = (await response.json()) as {
      responseStatus?: number | string;
      responseData?: { translatedText?: string };
      quotaFinished?: boolean;
      responseDetails?: string;
    };

    if (payload.quotaFinished) throw new TranslationUnavailable('quota');

    const status = Number(payload.responseStatus);
    const result = payload.responseData?.translatedText;
    if (status !== 200 || !result) throw new TranslationUnavailable('refused');

    // The service echoes an all-caps warning back in the translation field when
    // it will not translate. Returning that to a reader as though it were Tamil
    // would be worse than admitting the failure.
    if (/^MYMEMORY WARNING|^QUERY LENGTH LIMIT/i.test(result)) {
      throw new TranslationUnavailable(/QUOTA/i.test(result) ? 'quota' : 'refused');
    }
    return result;
  } catch (error) {
    if (error instanceof TranslationUnavailable) throw error;
    // A timeout is the service failing to answer, not the reader being offline.
    if ((error as Error)?.name === 'AbortError') {
      throw new TranslationUnavailable('service');
    }
    throw new TranslationUnavailable('network');
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * One chunk, asked for up to three times.
 *
 * Only the transient failures are retried. A quota that has run out will still
 * be exhausted a second later, and a passage the service refuses to translate
 * will still be refused — retrying either wastes the reader's time and, in the
 * quota case, their remaining allowance.
 */
async function translateChunkWithRetry(
  text: string,
  from: LanguageCode,
  to: LanguageCode
): Promise<string> {
  let last: unknown;

  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await translateChunk(text, from, to);
    } catch (error) {
      last = error;
      const reason =
        error instanceof TranslationUnavailable ? error.reason : 'network';
      if (reason === 'quota' || reason === 'refused') throw error;
      if (attempt < ATTEMPTS) await wait(RETRY_DELAY_MS * attempt);
    }
  }

  throw last instanceof TranslationUnavailable
    ? last
    : new TranslationUnavailable('service');
}

/**
 * Translates one passage, caching the result permanently.
 *
 * Permanent because the input never changes: a hadith translated once is the
 * same hadith tomorrow, and re-fetching it would spend a daily quota on an
 * answer already held.
 */
export async function translate(
  text: string,
  from: LanguageCode,
  to: LanguageCode
): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed || from === to) return trimmed;

  const key = `${CACHE_PREFIX}${from}-${to}/${fingerprint(trimmed)}`;
  const cached = await AsyncStorage.getItem(key).catch(() => null);
  if (cached) return cached;

  const pieces = chunk(trimmed);
  const translated: string[] = [];
  for (const piece of pieces) {
    // Sequential, not parallel. Firing five requests at a free service is how
    // a rate limit is met, and the pieces have to be rejoined in order anyway.
    translated.push(await translateChunkWithRetry(piece, from, to));
  }

  const result = translated.join(' ').replace(/\s+/g, ' ').trim();
  await AsyncStorage.setItem(key, result).catch(() => undefined);
  return result;
}

/** True when this passage has already been translated and needs no request. */
export async function cachedTranslation(
  text: string,
  from: LanguageCode,
  to: LanguageCode
): Promise<string | null> {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return AsyncStorage.getItem(
    `${CACHE_PREFIX}${from}-${to}/${fingerprint(trimmed)}`
  ).catch(() => null);
}
