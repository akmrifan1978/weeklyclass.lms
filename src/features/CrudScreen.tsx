import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { useDebounced, usePaginated } from '@/hooks/useAsync';
import { friendlyMessage } from '@/utils/errors';
import type { BaseDoc } from '@/types';
import type { Cursor, Page } from '@/services/firestore';
import {
  AsyncBoundary,
  Button,
  ConfirmDialog,
  FormSheet,
  Screen,
  SearchField,
  SkeletonList,
  Spacer,
} from '@/components/ui';

/**
 * The shared shape of every admin list screen: search, paginated list,
 * create/edit sheet and a delete confirmation.
 *
 * Screens supply what is genuinely different — how a row looks, what the form
 * contains, and how to save — and inherit consistent loading, empty, error and
 * confirmation behaviour for free.
 */
export interface CrudScreenProps<T extends BaseDoc, F> {
  title: string;
  /** Loads one page. `search` is already debounced. */
  fetchPage: (cursor: Cursor, search: string) => Promise<Page<T>>;
  renderItem: (item: T, actions: { edit: () => void; remove: () => void }) => React.ReactNode;
  /** Blank form state for a new record. */
  emptyForm: F;
  /** Maps an existing record into form state. */
  toForm: (item: T) => F;
  renderForm: (
    form: F,
    set: <K extends keyof F>(key: K, value: F[K]) => void,
    errors: Record<string, string>
  ) => React.ReactNode;
  /** Returns the saved id. Throwing shows a toast and keeps the sheet open. */
  onSave: (form: F, existing: T | null) => Promise<string>;
  onDelete?: (item: T) => Promise<void>;
  /** Return `{ field: i18nKey }` to block the save. */
  validate?: (form: F) => Record<string, string> | null;
  canCreate?: boolean;
  canDelete?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  addLabel?: string;
  emptyIcon?: React.ComponentProps<typeof AsyncBoundary>['emptyProps'] extends
    | { icon?: infer I }
    | undefined
    ? I
    : never;
  emptyTitle?: string;
  /** Extra controls between the search box and the list (filters, tabs). */
  filters?: React.ReactNode;
  /** Rendered above everything — summaries, stat cards. */
  header?: React.ReactNode;
  /** Re-runs the query when any of these change. */
  deps?: React.DependencyList;
  formTitle?: { create: string; edit: string };
}

export function CrudScreen<T extends BaseDoc, F>({
  title,
  fetchPage,
  renderItem,
  emptyForm,
  toForm,
  renderForm,
  onSave,
  onDelete,
  validate,
  canCreate = true,
  canDelete = true,
  searchable = true,
  searchPlaceholder,
  addLabel,
  emptyIcon,
  emptyTitle,
  filters,
  header,
  deps = [],
  formTitle,
}: CrudScreenProps<T, F>) {
  const { t } = useTranslation();
  const toast = useToast();
  const router = useRouter();
  const params = useLocalSearchParams<{ action?: string }>();

  const [term, setTerm] = useState('');
  const search = useDebounced(term, 400);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [form, setForm] = useState<F>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<T | null>(null);

  const loadPage = useCallback(
    (cursor: Cursor) => fetchPage(cursor, search),
    [fetchPage, search]
  );

  const list = usePaginated<T>(loadPage, [...deps, search]);

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(emptyForm);
    setErrors({});
    setSheetOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep links such as `?action=new` from the dashboard quick actions.
  useEffect(() => {
    if (params.action === 'new' && canCreate) {
      openCreate();
      router.setParams({ action: undefined });
    }
  }, [params.action, canCreate, openCreate, router]);

  const openEdit = (item: T) => {
    setEditing(item);
    setForm(toForm(item));
    setErrors({});
    setSheetOpen(true);
  };

  const set = <K extends keyof F>(key: K, value: F[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      if (!previous[key as string]) return previous;
      const next = { ...previous };
      delete next[key as string];
      return next;
    });
  };

  const handleSave = async () => {
    const validation = validate?.(form);
    if (validation && Object.keys(validation).length) {
      setErrors(validation);
      return;
    }
    setBusy(true);
    try {
      await onSave(form, editing);
      toast.success(t('common.success'));
      setSheetOpen(false);
      setEditing(null);
      await list.reload();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    // `canDelete` is re-checked here, not just at the button: a screen that
    // passes canDelete={false} must not be able to delete even if a row still
    // wires up its remove action. The Firestore rules are the real backstop.
    if (!confirmDelete || !onDelete || !canDelete) return;
    setBusy(true);
    try {
      await onDelete(confirmDelete);
      list.removeLocal(confirmDelete.id);
      toast.success(t('common.success'));
      setConfirmDelete(null);
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={list.refreshing} onRefresh={list.refresh} edges={['bottom']}>
      <View style={styles.toolbar}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {canCreate ? (
          <Button label={addLabel ?? t('common.add')} icon="add" size="sm" onPress={openCreate} />
        ) : null}
      </View>

      {header}

      {searchable ? (
        <>
          <SearchField value={term} onChangeText={setTerm} placeholder={searchPlaceholder} />
          <Spacer size={spacing.md} />
        </>
      ) : null}

      {filters}

      <Spacer size={spacing.md} />

      <AsyncBoundary
        loading={list.loading}
        error={list.error}
        empty={list.items.length === 0}
        onRetry={list.reload}
        skeleton={<SkeletonList count={5} />}
        emptyProps={{
          icon: (emptyIcon as never) ?? 'file-tray-outline',
          title: emptyTitle ?? t('empty.nothingHere'),
          actionLabel: canCreate ? (addLabel ?? t('common.add')) : undefined,
          onAction: canCreate ? openCreate : undefined,
        }}
      >
        <View style={{ gap: spacing.md }}>
          {list.items.map((item) => (
            <View key={item.id}>
              {renderItem(item, {
                edit: () => openEdit(item),
                remove: () => {
                  if (canDelete && onDelete) setConfirmDelete(item);
                },
              })}
            </View>
          ))}

          {list.hasMore ? (
            <Button
              label={t('common.loadMore')}
              onPress={list.loadMore}
              loading={list.loadingMore}
              variant="outline"
            />
          ) : null}
        </View>
      </AsyncBoundary>

      <Spacer size={spacing.xxxl} />

      <FormSheet
        visible={sheetOpen}
        title={
          editing
            ? (formTitle?.edit ?? t('common.edit'))
            : (formTitle?.create ?? addLabel ?? t('common.create'))
        }
        onClose={() => setSheetOpen(false)}
        onSubmit={handleSave}
        submitting={busy}
        submitLabel={editing ? t('common.save') : t('common.create')}
      >
        {renderForm(form, set, errors)}
      </FormSheet>

      <ConfirmDialog
        visible={Boolean(confirmDelete)}
        title={t('confirm.deleteTitle')}
        message={t('confirm.archiveMessage')}
        confirmLabel={t('common.delete')}
        destructive
        loading={busy}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.lg,
    paddingTop: spacing.sm,
  },
  title: { flex: 1, fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text },
});
