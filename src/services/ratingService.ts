import { doc, setDoc, serverTimestamp, type Unsubscribe } from 'firebase/firestore';

import { COLLECTIONS } from '@/constants/app';
import { db } from '@/firebase/config';
import { getById, listAll, watchList } from './firestore';
import type { AppUser, Rating, RatingTarget } from '@/types';

/**
 * Ratings, out of five, for the app and for the things in it.
 *
 * One collection and one service for all three, because they are the same
 * question about different objects — see the Rating type for why the id is
 * shaped the way it is.
 */

/**
 * The id of a person's rating of a particular thing.
 *
 * Deterministic on purpose. It makes "have I already rated this?" a single
 * document read rather than a query, and it makes changing your mind an
 * overwrite rather than a second opinion sitting beside the first.
 */
export function ratingId(target: RatingTarget, targetId: string | null, uid: string): string {
  return `${target}_${targetId ?? 'self'}_${uid}`;
}

export interface RatingInput {
  target: RatingTarget;
  targetId?: string | null;
  targetTitle?: string | null;
  stars: number;
  comment?: string | null;
}

/**
 * Records one rating, replacing that person's previous one for the same thing.
 *
 * The star count is clamped rather than trusted. The UI only offers one to
 * five, but this is the last place before the database and a rating of nine
 * would quietly poison every average computed from it afterwards.
 */
export async function saveRating(input: RatingInput, user: AppUser): Promise<void> {
  const stars = Math.min(5, Math.max(1, Math.round(input.stars)));
  const targetId = input.targetId ?? null;
  const id = ratingId(input.target, targetId, user.uid);

  await setDoc(doc(db, COLLECTIONS.ratings, id), {
    target: input.target,
    targetId,
    targetTitle: input.targetTitle?.trim() || null,
    stars,
    comment: input.comment?.trim() || null,
    userId: user.uid,
    userName: user.fullName,
    role: user.role,
    classId: user.classId ?? null,
    deleted: false,
    updatedAt: serverTimestamp(),
  });
}

/** This person's rating of one thing, or null if they have not given one. */
export function myRating(
  target: RatingTarget,
  targetId: string | null,
  uid: string
): Promise<Rating | null> {
  return getById<Rating>(COLLECTIONS.ratings, ratingId(target, targetId, uid)).catch(() => null);
}

/**
 * Every rating, for staff.
 *
 * Ordered newest first because the comments are the part worth reading and the
 * newest are the ones nobody has seen yet. The averages are computed from the
 * same list rather than stored, so they cannot drift out of step with it.
 */
export function watchRatings(
  onNext: (ratings: Rating[]) => void,
  onError?: (error: unknown) => void,
  pageSize = 200
): Unsubscribe {
  return watchList<Rating>(
    COLLECTIONS.ratings,
    { orderByField: 'updatedAt', direction: 'desc', pageSize },
    onNext,
    onError
  );
}

/** The same list, fetched once. */
export function listRatings(pageSize = 200): Promise<Rating[]> {
  return listAll<Rating>(COLLECTIONS.ratings, {
    orderByField: 'updatedAt',
    direction: 'desc',
    pageSize,
  }).catch(() => []);
}

export interface RatingSummary {
  count: number;
  /** Mean stars to one decimal, or null when nobody has rated it. */
  average: number | null;
  /** How many gave one star, two, and so on. Index 0 is one star. */
  spread: [number, number, number, number, number];
}

/**
 * Counts and averages a set of ratings.
 *
 * The spread matters as much as the mean. Ten people split five and one
 * average the same as ten people who all said three, and those are not the
 * same platform — the first has a problem worth finding.
 */
export function summarise(ratings: Rating[]): RatingSummary {
  const spread: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let total = 0;

  for (const rating of ratings) {
    const stars = Math.min(5, Math.max(1, Math.round(rating.stars)));
    spread[stars - 1] += 1;
    total += stars;
  }

  return {
    count: ratings.length,
    average: ratings.length ? Math.round((total / ratings.length) * 10) / 10 : null,
    spread,
  };
}

/**
 * The ratings for each thing of one kind, grouped and summarised.
 *
 * Keyed by targetId so a caller can look up one lesson without walking the
 * list. The app itself has no id and lands under `self`, which is the same key
 * `ratingId` uses for it.
 */
export function groupByTarget(
  ratings: Rating[],
  target: RatingTarget
): { id: string; title: string | null; summary: RatingSummary; ratings: Rating[] }[] {
  const groups = new Map<string, Rating[]>();

  for (const rating of ratings) {
    if (rating.target !== target) continue;
    const key = rating.targetId ?? 'self';
    const list = groups.get(key) ?? [];
    list.push(rating);
    groups.set(key, list);
  }

  return Array.from(groups.entries())
    .map(([id, list]) => ({
      id,
      title: list.find((r) => r.targetTitle)?.targetTitle ?? null,
      summary: summarise(list),
      ratings: list,
    }))
    // Most-rated first: the thing fifty people have an opinion about is more
    // worth an admin's attention than the one with a single five.
    .sort((a, b) => b.summary.count - a.summary.count);
}
