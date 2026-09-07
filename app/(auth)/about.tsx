import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { brand, colors, fontSize, fontWeight, radius, shadow, spacing } from '@/constants/theme';
import { IconButton } from '@/components/ui';

/**
 * What this programme is, readable before anybody signs in.
 *
 * Reachable from the sign-in screen rather than from inside the app, because
 * the person who most needs it is the one deciding whether to register at all —
 * putting it behind a login answers the question only for people who have
 * already stopped asking it.
 *
 * The text lives in the translation bundles, in all four languages, so it
 * follows whatever language the reader has chosen and works with no network.
 * The alternative — translating it at read time — would spend a daily quota on
 * the same fixed paragraphs for every visitor, and give worse Tamil than a
 * person writing it once.
 */

const MISSION_POINTS = [
  'about.mission1',
  'about.mission2',
  'about.mission3',
  'about.mission4',
  'about.mission5',
  'about.mission6',
  'about.mission7',
  'about.mission8',
  'about.mission9',
] as const;

export default function AboutScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.bar}>
        <IconButton
          icon="chevron-back"
          label={t('common.back')}
          onPress={() => router.back()}
          background="rgba(255,255,255,0.12)"
          color={colors.textInverse}
        />
        <Text style={styles.barTitle} numberOfLines={1} accessibilityRole="header">
          {t('about.title')}
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          {/* No language picker here, deliberately. Changing the language
              remounts enough of the tree that the root guard re-evaluates, sees
              a signed-in user on an `(auth)` route mid-transition, and throws
              the reader back to their dashboard mid-paragraph. The sign-in
              screen carries a chooser immediately beside the link to this page,
              which is a better place for it anyway: the language is picked once
              and everything after it, including this, follows. */}
          <Section icon="school-outline" title={t('about.programTitle')} />
          <Text style={styles.body}>{t('about.programBody1')}</Text>
          <Text style={styles.body}>{t('about.programBody2')}</Text>
          <Text style={styles.body}>{t('about.programBody3')}</Text>

          <Section icon="eye-outline" title={t('about.visionTitle')} />
          <Text style={styles.body}>{t('about.visionBody')}</Text>

          <Section icon="flag-outline" title={t('about.missionTitle')} />
          <Text style={styles.body}>{t('about.missionIntro')}</Text>
          {MISSION_POINTS.map((key) => (
            <View key={key} style={styles.point}>
              <Ionicons name="checkmark-circle" size={15} color={brand.orange} />
              <Text style={styles.pointText}>{t(key)}</Text>
            </View>
          ))}

          <Section icon="heart-outline" title={t('about.commitmentTitle')} />
          <Text style={styles.body}>{t('about.commitmentBody1')}</Text>
          <Text style={styles.body}>{t('about.commitmentBody2')}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({
  icon,
  title,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
}) {
  return (
    <View style={styles.sectionRow}>
      <Ionicons name={icon} size={17} color={brand.orange} />
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.navyDeep },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  barTitle: {
    flex: 1,
    color: colors.textInverse,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  scroll: { padding: spacing.lg, paddingTop: 0 },
  card: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadow.lg,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.primary,
  },
  body: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 23,
    marginBottom: spacing.sm,
  },
  point: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: 6,
  },
  pointText: { flex: 1, fontSize: fontSize.sm, color: colors.text, lineHeight: 21 },
});
