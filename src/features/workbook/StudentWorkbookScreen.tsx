import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { formatDate } from '@/utils/date';
import * as workbookService from '@/services/workbookService';
import type { Workbook } from '@/types';
import { AppHeader, Card, EmptyState, Screen, SkeletonList } from '@/components/ui';
import { DrawCanvas } from './DrawCanvas';
import { decodeStrokes, type Stroke } from './strokes';

/**
 * The workbooks a student has been given.
 *
 * Live rather than fetched once: a teacher who publishes during a lesson means
 * it to be on the desks now, not when somebody thinks to pull the list down.
 *
 * Read-only throughout. The same canvas draws the page as the one it was
 * written on, so the handwriting is identical rather than a flattened picture
 * of it — and it stays sharp on a phone, a tablet and a laptop alike.
 */
export function StudentWorkbookScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [workbooks, setWorkbooks] = useState<Workbook[] | null>(null);
  const [open, setOpen] = useState<Workbook | null>(null);

  useEffect(() => {
    if (!user) return;
    return workbookService.watchForStudent(
      user,
      (rows) => setWorkbooks(rows),
      () => setWorkbooks([])
    );
  }, [user]);

  if (open) {
    return <WorkbookReader workbook={open} onClose={() => setOpen(null)} />;
  }

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('nav.workbooks')} showBack />
      <Screen>
        {workbooks === null ? (
          <SkeletonList count={3} />
        ) : workbooks.length === 0 ? (
          <EmptyState
            icon="book-outline"
            title={t('workbook.studentEmpty')}
            message={t('workbook.studentEmptyHelp')}
          />
        ) : (
          workbooks.map((w) => (
            <Card key={w.id} style={styles.card} onPress={() => setOpen(w)}>
              <View style={styles.head}>
                <Ionicons name="book" size={18} color={colors.primary} />
                <Text style={styles.title} numberOfLines={1}>
                  {w.title || formatDate(w.date)}
                </Text>
              </View>
              <Text style={styles.meta}>
                {formatDate(w.date)}
                {'  ·  '}
                {t('workbook.pages', { count: w.pageCount ?? 0 })}
                {w.authorName ? `  ·  ${w.authorName}` : ''}
              </Text>
              {w.body ? (
                <Text style={styles.body} numberOfLines={2}>
                  {w.body}
                </Text>
              ) : null}
            </Card>
          ))
        )}
      </Screen>
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
  card: { marginBottom: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  meta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  body: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20, marginTop: spacing.sm },
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
