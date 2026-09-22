import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { formatDate } from '@/utils/date';
import { friendlyMessage } from '@/utils/errors';
import * as workbookService from '@/services/workbookService';
import { EVERYONE } from '@/types/audience';
import type { Workbook } from '@/types';
import {
  AppHeader,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Screen,
  SectionHeader,
  SkeletonList,
} from '@/components/ui';
import { DrawCanvas } from './DrawCanvas';
import { WorkbookEditor } from './WorkbookEditor';
import { decodeStrokes, type Stroke } from './strokes';

/**
 * Workbooks, for anybody with an account: the ones handed to them, and their own.
 *
 * MY WORKBOOKS is the same pen, the same pages and the same editor a teacher
 * writes a lesson with. Writing by hand — working through an exercise, copying
 * out an ayah, drawing the shape of a letter — is ordinary study, and there was
 * no reason it belonged to staff. A student's workbook is private to them:
 * handing one to other people is publishing, which stays a staff permission.
 *
 * SHARED WITH ME is live rather than fetched once: a teacher who publishes
 * during a lesson means it to be on the desks now, not when somebody thinks to
 * pull the list down. Read-only, and drawn by the same canvas it was written
 * on, so the handwriting is identical rather than a flattened picture of it.
 *
 * A guest sees only what was published to everybody: they have no account to
 * keep a workbook in.
 */
export function StudentWorkbookScreen() {
  const { t } = useTranslation();
  const { user, isGuest } = useAuth();
  const toast = useToast();

  const [shared, setShared] = useState<Workbook[] | null>(null);
  const [mine, setMine] = useState<Workbook[] | null>(null);
  const [reading, setReading] = useState<Workbook | null>(null);
  const [editing, setEditing] = useState<Workbook | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Workbook | null>(null);

  useEffect(() => {
    if (!user) return undefined;
    return workbookService.watchForStudent(
      user,
      (rows) => setShared(rows),
      () => setShared([])
    );
  }, [user]);

  const loadMine = useCallback(async () => {
    if (!user || isGuest) {
      setMine([]);
      return;
    }
    const rows = await workbookService
      .listMine(user)
      .then((page) => page.items)
      .catch(() => [] as Workbook[]);
    setMine(rows);
  }, [user, isGuest]);

  useEffect(() => {
    void loadMine();
  }, [loadMine]);

  const startNew = async () => {
    if (!user || creating) return;
    setCreating(true);
    try {
      // Made straight away rather than after a form: the page has to exist
      // before it can be written on, and a dialog first is a dialog between
      // somebody and the thought they were about to write down.
      const id = await workbookService.createWorkbook({ title: '', audience: EVERYONE }, user);
      const made = await workbookService.getWorkbook(id);
      if (made) setEditing(made);
      await loadMine();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
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
          void loadMine();
        }}
        onChanged={() => void loadMine()}
      />
    );
  }

  if (reading) {
    return <WorkbookReader workbook={reading} onClose={() => setReading(null)} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('nav.workbooks')} showBack />
      <Screen>
        {!isGuest && user ? (
          <>
            <View style={styles.toolbar}>
              <SectionHeader title={t('workbook.mine')} icon="create-outline" />
              <Button
                label={t('workbook.new')}
                icon="add"
                size="sm"
                loading={creating}
                onPress={() => void startNew()}
              />
            </View>

            {mine === null ? (
              <SkeletonList count={2} />
            ) : mine.length === 0 ? (
              <EmptyState
                icon="create-outline"
                title={t('workbook.mineEmpty')}
                message={t('workbook.mineEmptyHelp')}
                actionLabel={t('workbook.new')}
                onAction={() => void startNew()}
              />
            ) : (
              mine.map((workbook) => (
                <Card key={workbook.id} style={styles.card} onPress={() => setEditing(workbook)}>
                  <View style={styles.head}>
                    <Ionicons name="create" size={18} color={colors.primary} />
                    <Text style={styles.title} numberOfLines={1}>
                      {workbook.title || t('workbook.untitled')}
                    </Text>
                  </View>
                  <Text style={styles.meta}>
                    {formatDate(workbook.date)}
                    {'  ·  '}
                    {t('workbook.pages', { count: workbook.pageCount ?? 0 })}
                  </Text>
                  <View style={styles.actions}>
                    <Button
                      label={t('common.edit')}
                      icon="create-outline"
                      size="sm"
                      variant="ghost"
                      onPress={() => setEditing(workbook)}
                    />
                    <Button
                      label={t('common.delete')}
                      icon="trash-outline"
                      size="sm"
                      variant="ghost"
                      onPress={() => setConfirmDelete(workbook)}
                    />
                  </View>
                </Card>
              ))
            )}

            <SectionHeader title={t('workbook.shared')} icon="book-outline" />
          </>
        ) : null}

        {shared === null ? (
          <SkeletonList count={3} />
        ) : shared.length === 0 ? (
          <EmptyState
            icon="book-outline"
            title={t('workbook.studentEmpty')}
            message={t('workbook.studentEmptyHelp')}
          />
        ) : (
          shared.map((workbook) => (
            <Card key={workbook.id} style={styles.card} onPress={() => setReading(workbook)}>
              <View style={styles.head}>
                <Ionicons name="book" size={18} color={colors.primary} />
                <Text style={styles.title} numberOfLines={1}>
                  {workbook.title || formatDate(workbook.date)}
                </Text>
              </View>
              <Text style={styles.meta}>
                {formatDate(workbook.date)}
                {'  ·  '}
                {t('workbook.pages', { count: workbook.pageCount ?? 0 })}
                {workbook.authorName ? `  ·  ${workbook.authorName}` : ''}
              </Text>
              {workbook.body ? (
                <Text style={styles.body} numberOfLines={2}>
                  {workbook.body}
                </Text>
              ) : null}
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
            await loadMine();
          } catch (error) {
            toast.error(friendlyMessage(error, t));
          }
        }}
      />
    </View>
  );
}

/** One workbook, a page at a time. */
function WorkbookReader({ workbook, onClose }: { workbook: Workbook; onClose: () => void }) {
  const { t } = useTranslation();
  const [pages, setPages] = useState<{ strokes: Stroke[]; text: string }[] | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let alive = true;
    void workbookService
      .listPages(workbook.id)
      .then((rows) => {
        if (!alive) return;
        setPages(rows.map((r) => ({ strokes: decodeStrokes(r.strokes), text: r.text ?? '' })));
      })
      .catch(() => alive && setPages([]));
    return () => {
      alive = false;
    };
  }, [workbook.id]);

  const page = pages?.[index];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.topBar}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={{ padding: spacing.xs }}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle} numberOfLines={1}>
            {workbook.title || formatDate(workbook.date)}
          </Text>
          <Text style={styles.topDate}>{formatDate(workbook.date)}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
        {pages === null ? (
          <SkeletonList count={1} />
        ) : !page ? (
          <EmptyState icon="document-outline" title={t('workbook.noPages')} />
        ) : (
          <>
            <DrawCanvas
              strokes={page.strokes}
              onChange={() => undefined}
              tool="pen"
              color="#000000"
              width={4}
              readOnly
            />

            {page.text ? <Text style={styles.pageText}>{page.text}</Text> : null}

            <View style={styles.pager}>
              <Pressable
                onPress={() => setIndex((i) => Math.max(0, i - 1))}
                disabled={index === 0}
                accessibilityRole="button"
                accessibilityLabel={t('workbook.previous')}
                style={[styles.pagerBtn, index === 0 && styles.pagerOff]}
              >
                <Ionicons name="chevron-back" size={20} color={colors.text} />
              </Pressable>
              <Text style={styles.pageLabel}>
                {t('workbook.pageOf', { page: index + 1, total: pages.length })}
              </Text>
              <Pressable
                onPress={() => setIndex((i) => Math.min(pages.length - 1, i + 1))}
                disabled={index >= pages.length - 1}
                accessibilityRole="button"
                accessibilityLabel={t('workbook.next')}
                style={[styles.pagerBtn, index >= pages.length - 1 && styles.pagerOff]}
              >
                <Ionicons name="chevron-forward" size={20} color={colors.text} />
              </Pressable>
            </View>
          </>
        )}

        {workbook.body ? (
          <Card style={{ marginTop: spacing.lg }}>
            <Text style={styles.body}>{workbook.body}</Text>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  topTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  topDate: { fontSize: fontSize.xs, color: colors.textMuted },
  pageText: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 21,
    marginTop: spacing.md,
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  pagerBtn: { padding: spacing.sm },
  pagerOff: { opacity: 0.3 },
  pageLabel: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: fontWeight.semibold },
});
