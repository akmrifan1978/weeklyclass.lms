import React, { useEffect, useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { formatShortDate } from '@/utils/date';
import * as calendarService from '@/services/calendarService';
import { FooterTicker } from '@/components/shared/FooterTicker';
import { InstallPrompt } from '@/components/shared/InstallPrompt';
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
];

/**
 * Staff ways in, deliberately smaller than the student one.
 *
 * Almost everybody arriving at this screen is a student, and three equal cards
 * asked every one of them to work out which of the three they are. Worse, two
 * of the answers are wrong for them, and a student who picks "Admin Login"
 * learns only that their password does not work — the screen having implied
 * the choice was theirs to make.
 *
 * So the student route is the button, and staff get a quiet pair beneath it.
 * Nothing is hidden: a teacher still finds theirs at a glance, because they
 * know which one they are looking for and a student does not.
 */
const STAFF_ROLES: {
  role: UserRole;
  labelKey: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { role: 'teacher', labelKey: 'auth.teacherLogin', icon: 'people-outline' },
  { role: 'admin', labelKey: 'auth.adminLogin', icon: 'shield-checkmark-outline' },
];

/**
 * "Venue: Jeddah Dawah Center" rather than "Venue: Venue: Jeddah Dawah Center".
 *
 * The label is added by this screen, and somebody filling in the setting
 * reasonably typed it into the field as well — which read as a stutter on the
 * first line anybody sees. Rather than editing what they wrote, the label is
 * only added when it is not already there.
 *
 * Matched case-insensitively and against whatever the label currently is, so
 * this keeps working in Tamil, Sinhala and Arabic and does not quietly become
 * an English-only fix.
 */
function withVenueLabel(venue: string, label: string): string {
  const value = venue.trim();
  const prefix = `${label.trim().replace(/:$/, '')}:`;
  return value.toLowerCase().startsWith(prefix.toLowerCase())
    ? value
    : `${prefix} ${value}`;
}

export default function SplashScreen() {
  /**
   * How much air the page can afford.
   *
   * The two gaps this feeds were a fixed 48px each. Together that is nearly a
   * fifth of a small phone's screen spent on nothing, pushing the sign-in
   * buttons towards the fold on exactly the devices most people arrive on —
   * while a desktop, where the room actually exists, got the same 48.
   */
  const { height: screenHeight } = useWindowDimensions();
  const blockGap = screenHeight < 700 ? spacing.lg : screenHeight < 900 ? spacing.xl : spacing.huge;

  const [classes, setClasses] = useState<calendarService.PublicClass[]>([]);

  useEffect(() => {
    // A live subscription rather than one fetch. An event the admin adds shows
    // up on this screen without anybody reloading it, and the last known list
    // is drawn from Firestore's own cache first — so a visitor with no
    // connection still sees what is coming up, and it corrects itself the
    // moment there is a network again.
    //
    // Still best effort and still silent: a sign-in screen that cannot load
    // its advertisement is a sign-in screen, which is what it is for.
    return calendarService.watchPublicSchedule(6, setClasses);
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
          {/* Top corner, before anything else.
              It used to sit at the very foot of the page, under the sign-in
              buttons and the events, which is the last place somebody who
              cannot read the page in English would think to look — and they
              have to find it before any of the rest of the page is useful to
              them. Right-aligned and compact so it reads as a control rather
              than a section. */}
          <View style={styles.languageBar}>
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
                  <Text style={[styles.languageText, active ? styles.languageTextActive : null]}>
                    {option.nativeName}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Above everything else, on the one screen every visitor sees. It
              draws nothing at all until the browser says an install is
              possible. */}
          <InstallPrompt />

          <View style={[styles.brandBlock, { marginBottom: blockGap }]}>
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
                {withVenueLabel(settings.venue, t('settings.venueLabel'))}
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

            <View style={styles.staffRow}>
              {STAFF_ROLES.map((item) => (
                <Pressable
                  key={item.role}
                  onPress={() =>
                    router.push({ pathname: '/(auth)/login', params: { role: item.role } })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={t(item.labelKey)}
                  style={({ pressed }) => [styles.staffButton, { opacity: pressed ? 0.7 : 1 }]}
                >
                  <Ionicons name={item.icon} size={15} color={brand.sandLight} />
                  <Text style={styles.staffLabel} numberOfLines={1}>
                    {t(item.labelKey)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={[styles.linkRow, { marginBottom: blockGap }]}>
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
            {/* A way in that asks for nothing. Somebody weighing this up can
                watch what has been released before handing over a number. */}
            <LinkButton
              label={t('guest.enter')}
              icon="eye-outline"
              onPress={() => router.push('/(auth)/guest')}
            />
          </View>

          {/* After the programme description, deliberately: somebody has just
              read what this is, and the next question is when it happens.
              Drawn from the thin public copy of the schedule — no meeting
              links reach this screen. */}
          {classes.length > 0 ? (
            <View style={styles.classesBlock}>
              {/* The organisation's own line, above the events it belongs to.
                  Reused rather than rebuilt: it reads the setting itself and
                  renders nothing at all when the ticker is switched off, so an
                  empty strip never costs vertical space here. */}
              <View style={styles.tickerWrap}>
                <FooterTicker />
              </View>

              <Text style={styles.sectionLabel}>{t('dashboard.upcomingClasses')}</Text>

              {/*
                Sideways rather than stacked. Three events down the page pushed
                the sign-in buttons off a phone screen entirely, which is the
                one thing this screen exists for. Across, the section costs one
                card's height however many events there are, and the cards that
                do not fit are a swipe away rather than a scroll away.
              */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.classStrip}
              >
                {classes.map((item) => (
                  <View key={item.id} style={styles.classCard}>
                    <View style={styles.classCardHead}>
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
                          {formatShortDate(item.date)}
                          {item.startTime ? `  ·  ${item.startTime}` : ''}
                        </Text>
                      </View>
                    </View>

                    {item.venue || item.location ? (
                      <Text style={styles.classFact} numberOfLines={1}>
                        {[item.venue, item.location].filter(Boolean).join(', ')}
                      </Text>
                    ) : null}

                    {item.description ? (
                      <Text style={styles.classBlurb} numberOfLines={2}>
                        {item.description}
                      </Text>
                    ) : null}

                    {/* Bookings live behind a sign-in — the seat count and the
                        ticket are not this screen's to show. So the button is
                        an honest one: it says registering is possible and
                        takes them to the door. */}
                    {item.takesBookings ? (
                      <Pressable
                        onPress={() => router.push('/(auth)/register')}
                        accessibilityRole="button"
                        style={styles.classAction}
                      >
                        <Text style={styles.classActionText}>{t('event.registerToBook')}</Text>
                        <Ionicons name="arrow-forward" size={11} color={brand.orange} />
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

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
  classesBlock: { width: '100%', maxWidth: 460, alignSelf: 'center', marginTop: spacing.xl },
  tickerWrap: { borderRadius: radius.md, overflow: 'hidden', marginBottom: spacing.md },
  classStrip: { gap: spacing.sm, paddingRight: spacing.xl, paddingVertical: 2 },
  classCard: {
    // Narrower than a phone's content width on purpose: at 236 the second card
    // sat exactly at the edge and looked clipped rather than scrollable. At
    // 196 the next one peeks in, which is what tells somebody to swipe.
    width: 196,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: 3,
  },
  classCardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  classPhoto: { width: 38, height: 38, borderRadius: radius.sm, backgroundColor: colors.surface },
  classPhotoEmpty: { alignItems: 'center', justifyContent: 'center' },
  classTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textInverse },
  classBlurb: {
    fontSize: fontSize.xs,
    color: 'rgba(255,255,255,0.62)',
    lineHeight: 15,
    marginTop: 2,
  },
  classAction: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  classActionText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: brand.orange,
  },
  classFact: { fontSize: fontSize.xs, color: 'rgba(255,255,255,0.72)', marginTop: 2 },
  container: { flex: 1, backgroundColor: brand.navyDeep },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  inner: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  brandBlock: { alignItems: 'center' },
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
    fontSize: fontSize.md,
    color: brand.sandLight,
    textAlign: 'center',
    marginTop: 6,
  },
  tagline: {
    fontSize: fontSize.md,
    color: brand.sandLight,
    textAlign: 'center',
    lineHeight: 22,
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
  staffRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  staffButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: spacing.md,
    // Short of the 44pt guideline on purpose is NOT what this is: the row is
    // padded to a comfortable tap target while reading as secondary.
    paddingVertical: 9,
  },
  staffLabel: { fontSize: fontSize.xs, color: brand.sandLight, fontWeight: fontWeight.semibold },
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
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    // A full touch target: Register and the two recovery links are the whole
    // way in for somebody without an account, and they were the smallest
    // things on the screen.
    minHeight: TOUCH_TARGET,
    paddingVertical: spacing.sm,
  },
  linkText: {
    fontSize: fontSize.md,
    color: brand.sandLight,
    fontWeight: fontWeight.semibold,
  },
  languageBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
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
