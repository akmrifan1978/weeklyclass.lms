import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useLanguageScope } from '@/hooks/useLanguageScope';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { matchesSearch } from '@/utils/format';
import {
  TAJWEED_CATEGORY_KEYS,
  TAJWEED_RULES,
  type TajweedCategory,
} from '@/constants/tajweed';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import {
  AppHeader,
  Card,
  EmptyState,
  Screen,
  SearchField,
  SectionHeader,
} from '@/components/ui';

const CATEGORY_ORDER: TajweedCategory[] = ['noonSakinah', 'meemSakinah', 'madd', 'other'];

/**
 * Tajweed rules, as a reference to check something against mid-recitation.
 *
 * Grouped by what triggers the rule rather than listed flat, because that is how
 * they are taught and how you look one up: you know you are looking at a noon
 * sakinah and want to know which of the four applies.
 */
export function TajweedScreen({ headerTint }: { headerTint?: string }) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguageScope('quran');
  const [search, setSearch] = useState('');

  const grouped = useMemo(() => {
    const matching = TAJWEED_RULES.filter((rule) =>
      matchesSearch(search, rule.name, rule.arabic, t(rule.descriptionKey), rule.letters)
    );
    return CATEGORY_ORDER.map((category) => ({
      category,
      rules: matching.filter((rule) => rule.category === category),
    })).filter((group) => group.rules.length > 0);
  }, [search, t]);

  return (
    <>
      <AppHeader
        title={t('nav.tajweed')}
        showBack
        right={<LanguageMenu value={language} onChange={setLanguage} tint={headerTint} />}
      />
      <Screen>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder={t('tajweed.searchRule')}
        />

        {/*
          Which reading these describe is stated up front, not buried. Durations
          and some details differ between the authentic readings, and presenting
          one as simply "the rules" would be quietly wrong for anyone taught
          another.
        */}
        <Card style={styles.notice}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.noticeText}>{t('tajweed.readingNote')}</Text>
        </Card>

        {grouped.length === 0 ? (
          <EmptyState icon="search-outline" title={t('empty.noResults')} />
        ) : (
          grouped.map((group) => (
            <View key={group.category}>
              <SectionHeader
                title={t(TAJWEED_CATEGORY_KEYS[group.category])}
                icon="library-outline"
              />
              {group.rules.map((rule) => (
                <Card key={rule.id} style={styles.rule}>
                  <View style={styles.ruleHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.ruleName}>{rule.name}</Text>
                    </View>
                    <Text style={styles.ruleArabic}>{rule.arabic}</Text>
                  </View>

                  <Text style={styles.ruleDescription}>{t(rule.descriptionKey)}</Text>

                  {rule.letters ? (
                    <View style={styles.lettersBlock}>
                      <Text style={styles.lettersLabel}>{t('tajweed.letters')}</Text>
                      <Text style={styles.letters}>{rule.letters}</Text>
                    </View>
                  ) : null}

                  {rule.example ? (
                    <View style={styles.exampleBlock}>
                      <Text style={styles.exampleText}>{rule.example.text}</Text>
                      <Text style={styles.exampleRef}>{rule.example.reference}</Text>
                    </View>
                  ) : null}
                </Card>
              ))}
            </View>
          ))
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  noticeText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17 },
  rule: { marginBottom: spacing.md },
  ruleHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ruleName: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  // Arabic terms need more room and a larger size than the Latin heading beside
  // them; at body size the diacritics are unreadable.
  ruleArabic: {
    fontSize: 22,
    color: brand.orange,
    writingDirection: 'rtl',
    lineHeight: 34,
  },
  ruleDescription: {
    fontSize: fontSize.sm,
    lineHeight: 21,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  lettersBlock: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  lettersLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  letters: {
    fontSize: 24,
    color: colors.text,
    writingDirection: 'rtl',
    textAlign: 'right',
    lineHeight: 40,
    marginTop: 2,
  },
  exampleBlock: {
    marginTop: spacing.md,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  exampleText: {
    flex: 1,
    fontSize: 24,
    color: colors.text,
    writingDirection: 'rtl',
    textAlign: 'right',
    lineHeight: 42,
  },
  exampleRef: { fontSize: fontSize.xs, color: brand.orange, fontWeight: fontWeight.bold },
});
