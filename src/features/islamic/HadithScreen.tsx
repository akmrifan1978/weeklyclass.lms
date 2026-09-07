import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useLanguageScope } from '@/hooks/useLanguageScope';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { matchesSearch } from '@/utils/format';
import * as hadithService from '@/services/hadithService';
import * as translateService from '@/services/translateService';
import type { LanguageCode } from '@/types';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import { ScriptureText } from './ScriptureText';
import {
  AppHeader,
  Button,
  Card,
  EmptyState,
  Screen,
  SearchField,
  SectionHeader,
  SkeletonList,
} from '@/components/ui';

/**
 * Hadith, from the canonical collections.
 *
 * The two Ṣaḥīḥs are marked as such and listed first, because someone looking
 * for an authentic narration wants those. The rest of the Six are offered too,
 * clearly separated — within them individual reports carry different gradings,
 * and this dataset does not include those, so the screen does not pretend
 * everything here carries the same weight.
 *
 * Every narration shows its collection, book and number. That reference is what
 * lets someone verify it against a printed edition, which matters more here than
 * anywhere else in the app.
 */
export function HadithScreen({ headerTint }: { headerTint?: string }) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguageScope('hadith');

  const [collection, setCollection] = useState<string | null>(null);
  const [section, setSection] = useState(1);
  /**
   * Machine glosses, keyed by hadith number.
   *
   * Requested one at a time rather than for the whole book: the free service
   * allows a few thousand characters a day, and a reader wants the narration in
   * front of them, not ninety they will never scroll to.
   */
  const [glosses, setGlosses] = useState<
    Record<number, { text?: string; loading?: boolean; error?: string }>
  >({});

  const requestGloss = useCallback(
    async (number: number, english: string) => {
      setGlosses((g) => ({ ...g, [number]: { loading: true } }));
      try {
        const text = await translateService.translate(english, 'en', language);
        setGlosses((g) => ({ ...g, [number]: { text } }));
      } catch (err) {
        const reason =
          err instanceof translateService.TranslationUnavailable ? err.reason : 'network';
        setGlosses((g) => ({
          ...g,
          [number]: { error: t(`scripture.translateFailed_${reason}`) },
        }));
      }
    },
    [language, t]
  );

  const [search, setSearch] = useState('');

  const loadCollections = useCallback(
    () => hadithService.listCollections(language),
    [language]
  );
  const { data: collections, loading: loadingList } = useAsync(loadCollections, [
    loadCollections,
  ]);

  const loadSection = useCallback(
    () =>
      collection
        ? hadithService.getSection(collection, section, language)
        : Promise.resolve(null),
    [collection, section, language]
  );
  const {
    data: current,
    loading: loadingSection,
    error,
    reload,
  } = useAsync(loadSection, [loadSection], { enabled: Boolean(collection) });

  const visible = (current?.hadiths ?? []).filter((h) =>
    matchesSearch(search, h.arabic, h.translation, h.reference, String(h.number))
  );

  if (!collection) {
    return (
      <>
        <AppHeader
          title={t('nav.hadith')}
          showBack
          right={<LanguageMenu value={language} onChange={setLanguage} tint={headerTint} />}
        />
        <Screen>
          <Card style={styles.notice}>
            <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
            <Text style={styles.noticeText}>{t('hadith.authenticityNote')}</Text>
          </Card>

          {/* Coverage stated before anything is opened, so nobody picks a
              collection expecting Tamil and finds English. */}
          <Card style={styles.notice}>
            <Ionicons name="language-outline" size={18} color={colors.textMuted} />
            <Text style={styles.noticeText}>{t('hadith.coverageNote')}</Text>
          </Card>

          {loadingList ? (
            <SkeletonList count={6} />
          ) : (
            <>
              <SectionHeader title={t('hadith.sahihCollections')} icon="shield-checkmark-outline" />
              {(collections ?? [])
                .filter((c) => c.sahih)
                .map((c) => (
                  <CollectionRow
                    key={c.id}
                    name={c.name}
                    sahih
                    collectionId={c.id}
                    translated={c.translated}
                    language={language}
                    onPress={() => {
                      setCollection(c.id);
                      setSection(1);
                    }}
                  />
                ))}

              <SectionHeader title={t('hadith.otherCollections')} icon="library-outline" />
              {(collections ?? [])
                .filter((c) => !c.sahih)
                .map((c) => (
                  <CollectionRow
                    key={c.id}
                    name={c.name}
                    collectionId={c.id}
                    translated={c.translated}
                    language={language}
                    onPress={() => {
                      setCollection(c.id);
                      setSection(1);
                    }}
                  />
                ))}
            </>
          )}
        </Screen>
      </>
    );
  }

  return (
    <>
      <AppHeader
        title={current?.collectionName ?? t('nav.hadith')}
        subtitle={current?.sectionName}
        showBack
        onBack={() => setCollection(null)}
        right={<LanguageMenu value={language} onChange={setLanguage} tint={headerTint} />}
      />
      <Screen>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t('hadith.searchInBook')}
        />

        {/* Which language the reader is actually looking at, said once at the
            top rather than left to be inferred. English standing in for Tamil
            is help; English standing in for Tamil without saying so is a reader
            unable to tell a translation from the narration. */}
        {current && !current.hasTranslation ? (
          <Card style={styles.notice}>
            <Ionicons name="language-outline" size={18} color={colors.warning} />
            <Text style={styles.noticeText}>{t('hadith.arabicOnlyNotice')}</Text>
          </Card>
        ) : current?.isFallbackLanguage ? (
          <Card style={styles.notice}>
            <Ionicons name="language-outline" size={18} color={colors.warning} />
            <Text style={styles.noticeText}>{t('hadith.englishFallbackNotice')}</Text>
          </Card>
        ) : null}

        {loadingSection ? (
          <SkeletonList count={5} />
        ) : error ? (
          <EmptyState
            icon="cloud-offline-outline"
            title={t('errors.networkUnavailable')}
            message={friendlyMessage(error, t)}
            actionLabel={t('common.retry')}
            onAction={reload}
          />
        ) : visible.length === 0 ? (
          <EmptyState icon="search-outline" title={t('empty.noResults')} />
        ) : (
          <>
            {visible.map((h) => (
              <Card key={h.number} style={styles.hadith}>
                {/* One component decides how Arabic and translation are shown
                    everywhere, so no screen can quietly break the rule. */}
                <ScriptureText
                  arabic={h.arabic}
                  arabicSize={22}
                  translation={
                    h.translation
                      ? {
                          text: h.translation,
                          // The edition's language, not the reader's. Labelling
                          // an English rendering as Tamil is the exact mistake
                          // the fallback has to avoid making.
                          language: current?.translationLanguage ?? language,
                          source: current?.translationSource,
                        }
                      : null
                  }
                  machine={
                    current?.isFallbackLanguage && h.translation
                      ? {
                          text: glosses[h.number]?.text ?? null,
                          language,
                          loading: glosses[h.number]?.loading,
                          error: glosses[h.number]?.error,
                          onRequest: () => void requestGloss(h.number, h.translation!),
                        }
                      : null
                  }
                  badge={
                    <>
                      <View style={styles.refChip}>
                        <Text style={styles.refText}>{h.reference}</Text>
                      </View>
                      <Text style={styles.number}>#{h.number}</Text>
                    </>
                  }
                />
              </Card>
            ))}

            <View style={styles.pager}>
              <Button
                label={t('hadith.previousBook')}
                icon="chevron-back"
                variant="outline"
                size="sm"
                disabled={section <= 1}
                onPress={() => setSection((n) => Math.max(1, n - 1))}
              />
              <Text style={styles.pagerLabel}>
                {t('hadith.bookNumber', { number: section })}
              </Text>
              <Button
                label={t('hadith.nextBook')}
                icon="chevron-forward"
                variant="outline"
                size="sm"
                onPress={() => setSection((n) => n + 1)}
              />
            </View>
          </>
        )}
      </Screen>
    </>
  );
}

function CollectionRow({
  name,
  sahih,
  collectionId,
  translated,
  language,
  onPress,
}: {
  name: string;
  sahih?: boolean;
  /** False when this collection has no edition in the reader's language. */
  collectionId: string;
  translated: boolean;
  language: LanguageCode;
  onPress: () => void;
}) {
  const { t } = useTranslation();

  // Asked of the same function the reader will actually get their text from,
  // rather than inferred. Inferring it labelled every collection "English" for
  // an Arabic reader, who is shown no translation at all.
  const choice = hadithService.editionFor(collectionId, language);
  // An English reader being told "shown in English" is noise, not information.
  const flagFallback = choice.isFallback && language !== 'en';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      style={({ pressed }) => [styles.collection, pressed ? styles.pressed : null]}
    >
      <Ionicons
        name={sahih ? 'shield-checkmark' : 'book-outline'}
        size={20}
        color={sahih ? colors.success : colors.primary}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.collectionName}>{name}</Text>
        <View style={styles.tagRow}>
          {sahih ? <Text style={styles.sahihTag}>{t('hadith.sahih')}</Text> : null}
          {flagFallback ? (
            <Text style={styles.fallbackTag}>{t('hadith.englishOnly')}</Text>
          ) : translated ? (
            <Text style={styles.translatedTag}>{t('hadith.translationAvailable')}</Text>
          ) : null}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
    marginTop: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  noticeText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17 },
  collection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  pressed: { opacity: 0.7 },
  collectionName: { fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.medium },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 2 },
  sahihTag: { fontSize: fontSize.xs, color: colors.success },
  translatedTag: { fontSize: fontSize.xs, color: colors.textMuted },
  fallbackTag: { fontSize: fontSize.xs, color: colors.warning },
  hadith: { marginBottom: spacing.md },
  refRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  refChip: {
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  refText: { fontSize: fontSize.xs, color: brand.orange, fontWeight: fontWeight.bold },
  number: { fontSize: fontSize.xs, color: colors.textMuted },
  text: { fontSize: fontSize.sm, lineHeight: 23, color: colors.text },
  // Arabic needs the extra size and line height, same as the Qur'an screens.
  arabic: {
    fontSize: 22,
    lineHeight: 44,
    textAlign: 'right',
    writingDirection: 'rtl',
    color: colors.text,
  },
  translation: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    color: colors.textSecondary,
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.xxl,
  },
  pagerLabel: { fontSize: fontSize.xs, color: colors.textMuted },
});
