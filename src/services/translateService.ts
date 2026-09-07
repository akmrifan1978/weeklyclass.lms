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
 * Tamil of usable quality. The anonymous quota is about 5,000 characters a
 * day per address, which is why nothing here translates ahead of time: a
 * reader translates the hadith in front of them, and it is then cached for
 * good.
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

export class TranslationUnavailable extends Error {
  readonly reason: 'quota' | 'network' | 'refused';
  constructor(reason: 'quota' | 'network' | 'refused') {
    super(reason);
    this.name = 'TranslationUnavailable';
    this.reason = reason;
  }
}

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

async function translateChunk(
  text: string,
  from: LanguageCode,
  to: LanguageCode
): Promise<string> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const url = `${ENDPOINT}?q=${encodeURIComponent(text)}&langpair=${from}|${to}`;
    const response = await fetch(url, { signal: controller.signal });
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
    throw new TranslationUnavailable('network');
  } finally {
    clearTimeout(deadline);
  }
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
    translated.push(await translateChunk(piece, from, to));
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
