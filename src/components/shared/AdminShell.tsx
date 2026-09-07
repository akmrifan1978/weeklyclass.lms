import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { APP_NAME } from '@/constants/app';
import {
  brand,
  colors,
  fontSize,
  fontWeight,
  layout,
  radius,
  shadow,
  spacing,
  TOUCH_TARGET,
} from '@/constants/theme';
import { useResponsive } from '@/hooks/useResponsive';
import { Avatar, ConfirmDialog } from '@/components/ui';
import type { Permission } from '@/types';

/**
 * Admin chrome.
 *
 * Desktop gets a persistent navy sidebar; phones and tablets get the same list
 * behind a menu button. Nav entries are filtered by permission, so a teacher
 * given admin-adjacent rights only ever sees what they can actually use.
 */

interface NavItem {
  labelKey: string;
  route: string;
  icon: keyof typeof Ionicons.glyphMap;
  permission?: Permission;
  group: 'main' | 'content' | 'academic' | 'comms' | 'system';
}

export const ADMIN_NAV: NavItem[] = [
  { labelKey: 'nav.dashboard', route: '/(admin)', icon: 'grid-outline', group: 'main' },
  { labelKey: 'nav.users', route: '/(admin)/users', icon: 'people-circle-outline', permission: 'MANAGE_USERS', group: 'main' },
  { labelKey: 'nav.students', route: '/(admin)/students', icon: 'school-outline', permission: 'VIEW_STUDENTS', group: 'main' },
  { labelKey: 'nav.teachers', route: '/(admin)/teachers', icon: 'people-outline', permission: 'VIEW_TEACHERS', group: 'main' },
  { labelKey: 'nav.branches', route: '/(admin)/branches', icon: 'business-outline', permission: 'MANAGE_BRANCHES', group: 'main' },
  { labelKey: 'nav.classes', route: '/(admin)/classes', icon: 'library-outline', permission: 'VIEW_CLASSES', group: 'main' },

  { labelKey: 'nav.lessons', route: '/(admin)/lessons', icon: 'book-outline', permission: 'VIEW_LESSONS', group: 'content' },
  { labelKey: 'nav.videos', route: '/(admin)/videos', icon: 'videocam-outline', permission: 'UPLOAD_VIDEO', group: 'content' },
  // Making a recording and managing the ones already made are different jobs on
  // different days, so they are different entries rather than one screen with a
  // button hidden in it.
  { labelKey: 'record.title', route: '/(admin)/record', icon: 'radio-button-on', permission: 'UPLOAD_VIDEO', group: 'content' },
  { labelKey: 'video.recordings', route: '/(admin)/recordings', icon: 'film-outline', permission: 'UPLOAD_VIDEO', group: 'content' },
  { labelKey: 'nav.articles', route: '/(admin)/articles', icon: 'newspaper-outline', permission: 'MANAGE_ARTICLES', group: 'content' },
  { labelKey: 'nav.materials', route: '/(admin)/materials', icon: 'folder-open-outline', permission: 'UPLOAD_MATERIAL', group: 'content' },
  { labelKey: 'nav.calendar', route: '/(admin)/calendar', icon: 'calendar-outline', permission: 'MANAGE_CALENDAR', group: 'content' },
  // Separate from Calendar: the calendar is where an event is scheduled, this
  // is where its bookings are confirmed and its attendee sheet comes from.
  { labelKey: 'nav.events', route: '/(admin)/events', icon: 'ticket-outline', permission: 'MANAGE_CALENDAR', group: 'content' },

  { labelKey: 'nav.attendance', route: '/(admin)/attendance', icon: 'checkbox-outline', permission: 'VIEW_ATTENDANCE', group: 'academic' },
  { labelKey: 'nav.quizzes', route: '/(admin)/quizzes', icon: 'help-circle-outline', permission: 'CREATE_QUIZ', group: 'academic' },
  { labelKey: 'nav.results', route: '/(admin)/results', icon: 'trophy-outline', permission: 'VIEW_RESULTS', group: 'academic' },
  { labelKey: 'nav.reports', route: '/(admin)/reports', icon: 'stats-chart-outline', permission: 'VIEW_RESULTS', group: 'academic' },

  { labelKey: 'nav.notifications', route: '/(admin)/notifications', icon: 'notifications-outline', permission: 'SEND_NOTIFICATIONS', group: 'comms' },
  { labelKey: 'nav.announcements', route: '/(admin)/announcements', icon: 'megaphone-outline', permission: 'MANAGE_ANNOUNCEMENTS', group: 'comms' },

  { labelKey: 'nav.permissions', route: '/(admin)/permissions', icon: 'key-outline', permission: 'MANAGE_USERS', group: 'system' },
  { labelKey: 'nav.languages', route: '/(admin)/languages', icon: 'language-outline', permission: 'MANAGE_LANGUAGES', group: 'system' },
  { labelKey: 'nav.settings', route: '/(admin)/settings', icon: 'settings-outline', permission: 'MANAGE_SETTINGS', group: 'system' },
  { labelKey: 'nav.auditLogs', route: '/(admin)/audit', icon: 'document-text-outline', permission: 'MANAGE_SETTINGS', group: 'system' },
  // No permission gate: a notebook belongs to the person, not to a role.
  { labelKey: 'nav.notes', route: '/(admin)/notes', icon: 'create-outline', group: 'system' },
  { labelKey: 'nav.profile', route: '/(admin)/profile', icon: 'person-outline', group: 'system' },
];

const GROUP_LABEL: Record<NavItem['group'], string> = {
  main: 'nav.users',
  content: 'nav.lessons',
  academic: 'nav.results',
  comms: 'nav.notifications',
  system: 'nav.settings',
};

export function AdminShell({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user, can, logout } = useAuth();
  const { showSidebar } = useResponsive();
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  const items = useMemo(
    () => ADMIN_NAV.filter((item) => !item.permission || can(item.permission)),
    [can]
  );

  const isActive = (route: string) => {
    if (route === '/(admin)') return pathname === '/' || pathname.endsWith('/(admin)');
    const leaf = route.split('/').pop() ?? '';
    return pathname.endsWith(`/${leaf}`);
  };

  const navigate = (route: string) => {
    setMenuOpen(false);
    router.push(route as never);
  };

  const navList = (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.navScroll}>
      {(['main', 'content', 'academic', 'comms', 'system'] as const).map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (groupItems.length === 0) return null;
        return (
          <View key={group} style={styles.navGroup}>
            <Text style={styles.navGroupLabel}>{t(GROUP_LABEL[group])}</Text>
            {groupItems.map((item) => {
              const active = isActive(item.route);
              return (
                <Pressable
                  key={item.route}
                  onPress={() => navigate(item.route)}
                  accessibilityRole="link"
                  accessibilityLabel={t(item.labelKey)}
                  accessibilityState={{ selected: active }}
                  style={({ pressed }) => [
                    styles.navItem,
                    active ? styles.navItemActive : null,
                    { opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={19}
                    color={active ? brand.orangeLight : brand.sandLight}
                  />
                  <Text style={[styles.navLabel, active ? styles.navLabelActive : null]}>
                    {t(item.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        );
      })}

      <Pressable
        onPress={() => {
          setMenuOpen(false);
          setConfirmLogout(true);
        }}
        accessibilityRole="button"
        accessibilityLabel={t('auth.logout')}
        style={({ pressed }) => [styles.navItem, styles.logoutItem, { opacity: pressed ? 0.8 : 1 }]}
      >
        <Ionicons name="log-out-outline" size={19} color={brand.red} />
        <Text style={[styles.navLabel, { color: brand.red }]}>{t('auth.logout')}</Text>
      </Pressable>
    </ScrollView>
  );

  /**
   * Logout where it can always be reached.
   *
   * It already existed at the foot of the navigation list, which on a full
   * sidebar means scrolling past twenty items to leave — and on a shared or
   * borrowed device, the one action somebody wants in a hurry is the one that
   * should never require a hunt.
   */
  const logoutButton = (
    <Pressable
      onPress={() => {
        setMenuOpen(false);
        setConfirmLogout(true);
      }}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={t('auth.logout')}
      style={({ pressed }) => [styles.logoutButton, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name="log-out-outline" size={20} color={brand.red} />
    </Pressable>
  );

  const brandBlock = (
    <View style={styles.brandBlock}>
      <View style={styles.brandIcon}>
        <Ionicons name="book" size={20} color={brand.orange} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.brandName} numberOfLines={1}>
          {APP_NAME}
        </Text>
        <Text style={styles.brandRole}>{t('admin.roleAdmin')}</Text>
      </View>
    </View>
  );

  if (showSidebar) {
    return (
      <View style={styles.desktop}>
        <View style={[styles.sidebar, { paddingTop: insets.top + spacing.lg }]}>
          {brandBlock}
          {navList}
          <View style={styles.sidebarFooter}>
            <Avatar name={user?.fullName ?? '?'} uri={user?.profileImage} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={styles.footerName} numberOfLines={1}>
                {user?.fullName}
              </Text>
              <Text style={styles.footerEmail} numberOfLines={1}>
                {user?.email}
              </Text>
            </View>
            {logoutButton}
          </View>
        </View>

        <View style={styles.content}>{children}</View>

        <ConfirmDialog
          visible={confirmLogout}
          title={t('auth.logout')}
          message={t('auth.logoutConfirm')}
          confirmLabel={t('auth.logout')}
          destructive
          onCancel={() => setConfirmLogout(false)}
          onConfirm={() => {
            setConfirmLogout(false);
            void logout();
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.mobile}>
      <View style={[styles.mobileBar, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable
          onPress={() => setMenuOpen(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.open')}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Ionicons name="menu" size={26} color={colors.textInverse} />
        </Pressable>
        <Text style={styles.mobileTitle} numberOfLines={1}>
          {APP_NAME}
        </Text>
        <Avatar name={user?.fullName ?? '?'} uri={user?.profileImage} size={32} />
        <Pressable
          onPress={() => setConfirmLogout(true)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('auth.logout')}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Ionicons name="log-out-outline" size={22} color={colors.textInverse} />
        </Pressable>
      </View>

      <View style={styles.content}>{children}</View>

      <Modal
        visible={menuOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMenuOpen(false)}
      >
        <View style={styles.drawerBackdrop}>
          <SafeAreaView style={styles.drawer} edges={['top', 'bottom']}>
            <View style={styles.drawerHeader}>
              {brandBlock}
              <Pressable
                onPress={() => setMenuOpen(false)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <Ionicons name="close" size={24} color={brand.sandLight} />
              </Pressable>
            </View>
            {navList}
          </SafeAreaView>
          <Pressable
            style={styles.drawerDismiss}
            onPress={() => setMenuOpen(false)}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          />
        </View>
      </Modal>

      <ConfirmDialog
        visible={confirmLogout}
        title={t('auth.logout')}
        message={t('auth.logoutConfirm')}
        confirmLabel={t('auth.logout')}
        destructive
        onCancel={() => setConfirmLogout(false)}
        onConfirm={() => {
          setConfirmLogout(false);
          void logout();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  desktop: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  mobile: { flex: 1, backgroundColor: colors.background },
  sidebar: {
    width: layout.sidebarWidth,
    backgroundColor: brand.navyDeep,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  content: { flex: 1 },
  brandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.lg,
  },
  brandIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: { color: colors.textInverse, fontSize: fontSize.md, fontWeight: fontWeight.bold },
  brandRole: { color: brand.slate, fontSize: fontSize.xs },
  navScroll: { paddingBottom: spacing.xl },
  navGroup: { marginBottom: spacing.lg },
  navGroupLabel: {
    color: brand.slate,
    fontSize: 10,
    fontWeight: fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    minHeight: TOUCH_TARGET,
  },
  navItemActive: { backgroundColor: 'rgba(237,91,3,0.16)' },
  navLabel: { color: brand.sandLight, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  navLabelActive: { color: brand.orangeLight, fontWeight: fontWeight.semibold },
  logoutButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  logoutItem: { marginTop: spacing.md },
  sidebarFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  footerName: { color: colors.textInverse, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  footerEmail: { color: brand.slate, fontSize: fontSize.xs },
  mobileBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: brand.navyDeep,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  mobileTitle: {
    flex: 1,
    color: colors.textInverse,
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
  },
  drawerBackdrop: { flex: 1, flexDirection: 'row', backgroundColor: colors.overlay },
  drawer: {
    width: 286,
    backgroundColor: brand.navyDeep,
    paddingHorizontal: spacing.md,
    ...shadow.lg,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: spacing.md,
  },
  drawerDismiss: { flex: 1 },
});
