import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { myRating, saveRating } from '@/services/ratingService';
import type { RatingTarget } from '@/types';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { Button, Card, Rating, TextField } from '@/components/ui';

/**
 * "How was it?" — the same question, wherever it is asked.
 *
 * One component for the app, for a lesson and for an event, because the three
 * differ only in what they are asking about. Three copies would have drifted
 * into three slightly different questions with three slightly different
 * behaviours, which is how a product ends up feeling assembled rather than
 * designed.
 *
 * BEHAVIOUR WORTH KNOWING. It draws nothing at all until it has checked
 * whether this person has already answered — a prompt that appears and then
 * vanishes is worse than one that arrives a beat late. Once answered it
 * collapses to a single line showing their stars, with a way back in for
 * somebody who changed their mind. It never nags: there is no second ask, no
 * "remind me later", no dismissing it only for it to return next week.
 *
 * The comment box appears only after a star is chosen. Asking for prose before
 * the tap is what makes people close the card.
 */
export function RatingPrompt({
  target,
  targetId = null,
  targetTitle = null,
  question,
}: {
  target: RatingTarget;
  targetId?: string | null;
  targetTitle?: string | null;
  /** Overrides the default wording, for a place that needs to be specific. */
  question?: string;
}) {
  const { t } = useTranslation();
  const { user, isGuest } = useAuth();
  const toast = useToast();

  const [checked, setChecked] = useState(false);
  const [saved, setSaved] = useState<number | null>(null);
  const [stars, setStars] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    if (!user || isGuest) return undefined;

    myRating(target, targetId, user.uid)
      .then((existing) => {
        if (!live) return;
        setSaved(existing?.stars ?? null);
        setStars(existing?.stars ?? null);
        setComment(existing?.comment ?? '');
        setChecked(true);
      })
      .catch(() => {
        // Unreadable is treated as unanswered. Refusing to show the prompt
        // because one read failed loses a rating for no reason.
        if (live) setChecked(true);
      });

    return () => {
      live = false;
    };
  }, [user, target, targetId]);

  const submit = useCallback(async () => {
    if (!user || !stars) return;
    setBusy(true);
    try {
      await saveRating({ target, targetId, targetTitle, stars, comment }, user);
      setSaved(stars);
      setEditing(false);
      toast.success(t('rating.thanks'));
    } catch {
      toast.error(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  }, [user, stars, comment, target, targetId, targetTitle, toast, t]);

  // Nobody to attribute it to, or we do not yet know whether they answered.
  if (!user || isGuest || !checked) return null;

  if (saved !== null && !editing) {
    return (
      <Card style={styles.done}>
        <View style={styles.doneRow}>
          <Text style={styles.doneText}>{t('rating.yourRating', { stars: saved })}</Text>
          <Button
            label={t('common.edit')}
            variant="ghost"
            onPress={() => setEditing(true)}
          />
        </View>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <Text style={styles.question}>{question ?? t(`rating.ask_${target}`)}</Text>

      <Rating value={stars} onChange={setStars} disabled={busy} />

      {/* Only after a star. Asking for a sentence first is what makes people
          close the card without answering at all. */}
      {stars ? (
        <>
          <TextField
            label={t('rating.commentLabel')}
            value={comment}
            onChangeText={setComment}
            placeholder={t('rating.commentHint')}
            multiline
            numberOfLines={3}
          />
          <Button
            label={t('common.submit')}
            icon="checkmark"
            fullWidth
            loading={busy}
            onPress={submit}
          />
        </>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  question: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  done: { paddingVertical: spacing.sm },
  doneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  doneText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.textSecondary,
  },
  // Kept for the star colour to stay in one place if this grows.
  star: { color: brand.orange, borderRadius: radius.sm },
});
