import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import * as videoService from '@/services/videoService';
import type { LanguageCode, VideoItem } from '@/types';
import {
  Button,
  ConfirmDialog,
  FormSheet,
  IconButton,
  TextField,
} from '@/components/ui';

/**
 * Writing and reviewing the translations of one piece of Islamic content.
 *
 * The pipeline this implements, and the reason it is not simply an edit box:
 *
 *   Arabic original → someone writes a translation → an admin reviews it →
 *   it is published
 *
 * A translation of a fatwa carries the weight of the ruling it renders. Letting
 * whoever typed it also publish it would mean a student reads it as the
 * shaykh's answer with nobody qualified having checked the words. So drafting
 * and approving are separate acts, and only an admin can do the second.
 *
 * The Arabic is not editable from here at all — not disabled, absent. There is
 * no path through this component that can alter the original.
 */
export function TranslationManager({
  video,
  onChanged,
}: {
  video: VideoItem;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();
  const { available } = useLanguage();

  const [editing, setEditing] = useState<LanguageCode | null>(null);
  const [form, setForm] = useState({ title: '', summary: '' });
  const [confirmRemove, setConfirmRemove] = useState<LanguageCode | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = user?.role === 'admin';

  const open = (language: LanguageCode) => {
    const entry = video.translations?.[language];
    setForm({ title: entry?.title ?? '', summary: entry?.summary ?? '' });
    setEditing(language);
  };

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      if (!user || !editing) return;
      await videoService.saveTranslation(video.id, editing, form, user);
      toast.success(t('translation.savedAsDraft'));
      setEditing(null);
    });

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading}>{t('translation.manage')}</Text>
      <Text style={styles.hint}>{t('translation.pipelineHint')}</Text>

      {available.map((option) => {
        const language = option.code as LanguageCode;
        // Arabic is the original, not a translation of itself.
        if (language === 'ar') return null;

        const entry = video.translations?.[language];
        const approved = entry?.status === 'approved';

        return (
          <View key={language} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.language}>{option.name}</Text>
              <View style={styles.statusRow}>
                {!entry ? (
                  <Text style={styles.none}>{t('translation.statusNone')}</Text>
                ) : approved ? (
                  <>
                    <Ionicons name="checkmark-circle" size={13} color={colors.success} />
                    <Text style={styles.approved}>
                      {t('translation.statusApproved', {
                        name: entry.reviewedByName ?? '',
                      })}
                    </Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="time-outline" size={13} color={colors.warning} />
                    <Text style={styles.draft}>{t('translation.statusDraft')}</Text>
                  </>
                )}
              </View>
            </View>

            <IconButton
              icon="create-outline"
              label={t('common.edit')}
              size={32}
              color={colors.primary}
              onPress={() => open(language)}
            />

            {/* Approving is an admin act. A teacher who drafted the words does
                not get to publish their own rendering of a ruling. */}
            {entry && isAdmin ? (
              <IconButton
                icon={approved ? 'eye-off-outline' : 'checkmark-done'}
                label={t(approved ? 'translation.withdraw' : 'translation.approve')}
                size={32}
                color={approved ? colors.textMuted : colors.success}
                onPress={() =>
                  run(async () => {
                    if (!user) return;
                    if (approved) {
                      await videoService.unapproveTranslation(video.id, language, user);
                      toast.success(t('translation.withdrawn'));
                    } else {
                      await videoService.approveTranslation(video.id, language, user);
                      toast.success(t('translation.approved'));
                    }
                  })
                }
              />
            ) : null}

            {entry ? (
              <IconButton
                icon="trash-outline"
                label={t('common.delete')}
                size={32}
                color={colors.danger}
                onPress={() => setConfirmRemove(language)}
              />
            ) : null}
          </View>
        );
      })}

      {!isAdmin ? (
        <Text style={styles.reviewNote}>{t('translation.awaitingAdmin')}</Text>
      ) : null}

      <FormSheet
        visible={Boolean(editing)}
        title={t('translation.editTitle')}
        onClose={() => setEditing(null)}
        onSubmit={save}
        submitting={busy}
      >
        {/* The Arabic is shown for reference and cannot be edited here. */}
        <Text style={styles.originalLabel}>{t('scripture.originalArabic')}</Text>
        <Text style={styles.original} selectable>
          {video.title}
        </Text>

        <TextField
          label={t('translation.fieldTitle')}
          value={form.title}
          onChangeText={(v) => setForm((p) => ({ ...p, title: v }))}
          hint={t('translation.fieldTitleHint')}
        />
        <TextField
          label={t('translation.fieldSummary')}
          value={form.summary}
          onChangeText={(v) => setForm((p) => ({ ...p, summary: v }))}
          multiline
        />
        <Text style={styles.saveNote}>{t('translation.saveNote')}</Text>
      </FormSheet>

      <ConfirmDialog
        visible={Boolean(confirmRemove)}
        title={t('confirm.deleteTitle')}
        message={t('translation.removeWarning')}
        confirmLabel={t('common.delete')}
        destructive
        loading={busy}
        onCancel={() => setConfirmRemove(null)}
        onConfirm={() =>
          run(async () => {
            if (!user || !confirmRemove) return;
            await videoService.removeTranslation(video.id, confirmRemove, user);
            setConfirmRemove(null);
          })
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  heading: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textSecondary },
  hint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 16,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  language: { fontSize: fontSize.sm, color: colors.text, fontWeight: fontWeight.medium },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  none: { fontSize: fontSize.xs, color: colors.textMuted },
  draft: { fontSize: fontSize.xs, color: colors.warning },
  approved: { fontSize: fontSize.xs, color: colors.success },
  reviewNote: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.sm },
  originalLabel: {
    fontSize: fontSize.xs,
    color: brand.orange,
    fontWeight: fontWeight.bold,
    marginBottom: spacing.xs,
  },
  original: {
    fontSize: 18,
    lineHeight: 34,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: spacing.lg,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  saveNote: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 16 },
});
