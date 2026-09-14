import React from 'react';
import { Platform } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { brand, colors, fontSize, fontWeight, layout } from '@/constants/theme';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useResponsive } from '@/hooks/useResponsive';

export default function TeacherTabsLayout() {
  const { t } = useTranslation();
  const { can } = useAuth();
  /**
   * The badge reads the app's one live subscription rather than polling.
   *
   * It used to re-fetch the whole inbox every two minutes, which cost four
   * or five reads whether or not anything had happened and still left the
   * count up to two minutes stale — so a notification an admin had deleted
   * went on being counted. Now it changes when the data does.
   */
  const { unread } = useNotifications();
  const { isDesktop } = useResponsive();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        // A phone's tab bar belongs at the bottom, under the thumb. On a
        // desktop it is a strip across a wide monitor, far from everything, so
        // there it becomes a rail down the left-hand side instead.
        tabBarPosition: isDesktop ? 'left' : 'bottom',
        tabBarVariant: isDesktop ? 'material' : 'uikit',
        tabBarStyle: isDesktop
          ? {
              backgroundColor: colors.surface,
              borderRightColor: colors.divider,
              minWidth: 200,
              paddingTop: 12,
            }
          : {
              backgroundColor: colors.surface,
              borderTopColor: colors.divider,
              height: Platform.OS === 'ios' ? 84 : layout.tabBarHeight,
              paddingTop: 6,
              paddingBottom: Platform.OS === 'ios' ? 26 : 8,
            },
        tabBarLabelStyle: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
        tabBarBadgeStyle: { backgroundColor: brand.red, fontSize: 10 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('nav.home'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={23} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="classes"
        options={{
          title: t('nav.myClasses'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'library' : 'library-outline'} size={23} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="attendance"
        options={{
          title: t('nav.attendance'),
          // Hidden rather than removed: the route still exists so a deep link
          // resolves, but a teacher without the permission never sees the tab.
          href: can('VIEW_ATTENDANCE') ? undefined : null,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'checkbox' : 'checkbox-outline'} size={23} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: t('nav.notifications'),
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? 'notifications' : 'notifications-outline'}
              size={23}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('nav.profile'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={23} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
