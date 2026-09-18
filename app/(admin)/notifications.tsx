import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationsContext';
import { useResponsive } from '@/hooks/useResponsive';
import { spacing } from '@/constants/theme';
import { NotificationComposer } from '@/features/notifications/NotificationComposer';
import { NotificationInbox } from '@/components/shared/NotificationList';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import { ChipGroup, Screen } from '@/components/ui';

type Tab = 'inbox' | 'sent';

/**
 * Notifications for an admin: the ones sent TO them, and the ones they send.
 *
 * The bell in the admin bar counted the admin's own unread notifications but
 * opened this page, which only listed what had been sent to everybody else —
 * so the count could never be cleared and nothing in it could be read. "For
 * me" is the admin's own inbox; the bell opens it.
 */
export default function AdminNotifications() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { unread } = useNotifications();
  const { gutter } = useResponsive();
  const params = useLocalSearchParams<{ tab?: string; open?: string }>();
  const canSend = can('SEND_NOTIFICATIONS');

  const [tab, setTab] = useState<Tab>(
    params.tab === 'inbox' || params.open || !canSend ? 'inbox' : 'sent'
  );
  useEffect(() => {
    if (params.tab === 'inbox' || params.open) setTab('inbox');
  }, [params.tab, params.open]);

  return (
    <View style={styles.fill}>
      {canSend ? (
        <ChipGroup<Tab>
          value={tab}
          onChange={setTab}
          options={[
            {
              value: 'inbox',
              label: unread ? `${t('notification.inbox')} (${unread})` : t('notification.inbox'),
            },
            { value: 'sent', label: t('notification.sentTab') },
          ]}
          style={[styles.tabs, { paddingHorizontal: gutter }]}
        />
      ) : null}
      {tab === 'inbox' || !canSend ? (
        <Screen edges={['bottom']}>
          <NotificationInbox />
        </Screen>
      ) : (
        <PermissionGuard permission="SEND_NOTIFICATIONS">
          <NotificationComposer />
        </PermissionGuard>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tabs: { paddingTop: spacing.md, paddingBottom: spacing.xs },
});
