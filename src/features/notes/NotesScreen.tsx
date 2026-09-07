import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { relativeTime } from '@/utils/date';
import * as noteService from '@/services/noteService';
import type { Note } from '@/types';
import {
  AppHeader,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FormSheet,
  Screen,
  SearchField,
  SkeletonList,
  TextField,
} from '@/components/ui';

/**
 * A notebook, private to the person holding it.
 *
 * The point of it is that nobody else reads it — not a teacher, not an admin —
 * so it is somewhere to write "ask about this next week" without composing a
 * message to anybody. That privacy is enforced by the security rules rather
 * than by this screen being the only way in.
 *
 * A title is optional. Somebody halfway through a lesson wants to write the
 * thought down, not name it first, so an untitled note is a first-class note
 * and the list shows its opening words instead.
 */
export function NotesScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Note | null>(null);

  const load = useCallback(async () => {
    if (!user) return [] as Note[];
    const page = await noteService.listNotes(user);
    return noteService.sortNotes(page.items);
  }, [user]);

  const { data, loading, error, reload } = useAsync(load, [user?.uid]);

  const notes = (data ?? []).filter((note) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return (
      note.title.toLowerCase().includes(needle) || note.body.toLowerCase().includes(needle)
    );
  });

  const openNew = () => {
    setForm({ title: '', body: '' });
    setEditing(null);
    setCreating(true);
  };

  const openExisting = (note: Note) => {
    setForm({ title: note.title, body: note.body });
    setEditing(note);
    setCreating(true);
  };

  const save = async () => {
    if (!user) return;
    // A note with neither a title nor a body is not a note. Saving one would
    // leave a blank row somebody has to tidy up later.
    if (!form.title.trim() && !form.body.trim()) {
      setCreating(false);
      return;
    }

    setBusy(true);
    try {
      if (editing) await noteService.updateNote(editing.id, form);
      else await noteService.createNote(form, user);
      setCreating(false);
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const togglePin = async (note: Note) => {
    try {
      await noteService.updateNote(note.id, { pinned: !note.pinned });
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('nav.notes')} showBack />

      <Screen refreshing={loading} onRefresh={reload}>
        <View style={styles.toolbar}>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder={t('notes.search')}
            style={{ flex: 1 }}
          />
          <Button label={t('notes.new')} icon="add" size="sm" onPress={openNew} />
        </View>

        {loading && !data ? (
          <SkeletonList count={3} />
        ) : error ? (
          <EmptyState
            icon="cloud-offline-outline"
            title={t('errors.networkUnavailable')}
            message={friendlyMessage(error, t)}
            actionLabel={t('common.retry')}
            onAction={reload}
          />
        ) : notes.length === 0 ? (
          <EmptyState
            icon="create-outline"
            title={search ? t('empty.noResults') : t('notes.empty')}
            message={search ? undefined : t('notes.emptyHelp')}
            actionLabel={search ? undefined : t('notes.new')}
            onAction={search ? undefined : openNew}
          />
        ) : (
          notes.map((note) => (
            <Card key={note.id} style={styles.card}>
              <Pressable
                onPress={() => openExisting(note)}
                accessibilityRole="button"
                accessibilityLabel={note.title || t('notes.untitled')}
              >
                <View style={styles.cardHead}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {note.title || t('notes.untitled')}
                  </Text>
                  {note.pinned ? (
                    <Ionicons name="pin" size={14} color={colors.accent} />
                  ) : null}
                </View>
                {note.body ? (
                  <Text style={styles.cardBody} numberOfLines={3}>
                    {note.body}
                  </Text>
                ) : null}
                <Text style={styles.cardTime}>{relativeTime(note.updatedAt)}</Text>
              </Pressable>

              <View style={styles.cardActions}>
                <Button
                  label={t(note.pinned ? 'notes.unpin' : 'notes.pin')}
                  icon={note.pinned ? 'pin-outline' : 'pin'}
                  size="sm"
                  variant="ghost"
                  onPress={() => void togglePin(note)}
                />
                <Button
                  label={t('common.delete')}
                  icon="trash-outline"
                  size="sm"
                  variant="ghost"
                  onPress={() => setConfirmDelete(note)}
                />
              </View>
            </Card>
          ))
        )}
      </Screen>

      <FormSheet
        visible={creating}
        title={t(editing ? 'notes.edit' : 'notes.new')}
        onClose={() => setCreating(false)}
        onSubmit={save}
        submitting={busy}
      >
        <TextField
          label={t('notes.title')}
          value={form.title}
          onChangeText={(v) => setForm((f) => ({ ...f, title: v }))}
          icon="text-outline"
          hint={t('notes.titleHint')}
        />
        <TextField
          label={t('notes.body')}
          value={form.body}
          onChangeText={(v) => setForm((f) => ({ ...f, body: v }))}
          multiline
          containerStyle={{ marginBottom: 0 }}
        />
      </FormSheet>

      <ConfirmDialog
        visible={Boolean(confirmDelete)}
        title={t('common.delete')}
        message={t('notes.deleteConfirm')}
        confirmLabel={t('common.delete')}
        destructive
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const note = confirmDelete;
          setConfirmDelete(null);
          if (!note || !user) return;
          try {
            await noteService.deleteNote(note.id, user);
            await reload();
          } catch (err) {
            toast.error(friendlyMessage(err, t));
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  card: { marginBottom: spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  cardTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  cardBody: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    lineHeight: 20,
    marginTop: 4,
  },
  cardTime: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.sm },
  cardActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
});
