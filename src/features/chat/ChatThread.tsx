import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import * as notify from '@/services/notificationService';
import {
  CHAT_MAX_LENGTH,
  chatTime,
  markChatRead,
  sendChatMessage,
  watchChatMessages,
  watchChatThread,
  type ChatMessage,
  type ChatThreadSummary,
} from '@/services/chatService';
import type { AppUser } from '@/types';

/**
 * One conversation: the messages and the box to reply in.
 *
 * Shared by both sides. A member sees their own messages on the right and the
 * admin team's on the left; an admin sees it the other way round, with each
 * member's name on theirs.
 *
 * Sending does not wait for the server. The message appears at once from the
 * device's own copy and is confirmed in the background, so a slow connection
 * never leaves somebody staring at a spinner between messages. If the send is
 * refused, the text is put back in the box rather than lost.
 */
export function ChatThread({ threadUid, viewer }: { threadUid: string; viewer: AppUser }) {
  const { t } = useTranslation();
  const toast = useToast();
  const viewerIsAdmin = viewer.role === 'admin';

  const [thread, setThread] = useState<ChatThreadSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    setThread(null);
    setMessages(null);
    setFailed(false);
    setDraft('');
    const stopThread = watchChatThread(threadUid, setThread);
    const stopMessages = watchChatMessages(threadUid, setMessages, () => {
      setFailed(true);
      setMessages([]);
    });
    return () => {
      stopThread();
      stopMessages();
    };
  }, [threadUid]);

  // Reading the conversation clears its unread count, for this side only.
  const unread = viewerIsAdmin ? thread?.unreadForAdmin : thread?.unreadForUser;
  useEffect(() => {
    if (unread) void markChatRead(threadUid, viewerIsAdmin);
  }, [threadUid, unread, viewerIsAdmin]);

  const send = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft('');
    // The member is told once per run of replies, not once per message: only
    // when this reply is the first one they have not read yet.
    const tellMember = viewerIsAdmin && !thread?.unreadForUser;
    sendChatMessage(threadUid, body, viewer)
      .then(() => {
        if (!tellMember) return;
        void notify
          .send(
            {
              title: t('chat.title'),
              message: body.slice(0, 120),
              category: 'support_reply',
              targetRole: 'user',
              userId: threadUid,
              route: thread?.userRole === 'teacher' ? '/(teacher)/chat' : '/(student)/chat',
            },
            viewer
          )
          .catch(() => undefined);
      })
      .catch((error) => {
        setDraft((current) => current || body);
        toast.error(friendlyMessage(error, t));
      });
  };

  // On a computer, Enter sends and Shift+Enter starts a new line — what every
  // chat on the web does. On a phone the keyboard's own return key is a new
  // line, and the send button sends.
  const onKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (Platform.OS !== 'web') return;
    const native = event.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean };
    if (native.key === 'Enter' && !native.shiftKey) {
      (event as unknown as { preventDefault?: () => void }).preventDefault?.();
      send();
    }
  };

  const renderItem = ({ item, index }: { item: ChatMessage; index: number }) => {
    const mine = viewerIsAdmin ? item.fromAdmin : item.from === viewer.uid;
    const previous = messages?.[index - 1];
    const firstOfRun = !previous || previous.fromAdmin !== item.fromAdmin;
    const name = item.fromAdmin
      ? viewerIsAdmin
        ? item.fromName
        : t('chat.admin')
      : item.fromName;

    return (
      <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          {firstOfRun && !mine && name ? <Text style={styles.name}>{name}</Text> : null}
          <Text style={[styles.text, mine && styles.textMine]} selectable>
            {item.text}
          </Text>
          <Text style={[styles.time, mine && styles.timeMine]}>{chatTime(item.at)}</Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {messages === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          style={styles.fill}
          data={messages}
          keyExtractor={(message) => message.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="chatbubbles-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyText}>
                {t(failed ? 'chat.loadFailed' : viewerIsAdmin ? 'chat.emptyAdmin' : 'chat.empty')}
              </Text>
            </View>
          }
        />
      )}

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={(value) => setDraft(value.slice(0, CHAT_MAX_LENGTH))}
          onKeyPress={onKeyPress}
          placeholder={t('chat.placeholder')}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={t('chat.placeholder')}
          multiline
          style={styles.input}
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim()}
          accessibilityRole="button"
          accessibilityLabel={t('chat.send')}
          accessibilityState={{ disabled: !draft.trim() }}
          style={({ pressed }) => [
            styles.send,
            !draft.trim() && styles.sendOff,
            pressed && { opacity: 0.8 },
          ]}
        >
          <Ionicons name="send" size={18} color={colors.textInverse} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
  },
  list: { flexGrow: 1, paddingVertical: spacing.md },
  row: { flexDirection: 'row', marginVertical: 3 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '82%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderBottomLeftRadius: 4,
  },
  name: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.accent,
    marginBottom: 2,
  },
  text: { fontSize: fontSize.md, color: colors.text, lineHeight: 21 },
  textMine: { color: colors.textInverse },
  time: { fontSize: 10, color: colors.textMuted, marginTop: 2, alignSelf: 'flex-end' },
  timeMine: { color: colors.textInverse, opacity: 0.75 },
  emptyText: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 320,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontSize: fontSize.md,
    color: colors.text,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { opacity: 0.45 },
});
