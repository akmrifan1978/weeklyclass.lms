import React from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { AppHeader, Screen } from '@/components/ui';
import { ChatThread } from './ChatThread';

/**
 * A member's own conversation with the admin team.
 *
 * There is no list of people to pick from, deliberately: the only person a
 * student or teacher can open a chat with is the admin team.
 */
export function ChatScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();

  return (
    <>
      <AppHeader title={t('chat.title')} subtitle={t('chat.subtitle')} showBack />
      <Screen scroll={false} style={styles.fill} contentStyle={styles.fill}>
        {user ? <ChatThread threadUid={user.uid} viewer={user} /> : null}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
