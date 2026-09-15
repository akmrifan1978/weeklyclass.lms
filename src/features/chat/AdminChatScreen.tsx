import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useResponsive } from '@/hooks/useResponsive';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { humanise } from '@/utils/format';
import { chatTime, watchChatInbox, type ChatThreadSummary } from '@/services/chatService';
import { AppHeader, Avatar, Screen, SearchField } from '@/components/ui';
import { ChatThread } from './ChatThread';

/**
 * The admin side of Live Chat: every conversation, newest first, and the one
 * being answered.
 *
 * Side by side on a computer, so an admin can work down the list without
 * losing their place. One at a time on a phone, where the header's back arrow
 * returns to the list.
 */
export function AdminChatScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { isDesktop } = useResponsive();

  const [threads, setThreads] = useState<ChatThreadSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(
    () =>
      watchChatInbox(setThreads, () => {
        setFailed(true);
        setThreads([]);
      }),
    []
  );

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = threads ?? [];
    return needle ? all.filter((th) => (th.userName ?? '').toLowerCase().includes(needle)) : all;
  }, [threads, search]);

  const current = threads?.find((th) => th.uid === selected) ?? null;
  const phoneThread = !isDesktop && Boolean(selected);

  if (!user) return null;

  const list = (
    <View style={styles.fill}>
      <SearchField value={search} onChangeText={setSearch} placeholder={t('chat.search')} style={styles.search} />
      {threads === null ? (
        <ActivityIndicator color={colors.primary} style={styles.loading} />
      ) : (
        <FlatList
          data={shown}
          keyExtractor={(th) => th.uid}
          ListEmptyComponent={
            <Text style={styles.status}>{t(failed ? 'chat.loadFailed' : 'chat.inboxEmpty')}</Text>
          }
          renderItem={({ item }) => {
            const unread = item.unreadForAdmin ?? 0;
            return (
              <Pressable
                onPress={() => setSelected(item.uid)}
                accessibilityRole="button"
                accessibilityLabel={item.userName}
                style={({ pressed }) => [
                  styles.threadRow,
                  item.uid === selected && styles.threadRowOn,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Avatar name={item.userName ?? '?'} size={40} />
                <View style={styles.fill}>
                  <View style={styles.rowTop}>
                    <Text style={styles.threadName} numberOfLines={1}>
                      {item.userName}
                    </Text>
                    <Text style={styles.threadTime}>{chatTime(item.lastAt)}</Text>
                  </View>
                  <Text style={[styles.preview, unread ? styles.previewUnread : null]} numberOfLines={1}>
                    {item.userRole && item.userRole !== 'student' ? `${humanise(item.userRole)} · ` : ''}
                    {item.lastFromAdmin ? `${t('chat.you')}: ` : ''}
                    {item.lastMessage}
                  </Text>
                </View>
                {unread ? (
                  <View style={styles.unread}>
                    <Text style={styles.unreadText}>{unread > 99 ? '99+' : unread}</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );

  const conversation = selected ? (
    <ChatThread threadUid={selected} viewer={user} />
  ) : (
    <View style={styles.pick}>
      <Text style={styles.status}>{t('chat.pickThread')}</Text>
    </View>
  );

  return (
    <>
      <AppHeader
        title={t('chat.title')}
        subtitle={phoneThread ? current?.userName : undefined}
        showBack
        onBack={phoneThread ? () => setSelected(null) : undefined}
      />
      <Screen scroll={false} style={styles.fill} contentStyle={styles.fill}>
        {isDesktop ? (
          <View style={styles.split}>
            <View style={styles.listPane}>{list}</View>
            <View style={styles.threadPane}>
              {current ? <Text style={styles.paneTitle}>{current.userName}</Text> : null}
              {conversation}
            </View>
          </View>
        ) : phoneThread ? (
          conversation
        ) : (
          list
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  search: { marginVertical: spacing.md },
  loading: { marginTop: spacing.xl },
  status: {
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: fontSize.sm,
    padding: spacing.xl,
    lineHeight: 20,
  },
  split: { flex: 1, flexDirection: 'row', gap: spacing.lg },
  listPane: { width: 340, maxWidth: '40%' },
  threadPane: {
    flex: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.divider,
    paddingLeft: spacing.lg,
  },
  paneTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    paddingVertical: spacing.md,
  },
  pick: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  threadRowOn: { backgroundColor: colors.surfaceMuted },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  threadName: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  threadTime: { fontSize: fontSize.xs, color: colors.textMuted },
  preview: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  previewUnread: { color: colors.text, fontWeight: fontWeight.semibold },
  unread: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadText: { color: colors.textInverse, fontSize: fontSize.xs, fontWeight: fontWeight.bold },
});
