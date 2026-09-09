import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { BrandMark } from './BrandMark';
import { PUBLIC_NAV, PUBLIC_NAV_SPLIT, isCurrentRoute } from '@/constants/publicNav';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
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
import { tone } from './tone';
import type { AppSettings, LanguageCode } from '@/types';

/**
 * The bar every public page wears, and the menu behind its one button.
 *
 * The menu is a sheet dropped from the top rather than a screen of its own:
 * somebody opening a menu has not left the page, and the page staying visible
 * behind it is what says so.
 */
export function PublicHeader({ settings }: { settings?: AppSettings | null }) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { language, available, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const go = (route: string) => {
    setOpen(false);
    router.push(route as never);
  };

  const handleLanguage = async (code: LanguageCode) => {
    if (switching) return;
    setSwitching(true);
    try {
      await setLanguage(code);
    } finally {
      setSwitching(false);
    }
  };

  /**
   * The way in, at the foot of the menu.
   *
   * It says Log in to a visitor and names the dashboard to somebody already
   * signed in, because a signed-in reader who wandered onto a public page
   * needs a way back rather than a second sign-in.
   */
  const home = user
    ? ({ admin: '/(admin)', teacher: '/(teacher)', student: '/(student)' } as const)[user.role]
    : '/(auth)/login';
  const homeLabel = user ? t('nav.dashboard') : t('auth.login');

  const columns = [
    PUBLIC_NAV.slice(0, PUBLIC_NAV_SPLIT),
    PUBLIC_NAV.slice(PUBLIC_NAV_SPLIT),
  ];

  return (
    <>
      <View style={styles.bar}>
        <BrandMark settings={settings} />

        <Pressable
          onPress={() => setOpen(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.menu')}
          style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="menu" size={22} color={tone.body} />
        </Pressable>
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />

        <SafeAreaView style={styles.sheet} edges={['top']}>
          <View style={styles.sheetHead}>
            <BrandMark settings={settings} />
            <Pressable
              onPress={() => setOpen(false)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="close" size={20} color={tone.body} />
            </Pressable>
          </View>

          {/* Two columns, read downwards. Nine short labels down one column is
              a list you scroll; across two it is a list you take in at once. */}
          <View style={styles.grid}>
            {columns.map((column, index) => (
              <View key={index} style={styles.column}>
                {column.map((item) => {
                  const current = isCurrentRoute(item.route, pathname);
                  return (
                    <Pressable
                      key={item.route}
                      onPress={() => go(item.route)}
                      accessibilityRole="link"
                      accessibilityLabel={t(item.key)}
                      accessibilityState={{ selected: current }}
                      style={({ pressed }) => [
                        styles.item,
                        current && styles.itemCurrent,
                        pressed && styles.itemPressed,
                      ]}
                    >
                      <Text
                        style={[styles.itemText, current && styles.itemTextCurrent]}
                        numberOfLines={1}
                      >
                        {t(item.key)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
          </View>

          <View style={styles.footer}>
            {/* Horizontal, because four language names in three scripts do not
                fit across a phone and wrapping them pushed the way in off the
                bottom of the sheet. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pills}
            >
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
                      styles.pill,
                      active && styles.pillActive,
                      { opacity: pressed ? 0.8 : 1 },
                    ]}
                  >
                    <Text style={[styles.pillText, active && styles.pillTextActive]}>
                      {option.nativeName}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable
              onPress={() => go(home)}
              accessibilityRole="button"
              accessibilityLabel={homeLabel}
              style={({ pressed }) => [styles.loginButton, { opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={styles.loginText}>{homeLabel}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: tone.bar,
    borderBottomWidth: 1,
    borderBottomColor: tone.barLine,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: tone.controlLine,
    backgroundColor: tone.control,
    alignItems: 'center',
    justifyContent: 'center',
  },

  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheet: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: tone.band,
    borderBottomLeftRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    borderBottomWidth: 1,
    borderBottomColor: tone.panelLine,
    paddingBottom: spacing.lg,
    ...shadow.lg,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },

  grid: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  column: { flex: 1 },
  item: {
    minHeight: TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  itemCurrent: { backgroundColor: tone.pressed },
  itemPressed: { backgroundColor: tone.control },
  itemText: { fontSize: fontSize.sm, color: tone.body },
  itemTextCurrent: { color: tone.title, fontWeight: fontWeight.semibold },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: tone.panelLine,
  },
  pills: { gap: spacing.xs, alignItems: 'center', paddingRight: spacing.sm },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: tone.controlLine,
    minHeight: 34,
    justifyContent: 'center',
  },
  // Orange, the colour an active language pill has always been here. A navy
  // fill would be the reference's answer and is invisible on a navy sheet.
  pillActive: { backgroundColor: brand.orange, borderColor: brand.orange },
  pillText: { color: tone.body, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  pillTextActive: { color: colors.textInverse, fontWeight: fontWeight.bold },

  loginButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    minHeight: 34,
    justifyContent: 'center',
  },
  loginText: {
    color: brand.navyDeep,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
});
