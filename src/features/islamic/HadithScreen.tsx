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
import { LanguageMenu } from '@/components/shared/LanguageMenu';
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
    matchesSearch(search, h.text, h.reference, String(h.number))
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

        {/* Said plainly rather than silently showing English under a Tamil
            setting: only Bukhari and Muslim have a Tamil translation here. */}
        {current?.fellBackToEnglish ? (
          <Card style={styles.notice}>
            <Ionicons name="language-outline" size={18} color={colors.warning} />
            <Text style={styles.noticeText}>{t('hadith.englishFallback')}</Text>
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
                <View style={styles.refRow}>
                  <View style={styles.refChip}>
                    <Text style={styles.refText}>{h.reference}</Text>
                  </View>
                  <Text style={styles.number}>#{h.number}</Text>
                </View>
                <Text
                  style={[styles.text, language === 'ar' ? styles.arabic : null]}
                >
                  {h.text}
                </Text>
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
  onPress,
}: {
  name: string;
  sahih?: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
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
        {sahih ? <Text style={styles.sahihTag}>{t('hadith.sahih')}</Text> : null}
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
  sahihTag: { fontSize: fontSize.xs, color: colors.success, marginTop: 1 },
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
  arabic: { fontSize: 22, lineHeight: 44, textAlign: 'right', writingDirection: 'rtl' },
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
