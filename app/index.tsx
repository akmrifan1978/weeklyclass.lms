import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { formatShortDate } from '@/utils/date';
import * as calendarService from '@/services/calendarService';
import { InstallPrompt } from '@/components/shared/InstallPrompt';
import { FlyerStrip } from '@/components/shared/FlyerStrip';
import { PublicPage } from '@/components/public/PublicPage';
import { bookingLabelKey, PublicCard, Tag } from '@/components/public/PublicControls';
import { PUBLIC_NAV } from '@/constants/publicNav';
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
import { tone } from '@/components/public/tone';
import type { UserRole } from '@/types';

/**
 * The front page.
 *
 * It answers two questions in order: what is this, and how do I get in. The
 * hero answers the first, the sign-in block answers the second, and everything
 * below is the case for coming back — the rest of the website, and what is on
 * next.
 *
 * It wears the same bar, hero and ground as every other public page, because a
 * front page that looks like a different site from the one it leads to is a
 * front page that has to be designed twice.
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
 */
const STAFF_ROLES: {
  role: UserRole;
  labelKey: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { role: 'teacher', labelKey: 'auth.teacherLogin', icon: 'people-outline' },
  { role: 'admin', labelKey: 'auth.adminLogin', icon: 'shield-checkmark-outline' },
];

/** The public pages worth a tile, in the order somebody would want them. */
const EXPLORE = [
  'nav.classes',
  'nav.teachers',
  'nav.lessons',
  'nav.videos',
  'nav.quran',
  'nav.contact',
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
  const { t } = useTranslation();
  const router = useRouter();
  const [classes, setClasses] = useState<calendarService.PublicClass[]>([]);

  // `settings/app` is world-readable precisely so this screen can show the
  // organisation's own identity before anyone signs in.
  const { data: settings } = useAsync(() => getSettings(), []);

  useEffect(() => {
    // A live subscription rather than one fetch. An event the admin adds shows
    // up on this screen without anybody reloading it, and the last known list
    // is drawn from Firestore's own cache first — so a visitor with no
    // connection still sees what is coming up, and it corrects itself the
    // moment there is a network again.
    //
    // Still best effort and still silent: a front page that cannot load its
    // advertisement is still a front page, which is what it is for.
    return calendarService.watchPublicSchedule(6, setClasses);
  }, []);

  const venue = settings?.venue?.trim();

  return (
    <PublicPage
      showLogo
      badge={venue ? withVenueLabel(venue, t('settings.venueLabel')) : t('public.home.badge')}
      title={settings?.appName?.trim() || APP_NAME}
      subtitle={settings?.tagline?.trim() || t('app.tagline')}
    >
      {/* At the top, above the sign-in choice. Somebody can close it, which
          is what makes putting an advertisement in front of the way in
          defensible rather than merely effective. */}
      <FlyerStrip position="home" />

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
            onPress={() => router.push({ pathname: '/(auth)/login', params: { role: item.role } })}
            accessibilityRole="button"
            accessibilityLabel={t(item.labelKey)}
            style={({ pressed }) => [styles.staffButton, { opacity: pressed ? 0.7 : 1 }]}
          >
            <Ionicons name={item.icon} size={15} color={tone.body} />
            <Text style={styles.staffLabel} numberOfLines={1}>
              {t(item.labelKey)}
            </Text>
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
        {/* Browse without an account. Here as well as on the login form,
            because this is the page everybody lands on — somebody not yet
            sure they want an account should not have to open a sign-in form
            to discover they can look around first. A guest is signed out, so
            event booking and weekly assignments stay closed to them by the
            security rules, not by this screen. */}
        <LinkButton
          label={t('guest.enter')}
          icon="eye-outline"
          onPress={() => router.push('/(auth)/guest')}
        />
      </View>

      {/* The rest of the website, on the page rather than only behind the menu.
          A hamburger is where somebody looks for a destination they already
          know exists; these tiles are how they find out that it does. */}
      <Text style={styles.sectionLabel}>{t('public.home.explore')}</Text>
      <View style={styles.tiles}>
        {EXPLORE.map((key) => {
          const item = PUBLIC_NAV.find((entry) => entry.key === key);
          if (!item) return null;
          return (
            <Pressable
              key={item.route}
              onPress={() => router.push(item.route as never)}
              accessibilityRole="link"
              accessibilityLabel={t(item.key)}
              style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.85 : 1 }]}
            >
              <View style={styles.tileIcon}>
                <Ionicons name={item.icon} size={18} color={brand.orange} />
              </View>
              <Text style={styles.tileLabel} numberOfLines={2}>
                {t(item.key)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Drawn from the thin public copy of the schedule — no meeting links
          reach this screen. Sideways rather than stacked, so the section costs
          one card's height however many events there are. */}
      {classes.length > 0 ? (
        <>
          <Text style={styles.sectionLabel}>{t('dashboard.upcomingClasses')}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.strip}
          >
            {classes.map((item) => (
              <View key={item.id} style={styles.eventCard}>
                <PublicCard>
                  <View style={styles.eventHead}>
                    {item.bannerUrl ? (
                      <Image source={{ uri: item.bannerUrl }} style={styles.eventPhoto} />
                    ) : (
                      <View style={[styles.eventPhoto, styles.eventPhotoEmpty]}>
                        <Ionicons name="calendar" size={18} color={brand.orange} />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.eventTitle} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <Text style={styles.eventFact} numberOfLines={1}>
                        {formatShortDate(item.date)}
                        {item.startTime ? `  ·  ${item.startTime}` : ''}
                      </Text>
                    </View>
                  </View>

                  {item.venue || item.location ? (
                    <Text style={styles.eventFact} numberOfLines={1}>
                      {[item.venue, item.location].filter(Boolean).join(', ')}
                    </Text>
                  ) : null}

                  {bookingLabelKey(item) ? (
                    <Tag label={t(bookingLabelKey(item) as string)} />
                  ) : null}

                  {/* No booking from here, deliberately. This page exists to
                      tell a visitor what is coming up, and every card carrying
                      its own call to register turned three announcements into
                      three sales pitches. Registering belongs after signing in,
                      where the seat count, the price and the person's own
                      eligibility are all knowable. */}
                </PublicCard>
              </View>
            ))}
          </ScrollView>
        </>
      ) : null}

      {/* At the foot, not the head. Up here it would push the sign-in buttons
          down the page and be the first thing a visitor met — an interruption
          before they had seen what they came for. It still draws nothing at all
          until the browser says an install is possible. */}
      <InstallPrompt />
    </PublicPage>
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
      <Ionicons name={icon} size={15} color={tone.body} />
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: brand.slate,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
    marginTop: spacing.sm,
  },

  roleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    // Softer than the cards around it, which is what makes the primary action
    // read as a button rather than as another panel.
    borderRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    minHeight: 66,
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

  staffRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  staffButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: tone.controlLineStrong,
    backgroundColor: tone.control,
    paddingHorizontal: spacing.lg,
    // Short of the 44pt guideline on purpose is NOT what this is: the row is
    // padded to a comfortable tap target while reading as secondary.
    paddingVertical: 9,
  },
  staffLabel: { fontSize: fontSize.xs, color: tone.body, fontWeight: fontWeight.semibold },

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
    color: tone.body,
    fontWeight: fontWeight.semibold,
  },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    // Three across a phone and more as the column widens, without a media
    // query: a basis of 96 with room to grow settles wherever there is space.
    flexGrow: 1,
    flexBasis: 96,
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: tone.panel,
    borderWidth: 1,
    borderColor: tone.panelLine,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
  },
  tileIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: tone.accentPanel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: tone.body,
    textAlign: 'center',
  },

  strip: { gap: spacing.sm, paddingRight: spacing.lg, paddingVertical: 2 },
  eventCard: {
    // Narrower than the column on purpose: at full width the second card sits
    // exactly at the edge and looks clipped rather than scrollable. Here the
    // next one peeks in, which is what tells somebody to swipe.
    width: 232,
  },
  eventHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  eventPhoto: {
    width: 38,
    height: 38,
    borderRadius: radius.sm,
    backgroundColor: tone.pressed,
  },
  eventPhotoEmpty: { alignItems: 'center', justifyContent: 'center' },
  eventTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: tone.title },
  eventFact: { fontSize: fontSize.xs, color: tone.muted, marginTop: 2 },
});
