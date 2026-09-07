import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as calendarService from '@/services/calendarService';
import { useTranslation } from 'react-i18next';

import { useLanguage } from '@/contexts/LanguageContext';
import { APP_NAME } from '@/constants/app';
import { useAsync } from '@/hooks/useAsync';
import { getSettings } from '@/services/settingsService';
import {
  brand,
  colors,
  fontSize,
  fontWeight,
  radius,
  shadow,
  spacing,
  TOUCH_TARGET,
} from '@/constants/theme';
import type { LanguageCode, UserRole } from '@/types';

/**
 * Splash / entry screen.
 *
 * Three clearly separated ways in, plus registration, account recovery and the
 * language picker — everything a first-time visitor needs before signing in.
 */

const ROLES: {
  role: UserRole;
  labelKey: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
}[] = [
  { role: 'student', labelKey: 'auth.studentLogin', icon: 'school-outline', tint: brand.orange },
  { role: 'teacher', labelKey: 'auth.teacherLogin', icon: 'people-outline', tint: brand.orangeLight },
  { role: 'admin', labelKey: 'auth.adminLogin', icon: 'shield-checkmark-outline', tint: brand.slate },
];

export default function SplashScreen() {
  const [classes, setClasses] = useState<calendarService.PublicClass[]>([]);

  useEffect(() => {
    // Best effort and silent: the sign-in screen must render whether or not
    // this succeeds, and a visitor who cannot see the schedule can still sign
    // in, which is what the screen is for.
    let cancelled = false;
    calendarService
      .listPublicClasses(4)
      .then((rows) => {
        if (!cancelled) setClasses(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const { t } = useTranslation();
  // `settings/app` is world-readable precisely so this screen can show the
  // organisation's own identity before anyone signs in.
  const { data: settings } = useAsync(() => getSettings(), []);
  const router = useRouter();
  const { language, available, setLanguage } = useLanguage();
  const [switchingLanguage, setSwitchingLanguage] = useState(false);

  const handleLanguage = async (code: LanguageCode) => {
    if (switchingLanguage) return;
    setSwitchingLanguage(true);
    try {
      await setLanguage(code);
    } finally {
      setSwitchingLanguage(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.inner}>
          <View style={styles.brandBlock}>
            {/* The organisation's own mark when they have set one. The book is
                a placeholder for a platform nobody has branded yet, and it
                should give way the moment somebody uploads a logo. */}
            <View style={styles.logo}>
              {settings?.logoUrl ? (
                <Image
                  source={{ uri: settings.logoUrl }}
                  style={styles.logoImage}
                  resizeMode="contain"
                  accessibilityLabel={settings?.appName?.trim() || APP_NAME}
                />
              ) : (
                <Ionicons name="book" size={38} color={brand.orange} />
              )}
            </View>
            {/*
              Read from Settings, not from the bundled constants: an
              organisation that has renamed the platform or set its venue should
              see that on the one screen everybody meets before signing in. The
              constants remain the fallback for a first run, when settings have
              not loaded or have never been saved.
            */}
            <Text style={styles.appName} accessibilityRole="header">
              {settings?.appName?.trim() || APP_NAME}
            </Text>
            {settings?.venue?.trim() ? (
              <Text style={styles.venue}>
                {t('settings.venueLabel')}: {settings.venue.trim()}
              </Text>
            ) : null}
            <View style={styles.rule} />
            <Text style={styles.tagline}>
              {settings?.tagline?.trim() || t('app.tagline')}
            </Text>
          </View>

          <View style={styles.roleBlock}>
            <Text style={styles.sectionLabel}>{t('auth.chooseRole')}</Text>

            {ROLES.map((item) => (
              <Pressable
                key={item.role}
                onPress={() => router.push({ pathname: '/(auth)/login', params: { role: item.role } })}
                accessibilityRole="button"
                accessibilityLabel={t(item.labelKey)}
                style={({ pressed }) => [styles.roleButton, { opacity: pressed ? 0.88 : 1 }]}
              >
                <View style={[styles.roleIcon, { backgroundColor: `${item.tint}22` }]}>
                  <Ionicons name={item.icon} size={22} color={item.tint} />
                </View>
                <Text style={styles.roleLabel}>{t(item.labelKey)}</Text>
                <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>

          <View style={styles.linkRow}>
            <LinkButton
              label={t('auth.register')}
              icon="person-add-outline"
              onPress={() => router.push('/(auth)/register')}
            />
            <LinkButton
              label={t('auth.forgotUsername')}
              icon="help-circle-outline"
              onPress={() => router.push('/(auth)/forgot-username')}
            />
            <LinkButton
              label={t('auth.forgotPassword')}
              icon="key-outline"
              onPress={() => router.push('/(auth)/forgot-password')}
            />
            {/* Readable before signing in, on purpose: somebody deciding whether
                to register is exactly the person who needs to know what the
                programme is. */}
            <LinkButton
              label={t('about.title')}
              icon="information-circle-outline"
              onPress={() => router.push('/(auth)/about')}
            />
          </View>

          {/* After the programme description, deliberately: somebody has just
              read what this is, and the next question is when it happens.
              Drawn from the thin public copy of the schedule — no meeting
              links reach this screen. */}
          {classes.length > 0 ? (
            <View style={styles.classesBlock}>
              <Text style={styles.sectionLabel}>{t('dashboard.upcomingClasses')}</Text>
              {classes.map((item) => (
                <View key={item.id} style={styles.classRow}>
                  {item.bannerUrl ? (
                    <Image source={{ uri: item.bannerUrl }} style={styles.classPhoto} />
                  ) : (
                    <View style={[styles.classPhoto, styles.classPhotoEmpty]}>
                      <Ionicons name="calendar" size={18} color={brand.orange} />
                    </View>
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.classTitle} numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text style={styles.classFact} numberOfLines={1}>
                      {item.date}
                      {item.startTime ? `  ·  ${item.startTime}` : ''}
                      {item.venue ? `  ·  ${item.venue}` : ''}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.languageBlock}>
            <Text style={styles.sectionLabel}>{t('auth.chooseLanguage')}</Text>
            <View style={styles.languageRow}>
              {available.map((option) => {
                const active = option.code === language;
                return (
                  <Pressable
                    key={option.code}
                    onPress={() => handleLanguage(option.code as LanguageCode)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={option.name}
                    style={({ pressed }) => [
                      styles.languageChip,
                      active ? styles.languageChipActive : null,
                      { opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <Text
                      style={[styles.languageText, active ? styles.languageTextActive : null]}
                    >
                      {option.nativeName}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function LinkButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.link, { opacity: pressed ? 0.65 : 1 }]}
    >
      <Ionicons name={icon} size={15} color={brand.sandLight} />
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  classesBlock: { width: '100%', maxWidth: 420, alignSelf: 'center', marginTop: spacing.xl },
  classRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  classPhoto: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.surface },
  classPhotoEmpty: { alignItems: 'center', justifyContent: 'center' },
  classTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.textInverse },
  classFact: { fontSize: fontSize.xs, color: 'rgba(255,255,255,0.72)', marginTop: 2 },
  container: { flex: 1, backgroundColor: brand.navyDeep },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  inner: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  brandBlock: { alignItems: 'center', marginBottom: spacing.huge },
  logo: {
    width: 84,
    height: 84,
    borderRadius: radius.xxl,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
    overflow: 'hidden',
    ...shadow.lg,
  },
  // Inset, so a square logo does not sit corner-to-corner in a rounded tile.
  logoImage: { width: 64, height: 64 },
  appName: {
    fontSize: fontSize.display,
    fontWeight: fontWeight.heavy,
    color: colors.textInverse,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  rule: {
    width: 56,
    height: 3,
    borderRadius: radius.pill,
    backgroundColor: brand.orange,
    marginVertical: spacing.lg,
  },
  venue: {
    fontSize: 13,
    color: brand.sandLight,
    textAlign: 'center',
    marginTop: 6,
  },
  tagline: {
    fontSize: fontSize.sm,
    color: brand.sandLight,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: spacing.lg,
  },
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: brand.slate,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  roleBlock: { marginBottom: spacing.xl },
  roleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    minHeight: 62,
    ...shadow.md,
  },
  roleIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleLabel: {
    flex: 1,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  linkRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.lg,
    marginBottom: spacing.huge,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: TOUCH_TARGET - 12,
    paddingVertical: spacing.sm,
  },
  linkText: {
    fontSize: fontSize.sm,
    color: brand.sandLight,
    fontWeight: fontWeight.medium,
  },
  languageBlock: { alignItems: 'center' },
  languageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  languageChip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    minHeight: 38,
    justifyContent: 'center',
  },
  languageChipActive: { backgroundColor: brand.orange, borderColor: brand.orange },
  languageText: { color: brand.sandLight, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  languageTextActive: { color: colors.textInverse, fontWeight: fontWeight.bold },
});
