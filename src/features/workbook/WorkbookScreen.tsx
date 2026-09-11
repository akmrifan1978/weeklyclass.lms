import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { formatDate } from '@/utils/date';
import * as workbookService from '@/services/workbookService';
import { EVERYONE } from '@/types/audience';
import type { Workbook } from '@/types';
import {
  AppHeader,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Screen,
  SearchField,
  SkeletonList,
  StatusBadge,
} from '@/components/ui';
import { WorkbookEditor } from './WorkbookEditor';

/**
 * A teacher's workbooks, and every workbook for an admin.
 *
 * The list is deliberately plain: a date, a title, whether it has been given
 * out and to how many pages. What a teacher wants from this screen is to find
 * last Tuesday's lesson quickly, and a grid of thumbnails of handwriting is
 * slower to read than the date it was written.
 */
export function WorkbookScreen() {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const toast = useToast();

  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Workbook | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Workbook | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    if (!user) return [] as Workbook[];
    // An admin has full control over every workbook, whoever wrote it. A
    // teacher sees their own — somebody else's draft is not theirs to read.
    const page = isAdmin
      ? await workbookService.listAllWorkbooks()
      : await workbookService.listMine(user);
    return page.items;
  }, [isAdmin, user]);

  const { data, loading, error, reload } = useAsync(load, [user?.uid, isAdmin]);

  const workbooks = (data ?? []).filter((w) => {
    const needle = search.trim().toLowerCase();
    if (!needle) return true;
    return (
      w.title.toLowerCase().includes(needle) ||
      w.date.includes(needle) ||
      (w.authorName ?? '').toLowerCase().includes(needle)
    );
  });

  const startNew = async () => {
    if (!user || creating) return;
    setCreating(true);
    try {
      // Created immediately rather than after a form. The page has to exist
      // before it can be written on, and asking for a title first puts a
      // dialog between a teacher and the board.
      const id = await workbookService.createWorkbook(
        { title: '', audience: EVERYONE },
        user
      );
      const made = await workbookService.getWorkbook(id);
      if (made) setEditing(made);
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setCreating(false);
    }
  };

  if (editing) {
    return (
      <WorkbookEditor
        workbook={editing}
        onClose={() => {
          setEditing(null);
          void reload();
        }}
        onChanged={() => void reload()}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('nav.workbooks')} showBack />

      <Screen refreshing={loading} onRefresh={reload}>
        <View style={styles.toolbar}>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder={t('workbook.search')}
            style={{ flex: 1 }}
          />
          <Button
            label={t('workbook.new')}
            icon="add"
            size="sm"
            loading={creating}
            onPress={() => void startNew()}
          />
        </View>

        {loading && !data ? (
          <SkeletonList count={3} />
        ) : error ? (
          <ErrorState error={error} onRetry={reload} />
        ) : workbooks.length === 0 ? (
          <EmptyState
            icon="book-outline"
            title={search ? t('empty.noResults') : t('workbook.empty')}
            message={search ? undefined : t('workbook.emptyHelp')}
            actionLabel={search ? undefined : t('workbook.new')}
            onAction={search ? undefined : () => void startNew()}
          />
        ) : (
          workbooks.map((w) => (
            <Card key={w.id} style={styles.card} onPress={() => setEditing(w)}>
              <View style={styles.head}>
                <Ionicons name="book" size={18} color={colors.primary} />
                <Text style={styles.title} numberOfLines={1}>
                  {w.title || t('workbook.untitled')}
                </Text>
                <StatusBadge status={w.status} />
              </View>

              <Text style={styles.meta}>
                {formatDate(w.date)}
                {'  ·  '}
                {t('workbook.pages', { count: w.pageCount ?? 0 })}
                {isAdmin && w.authorName ? `  ·  ${w.authorName}` : ''}
              </Text>

              {w.body ? (
                <Text style={styles.body} numberOfLines={2}>
                  {w.body}
                </Text>
              ) : null}

              <View style={styles.actions}>
                <Button
                  label={t('common.edit')}
                  icon="create-outline"
                  size="sm"
                  variant="ghost"
                  onPress={() => setEditing(w)}
                />
                <Button
                  label={t('common.delete')}
                  icon="trash-outline"
                  size="sm"
                  variant="ghost"
                  onPress={() => setConfirmDelete(w)}
                />
              </View>
            </Card>
          ))
        )}
      </Screen>

      <ConfirmDialog
        visible={Boolean(confirmDelete)}
        title={t('common.delete')}
        message={t('workbook.deleteConfirm')}
        confirmLabel={t('common.delete')}
        destructive
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (!target || !user) return;
          try {
            await workbookService.deleteWorkbook(target, user);
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
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  meta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  body: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20, marginTop: spacing.sm },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
});
