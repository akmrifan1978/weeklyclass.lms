import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { colors, fontSize, fontWeight, radius, spacing, TOUCH_TARGET } from '@/constants/theme';
import { Avatar } from '@/components/ui';

/**
 * Everywhere a student or teacher can go, behind one button.
 *
 * WHY IT EXISTS. The dashboard was carrying the navigation. Twenty-three tiles
 * across two grids sat on the screen people land on, purely because there was
 * nowhere else for them to live — and it made that screen run off the bottom of
 * a phone. Admins never had this problem: they have had a drawer on mobile and
 * a sidebar on desktop since the beginning, and their dashboard is short
 * because of it.
 *
 * So this is the same idea, for the two roles that did not get it. The tabs
 * stay: four destinations people use constantly are worth a permanent row, and
 * taking them away to prove a point about drawers would make the common case
 * slower. This holds everything else.
 *
 * Grouped, because a flat list of twenty-three is a different kind of hard to
 * read than a grid of twenty-three. The groups are the ones people already
 * think in — their class, their work, the Islamic sections, and help.
 */

export interface NavEntry {
  icon: keyof typeof Ionicons.glyphMap;
  labelKey: string;
  route: string;
}

export interface NavSection {
  titleKey: string;
  entries: NavEntry[];
}

export function NavDrawer({
  sections,
  tint = colors.textInverse,
}: {
  sections: NavSection[];
  /** Matches whatever the button is sitting on. */
  tint?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);

  const go = (route: string) => {
    setOpen(false);
    router.push(route as never);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={t('common.menu')}
        style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
      >
        <Ionicons name="menu" size={26} color={tint} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        {/* The backdrop closes it. A drawer you can only leave by finding the
            small cross is a drawer people get stuck in. */}
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />

        <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
          <View style={styles.sheetHeader}>
            <View style={styles.person}>
              <Avatar name={user?.fullName ?? '?'} uri={user?.profileImage} size={40} />
              <View style={{ flex: 1 }}>
                <Text style={styles.personName} numberOfLines={1}>
                  {user?.fullName ?? ''}
                </Text>
                <Text style={styles.personMeta} numberOfLines={1}>
                  {user?.studentId ?? user?.teacherId ?? ''}
                </Text>
              </View>
            </View>

            <Pressable
              onPress={() => setOpen(false)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
              style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xl }}
          >
            {sections.map((section) => (
              <View key={section.titleKey} style={styles.group}>
                <Text style={styles.groupLabel}>{t(section.titleKey)}</Text>
                {section.entries.map((entry) => (
                  <Pressable
                    key={entry.route}
                    onPress={() => go(entry.route)}
                    accessibilityRole="link"
                    accessibilityLabel={t(entry.labelKey)}
                    style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  >
                    <Ionicons name={entry.icon} size={19} color={colors.textSecondary} />
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {t(entry.labelKey)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheet: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '82%',
    maxWidth: 320,
    backgroundColor: colors.background,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  person: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  personName: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  personMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 1 },
  close: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  group: { paddingTop: spacing.lg },
  groupLabel: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    color: colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
  },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  rowLabel: { flex: 1, fontSize: fontSize.sm, color: colors.text },
});
