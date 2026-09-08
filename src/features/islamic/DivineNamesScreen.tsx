import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { ASMA_UL_HUSNA, type DivineName } from '@/constants/asmaulHusna';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { matchesSearch } from '@/utils/format';
import * as divineNames from '@/services/divineNameService';
import {
  AppHeader,
  Card,
  FormSheet,
  Screen,
  SearchField,
  SkeletonList,
  Spacer,
  TextField,
} from '@/components/ui';

import { useArabicSpeech } from './useArabicSpeech';

/**
 * The ninety-nine names.
 *
 * A list rather than a carousel: people come here to find one name, or to read
 * down them, and both of those are lists. The Arabic is the largest thing on
 * every row because it is the text; the transliteration under it is a pronun-
 * ciation aid and is sized like one.
 *
 * Tapping a row opens the teachers' note, where there is one. A name without a
 * note shows its meaning and nothing else, which is a complete row — see
 * divineNameService for why no explanations ship with the app.
 */
export function DivineNamesScreen() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const toast = useToast();
  const speech = useArabicSpeech();

  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [editing, setEditing] = useState<DivineName | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => divineNames.listNotes(), []);
  const { data: notes, loading, reload } = useAsync(load, []);

  const visible = useMemo(
    () =>
      ASMA_UL_HUSNA.filter((name) =>
        matchesSearch(term, name.transliteration, name.meaning, name.arabic)
      ),
    [term]
  );

  // Speaking stops when the screen goes away. A voice continuing to recite
  // after somebody has navigated elsewhere is startling and hard to silence.
  useEffect(() => speech.stop, [speech.stop]);

  const canEdit = can('MANAGE_ARTICLES');

  const save = async () => {
    if (!editing || !user) return;
    setSaving(true);
    try {
      await divineNames.saveNote(editing.number, draft, user);
      toast.success(t('common.success'));
      setEditing(null);
      void reload();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <AppHeader title={t('names.title')} subtitle={t('names.lead')} showBack />

      <Screen>
        <SearchField value={term} onChangeText={setTerm} placeholder={t('names.search')} />
        <Spacer size={spacing.md} />

        {speech.reason ? (
          <View style={styles.notice}>
            <Ionicons name="volume-mute-outline" size={15} color={colors.textSecondary} />
            <Text style={styles.noticeText}>{t(`names.audio_${speech.reason}`)}</Text>
          </View>
        ) : null}

        {loading ? <SkeletonList count={4} /> : null}

        {visible.map((name) => {
          const note = notes?.[name.number];
          const expanded = open === name.number;
          const speaking = speech.speakingId === name.number;

          return (
            <Card key={name.number} style={styles.card}>
              {/* The two controls are siblings, never nested. On the web a
                  Pressable is a <button>, and a button inside a button is
                  invalid markup that browsers resolve by unnesting it — which
                  breaks whichever of the two they decide to drop. */}
              <View style={styles.row}>
                <Pressable
                  onPress={() => setOpen(expanded ? null : name.number)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`${name.transliteration} — ${name.meaning}`}
                  style={styles.rowMain}
                >
                  <View style={styles.number}>
                    <Text style={styles.numberText}>{name.number}</Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    {/* Arabic first and largest. `writingDirection` matters:
                        without it a name ending in a bracketed gloss can render
                        with its parts in the wrong order. */}
                    <Text style={styles.arabic}>{name.arabic}</Text>
                    <Text style={styles.translit}>{name.transliteration}</Text>
                    <Text style={styles.meaning}>{name.meaning}</Text>
                  </View>
                </Pressable>

                {speech.available ? (
                  <Pressable
                    onPress={() =>
                      speaking ? speech.stop() : speech.speak(name.number, name.arabic)
                    }
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel={t(speaking ? 'names.stop' : 'names.play')}
                    style={[styles.speaker, speaking && styles.speakerOn]}
                  >
                    <Ionicons
                      name={speaking ? 'pause' : 'volume-high'}
                      size={17}
                      color={speaking ? colors.textInverse : brand.orange}
                    />
                  </Pressable>
                ) : null}
              </View>

              {expanded ? (
                <View style={styles.note}>
                  {note?.explanation ? (
                    <>
                      <Text style={styles.noteText}>{note.explanation}</Text>
                      {note.updatedByName ? (
                        <Text style={styles.noteBy}>
                          {t('names.writtenBy', { name: note.updatedByName })}
                        </Text>
                      ) : null}
                    </>
                  ) : (
                    <Text style={styles.noteEmpty}>{t('names.noNote')}</Text>
                  )}

                  {canEdit ? (
                    <Pressable
                      onPress={() => {
                        setEditing(name);
                        setDraft(note?.explanation ?? '');
                      }}
                      accessibilityRole="button"
                      style={styles.editRow}
                    >
                      <Ionicons name="create-outline" size={14} color={colors.primary} />
                      <Text style={styles.editText}>
                        {t(note?.explanation ? 'common.edit' : 'names.addNote')}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </Card>
          );
        })}

        <Spacer size={spacing.xxl} />
      </Screen>

      <FormSheet
        visible={editing !== null}
        title={editing ? `${editing.transliteration} — ${editing.meaning}` : ''}
        onClose={() => setEditing(null)}
        onSubmit={save}
        submitLabel={t('common.save')}
        submitting={saving}
      >
        <Text style={styles.editorHint}>{t('names.noteHint')}</Text>
        <TextField
          label={t('names.explanation')}
          value={draft}
          onChangeText={setDraft}
          multiline
        />
      </FormSheet>
    </>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md, padding: 0, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingRight: spacing.md,
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  number: {
    width: 30,
    height: 30,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numberText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.textSecondary },
  arabic: {
    fontSize: 26,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
    lineHeight: 42,
  },
  translit: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary },
  meaning: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 1 },
  speaker: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakerOn: { backgroundColor: brand.orange },
  note: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    padding: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  noteText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 21 },
  noteBy: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.sm },
  noteEmpty: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 18 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  editText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primary },
  editorHint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  noticeText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17 },
});
