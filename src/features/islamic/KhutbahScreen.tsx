import React, { useCallback, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { LANGUAGES } from '@/constants/app';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { formatShortDate, toISODate } from '@/utils/date';
import { friendlyMessage } from '@/utils/errors';
import { matchesSearch } from '@/utils/format';
import * as khutbahs from '@/services/khutbahService';
import type { ContentStatus, KhutbahEntry, KhutbahKind, LanguageCode } from '@/types';
import {
  AppHeader,
  Button,
  Card,
  ChipGroup,
  DateField,
  EmptyState,
  FormSheet,
  Screen,
  SearchField,
  Select,
  SkeletonList,
  Spacer,
  TextField,
} from '@/components/ui';

/**
 * Friday khutbahs and special bayans, translated.
 *
 * The reading language follows whatever the person is reading the app in, and
 * where that translation does not exist the screen says so and offers what
 * does — rather than quietly showing Arabic to somebody who asked for Tamil,
 * which looks like a bug rather than a gap.
 *
 * Staff who can manage written content get the editor in the same place. It is
 * one screen because it is one thing: the people writing the translations are
 * the people who read them back to check.
 */
export function KhutbahScreen() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const { user, can } = useAuth();
  const toast = useToast();

  const canEdit = can('MANAGE_ARTICLES');

  const [kind, setKind] = useState<KhutbahKind | 'all'>('all');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [reading, setReading] = useState<Record<string, LanguageCode>>({});

  // Open is its own flag, not something inferred. Adding a new entry has no
  // `editing` record by definition, so deriving the sheet's visibility from
  // one made the add button do nothing at all.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<KhutbahEntry | null>(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    () => khutbahs.listKhutbahs({ publishedOnly: !canEdit }),
    [canEdit]
  );
  const { data, loading, reload } = useAsync(load, [canEdit]);

  const visible = useMemo(
    () =>
      (data ?? [])
        .filter((entry) => kind === 'all' || entry.kind === kind)
        .filter((entry) => matchesSearch(term, entry.title, entry.speaker, entry.venue)),
    [data, kind, term]
  );

  const startEdit = (entry: KhutbahEntry | null) => {
    setEditing(entry);
    setForm(entry ? toForm(entry) : emptyForm());
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditing(null);
    setForm(emptyForm());
  };

  const save = async () => {
    if (!user) return;
    if (!form.title.trim()) {
      toast.error(t('validation.titleRequired'));
      return;
    }
    setSaving(true);
    try {
      await khutbahs.saveKhutbah(
        {
          kind: form.kind,
          title: form.title.trim(),
          date: form.date || toISODate(),
          speaker: form.speaker.trim() || null,
          venue: form.venue.trim() || null,
          deliveredIn: form.deliveredIn,
          audioUrl: form.audioUrl.trim() || null,
          status: form.status,
          // Only what was actually written. An empty box is not a translation
          // and must not be stored as one, or the reader is offered a language
          // that opens onto nothing.
          translations: Object.fromEntries(
            (Object.entries(form.translations) as [LanguageCode, string][])
              .filter(([, text]) => text.trim().length > 0)
              .map(([code, text]) => [code, text.trim()])
          ),
        },
        user,
        editing?.id
      );
      toast.success(t('common.success'));
      closeSheet();
      void reload();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <AppHeader
        title={t('khutbah.title')}
        subtitle={t('khutbah.lead')}
        showBack
        right={
          canEdit ? (
            <Pressable
              onPress={() => startEdit(null)}
              accessibilityRole="button"
              accessibilityLabel={t('khutbah.add')}
              hitSlop={10}
            >
              <Ionicons name="add-circle" size={26} color={colors.textInverse} />
            </Pressable>
          ) : undefined
        }
      />

      <Screen>
        <SearchField value={term} onChangeText={setTerm} placeholder={t('khutbah.search')} />
        <Spacer size={spacing.md} />

        <ChipGroup<KhutbahKind | 'all'>
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'jumuah', label: t('khutbah.kind_jumuah') },
            { value: 'bayan', label: t('khutbah.kind_bayan') },
          ]}
          value={kind}
          onChange={setKind}
          style={{ marginBottom: spacing.lg }}
        />

        {loading ? <SkeletonList count={3} /> : null}

        {!loading && visible.length === 0 ? (
          <EmptyState
            icon="mic-outline"
            title={t('khutbah.none')}
            message={t('khutbah.noneHelp')}
          />
        ) : null}

        {visible.map((entry) => {
          const expanded = open === entry.id;
          const languages = khutbahs.availableLanguages(entry);
          const chosen = reading[entry.id] ?? language;
          const rendering = khutbahs.renderingFor(entry, chosen);
          // The reader asked for one language and is being shown another.
          const substituted = rendering !== null && rendering.language !== chosen;

          return (
            <Card key={entry.id} style={styles.card}>
              <Pressable
                onPress={() => setOpen(expanded ? null : entry.id)}
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                style={styles.head}
              >
                <View style={[styles.kindDot, entry.kind === 'jumuah' && styles.kindDotJumuah]}>
                  <Ionicons
                    name={entry.kind === 'jumuah' ? 'mic' : 'chatbubbles'}
                    size={15}
                    color={entry.kind === 'jumuah' ? brand.navy : brand.orange}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={2}>
                    {entry.title}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {[
                      t(`khutbah.kind_${entry.kind}`),
                      formatShortDate(entry.date),
                      entry.speaker,
                    ]
                      .filter(Boolean)
                      .join('  ·  ')}
                  </Text>
                  {entry.status === 'draft' ? (
                    <Text style={styles.draft}>{t('common.draft')}</Text>
                  ) : null}
                </View>

                <Ionicons
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textMuted}
                />
              </Pressable>

              {expanded ? (
                <View style={styles.body}>
                  {/* Which language you are reading, and every one on offer.
                      Shown even with a single translation, so nobody has to
                      wonder whether there is another. */}
                  {languages.length > 0 ? (
                    <View style={styles.langRow}>
                      {languages.map((code) => {
                        const active = rendering?.language === code;
                        return (
                          <Pressable
                            key={code}
                            onPress={() => setReading((r) => ({ ...r, [entry.id]: code }))}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: active }}
                            style={[styles.langChip, active && styles.langChipOn]}
                          >
                            <Text style={[styles.langText, active && styles.langTextOn]}>
                              {LANGUAGES.find((l) => l.code === code)?.nativeName ?? code}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}

                  {substituted ? (
                    <Text style={styles.substituted}>
                      {t('khutbah.notInYourLanguage', {
                        language:
                          LANGUAGES.find((l) => l.code === rendering.language)?.nativeName ??
                          rendering.language,
                      })}
                    </Text>
                  ) : null}

                  {rendering ? (
                    <Text
                      style={[
                        styles.text,
                        rendering.language === 'ar' && styles.textRtl,
                      ]}
                    >
                      {rendering.text}
                    </Text>
                  ) : (
                    <Text style={styles.noTranslation}>{t('khutbah.noTranslation')}</Text>
                  )}

                  {entry.audioUrl ? (
                    <Button
                      label={t('khutbah.listen')}
                      icon="play-circle-outline"
                      variant="outline"
                      size="sm"
                      onPress={() => Linking.openURL(entry.audioUrl!).catch(() => undefined)}
                      style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}
                    />
                  ) : null}

                  {canEdit ? (
                    <Pressable
                      onPress={() => startEdit(entry)}
                      accessibilityRole="button"
                      style={styles.editRow}
                    >
                      <Ionicons name="create-outline" size={14} color={colors.primary} />
                      <Text style={styles.editText}>{t('common.edit')}</Text>
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
        visible={sheetOpen}
        title={editing ? t('common.edit') : t('khutbah.add')}
        onClose={closeSheet}
        onSubmit={save}
        submitLabel={t('common.save')}
        submitting={saving}
      >
        <Select<KhutbahKind>
          label={t('khutbah.kindLabel')}
          value={form.kind}
          options={[
            { value: 'jumuah', label: t('khutbah.kind_jumuah') },
            { value: 'bayan', label: t('khutbah.kind_bayan') },
          ]}
          onChange={(v) => setForm((f) => ({ ...f, kind: v }))}
        />
        <TextField
          label={t('common.title')}
          value={form.title}
          onChangeText={(v) => setForm((f) => ({ ...f, title: v }))}
          required
        />
        <DateField
          label={t('common.date')}
          value={form.date}
          onChange={(v) => setForm((f) => ({ ...f, date: v }))}
        />
        <TextField
          label={t('video.speaker')}
          value={form.speaker}
          onChangeText={(v) => setForm((f) => ({ ...f, speaker: v }))}
          icon="person-outline"
        />
        <TextField
          label={t('video.venue')}
          value={form.venue}
          onChangeText={(v) => setForm((f) => ({ ...f, venue: v }))}
          icon="location-outline"
        />
        <Select<LanguageCode>
          label={t('khutbah.deliveredIn')}
          value={form.deliveredIn}
          options={LANGUAGES.map((l) => ({ value: l.code, label: l.nativeName }))}
          onChange={(v) => setForm((f) => ({ ...f, deliveredIn: v }))}
        />
        <TextField
          label={t('khutbah.audioUrl')}
          value={form.audioUrl}
          onChangeText={(v) => setForm((f) => ({ ...f, audioUrl: v }))}
          icon="link-outline"
          autoCapitalize="none"
        />

        <Text style={styles.editorHint}>{t('khutbah.translationsHint')}</Text>

        {LANGUAGES.map((option) => (
          <TextField
            key={option.code}
            label={option.nativeName}
            value={form.translations[option.code] ?? ''}
            onChangeText={(v) =>
              setForm((f) => ({
                ...f,
                translations: { ...f.translations, [option.code]: v },
              }))
            }
            multiline
          />
        ))}

        <Select<ContentStatus>
          label={t('common.status')}
          value={form.status}
          options={[
            { value: 'published', label: t('common.published') },
            { value: 'draft', label: t('common.draft') },
          ]}
          onChange={(v) => setForm((f) => ({ ...f, status: v }))}
        />
      </FormSheet>
    </>
  );
}

interface FormState {
  kind: KhutbahKind;
  title: string;
  date: string;
  speaker: string;
  venue: string;
  deliveredIn: LanguageCode;
  audioUrl: string;
  status: ContentStatus;
  translations: Partial<Record<LanguageCode, string>>;
}

function emptyForm(): FormState {
  return {
    kind: 'jumuah',
    title: '',
    date: toISODate(),
    speaker: '',
    venue: '',
    // Arabic, because that is what the khutbah here is delivered in and a
    // default that is right nine times in ten saves a field being touched.
    deliveredIn: 'ar',
    audioUrl: '',
    status: 'published',
    translations: {},
  };
}

function toForm(entry: KhutbahEntry): FormState {
  return {
    kind: entry.kind,
    title: entry.title,
    date: entry.date,
    speaker: entry.speaker ?? '',
    venue: entry.venue ?? '',
    deliveredIn: entry.deliveredIn,
    audioUrl: entry.audioUrl ?? '',
    status: entry.status,
    translations: { ...(entry.translations ?? {}) },
  };
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md, padding: 0, overflow: 'hidden' },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  kindDot: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindDotJumuah: { backgroundColor: colors.infoSoft },
  title: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },
  meta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 2 },
  draft: { fontSize: 10, color: colors.warning, fontWeight: fontWeight.bold, marginTop: 2 },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    padding: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  langRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  langChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: 5,
  },
  langChipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  langText: { fontSize: fontSize.xs, color: colors.textSecondary },
  langTextOn: { color: colors.textInverse, fontWeight: fontWeight.semibold },
  substituted: {
    fontSize: fontSize.xs,
    color: colors.warning,
    marginBottom: spacing.sm,
    lineHeight: 17,
  },
  text: { fontSize: fontSize.sm, color: colors.text, lineHeight: 23 },
  textRtl: { textAlign: 'right', writingDirection: 'rtl', fontSize: fontSize.md, lineHeight: 32 },
  noTranslation: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 18 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.lg },
  editText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.primary },
  editorHint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
});
