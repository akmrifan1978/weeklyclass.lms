import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { formatDate } from '@/utils/date';
import * as workbookService from '@/services/workbookService';
import { AudiencePicker } from '@/components/shared/AudiencePicker';
import { audienceFrom, audienceIsUsable, type Audience } from '@/types/audience';
import type { Workbook, WorkbookPage } from '@/types';
import {
  Button,
  Card,
  ConfirmDialog,
  StatusBadge,
  TextField,
} from '@/components/ui';
import { DrawCanvas } from './DrawCanvas';
import { PenToolbar } from './PenToolbar';
import {
  decodeStrokes,
  encodeStrokes,
  PAGE_BYTE_BUDGET,
  PEN_COLORS,
  PEN_WIDTHS,
  sizeOf,
  type PenTool,
  type Stroke,
} from './strokes';

interface EditablePage {
  /** Absent until the page has been saved once. */
  id?: string;
  order: number;
  strokes: Stroke[];
  text: string;
}

/**
 * Writing a workbook.
 *
 * One page is on screen at a time, which is how a book works and how a phone
 * has room to show anything at all. Pages are kept in memory while editing and
 * written when you leave one or press save — saving on every stroke would be a
 * network round-trip per letter.
 *
 * WHAT PROTECTS THE WORK: a page is never lost by navigating away from it,
 * because moving between pages flushes the one being left. The only way to
 * lose a stroke is to close the screen with unsaved changes, and that asks
 * first.
 */
export function WorkbookEditor({
  workbook,
  onClose,
  onChanged,
}: {
  workbook: Workbook;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  // Everybody writes; not everybody hands their pages to other people. For
  // somebody without the permission there is no audience to choose and no
  // publish button - the rules would refuse it, and offering a button that
  // cannot work is worse than not offering it.
  const mayPublish = can('PUBLISH_WORKBOOK');
  const toast = useToast();

  const [title, setTitle] = useState(workbook.title);
  const [body, setBody] = useState(workbook.body ?? '');
  const [audience, setAudience] = useState<Audience>(audienceFrom(workbook));

  const [pages, setPages] = useState<EditablePage[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showAudience, setShowAudience] = useState(false);

  const [tool, setTool] = useState<PenTool>('pen');
  const [color, setColor] = useState<string>(PEN_COLORS[0].value);
  const [width, setWidth] = useState<number>(PEN_WIDTHS[1]);

  // Read by the save routine, which must never see a stale page list.
  const pagesRef = useRef<EditablePage[]>([]);
  pagesRef.current = pages;

  useEffect(() => {
    let alive = true;
    void workbookService
      .listPages(workbook.id)
      .then((rows: WorkbookPage[]) => {
        if (!alive) return;
        const loaded = rows.map((row) => ({
          id: row.id,
          order: row.order,
          strokes: decodeStrokes(row.strokes),
          text: row.text ?? '',
        }));
        // A workbook always has a page to write on. An empty book that makes
        // you press "add page" before you can start is a door with a doorbell.
        setPages(loaded.length ? loaded : [{ order: 0, strokes: [], text: '' }]);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setPages([{ order: 0, strokes: [], text: '' }]);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [workbook.id]);

  const current = pages[index];

  const setStrokes = useCallback(
    (strokes: Stroke[]) => {
      setDirty(true);
      setPages((prev) => prev.map((p, i) => (i === index ? { ...p, strokes } : p)));
    },
    [index]
  );

  const undo = () => {
    if (!current?.strokes.length) return;
    setStrokes(current.strokes.slice(0, -1));
  };

  /** Writes every page and the workbook itself. */
  const saveAll = useCallback(
    async (status?: 'draft' | 'published'): Promise<boolean> => {
      if (!user) return false;
      setBusy(true);
      try {
        const list = pagesRef.current;

        // Refuse before writing, not after. A page over the document limit is
        // rejected by Firestore with an error nobody can act on; this says
        // which page and what to do about it.
        for (const page of list) {
          if (sizeOf(page.strokes) > PAGE_BYTE_BUDGET) {
            toast.error(t('workbook.pageTooBig', { page: page.order + 1 }));
            return false;
          }
        }

        const saved = await Promise.all(
          list.map(async (page) => ({
            ...page,
            id: await workbookService.savePage(workbook.id, {
              id: page.id,
              order: page.order,
              strokes: encodeStrokes(page.strokes),
              text: page.text,
            }),
          }))
        );
        setPages(saved);

        await workbookService.updateWorkbook(
          workbook.id,
          { title, body, audience, pageCount: saved.length, status },
          user
        );
        setDirty(false);
        onChanged();
        return true;
      } catch (error) {
        toast.error(friendlyMessage(error, t));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [audience, body, onChanged, t, title, toast, user, workbook.id]
  );

  const publish = async () => {
    if (!user) return;
    if (!audienceIsUsable(audience)) {
      toast.error(t('workbook.pickAudience'));
      setShowAudience(true);
      return;
    }
    const ok = await saveAll();
    if (!ok) return;
    setBusy(true);
    try {
      await workbookService.publish(workbook, audience, user);
      toast.success(t('workbook.publishedToast'));
      onChanged();
      onClose();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  const unpublish = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await workbookService.unpublish(workbook, user);
      toast.success(t('workbook.unpublishedToast'));
      onChanged();
      onClose();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  const addPage = () => {
    setDirty(true);
    setPages((prev) => {
      const next = [...prev, { order: prev.length, strokes: [], text: '' }];
      setIndex(next.length - 1);
      return next;
    });
  };

  const removePage = async () => {
    if (pages.length <= 1) return;
    const page = pages[index];
    setDirty(true);
    if (page.id) await workbookService.deletePage(workbook.id, page.id).catch(() => undefined);
    setPages((prev) => {
      const next = prev.filter((_, i) => i !== index).map((p, i) => ({ ...p, order: i }));
      setIndex(Math.max(0, Math.min(index, next.length - 1)));
      return next;
    });
  };

  const close = () => {
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  if (loading || !current) {
    return (
      <View style={styles.loading}>
        <Text style={styles.loadingText}>{t('common.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.topBar}>
        <Pressable
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          style={styles.iconBtn}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.topTitle} numberOfLines={1}>
            {title || t('workbook.untitled')}
          </Text>
          {/* The date it was made, always visible. It is what a workbook is
              filed under and the one thing that never changes about it. */}
          <Text style={styles.topDate}>{formatDate(workbook.date)}</Text>
        </View>
        <StatusBadge status={workbook.status} />
        {dirty ? <View style={styles.dot} accessibilityLabel={t('workbook.unsaved')} /> : null}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <TextField
          label={t('workbook.title')}
          value={title}
          onChangeText={(v) => {
            setTitle(v);
            setDirty(true);
          }}
          icon="book-outline"
        />

        <PenToolbar
          tool={tool}
          onTool={setTool}
          color={color}
          onColor={setColor}
          width={width}
          onWidth={setWidth}
          onUndo={undo}
          onClear={() => setConfirmClear(true)}
          canUndo={current.strokes.length > 0}
        />

        <DrawCanvas
          strokes={current.strokes}
          onChange={setStrokes}
          tool={tool}
          color={color}
          width={width}
        />

        <View style={styles.pager}>
          <Button
            label={t('workbook.previous')}
            icon="chevron-back"
            size="sm"
            variant="ghost"
            disabled={index === 0}
            onPress={() => setIndex((i) => Math.max(0, i - 1))}
          />
          <Text style={styles.pageLabel}>
            {t('workbook.pageOf', { page: index + 1, total: pages.length })}
          </Text>
          <Button
            label={t('workbook.next')}
            icon="chevron-forward"
            size="sm"
            variant="ghost"
            disabled={index >= pages.length - 1}
            onPress={() => setIndex((i) => Math.min(pages.length - 1, i + 1))}
          />
        </View>

        <View style={styles.pageActions}>
          <Button label={t('workbook.addPage')} icon="add" size="sm" onPress={addPage} />
          <Button
            label={t('workbook.removePage')}
            icon="trash-outline"
            size="sm"
            variant="ghost"
            disabled={pages.length <= 1}
            onPress={() => void removePage()}
          />
        </View>

        <TextField
          label={t('workbook.typedNotes')}
          value={current.text}
          onChangeText={(v) => {
            setDirty(true);
            setPages((prev) => prev.map((p, i) => (i === index ? { ...p, text: v } : p)));
          }}
          multiline
          hint={t('workbook.typedNotesHint')}
        />

        <TextField
          label={t('workbook.description')}
          value={body}
          onChangeText={(v) => {
            setBody(v);
            setDirty(true);
          }}
          multiline
        />

        {mayPublish ? (
          <Card style={styles.audienceCard}>
            <Pressable
              onPress={() => setShowAudience((v) => !v)}
              accessibilityRole="button"
              style={styles.audienceHead}
            >
              <Ionicons name="people-outline" size={18} color={colors.primary} />
              <Text style={styles.audienceTitle}>{t('audience.label')}</Text>
              <Ionicons
                name={showAudience ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.textMuted}
              />
            </Pressable>
            {showAudience ? (
              <AudiencePicker
                value={audience}
                onChange={(a) => {
                  setAudience(a);
                  setDirty(true);
                }}
              />
            ) : null}
          </Card>
        ) : null}
      </ScrollView>

      <View style={styles.actions}>
        <Button
          label={t('common.save')}
          icon="save-outline"
          variant="secondary"
          loading={busy}
          onPress={() => void saveAll()}
          style={{ flex: 1 }}
        />
        {!mayPublish ? null : workbook.status === 'published' ? (
          <Button
            label={t('workbook.unpublish')}
            icon="eye-off-outline"
            variant="ghost"
            loading={busy}
            onPress={() => void unpublish()}
            style={{ flex: 1 }}
          />
        ) : (
          <Button
            label={t('workbook.publish')}
            icon="send-outline"
            loading={busy}
            onPress={() => void publish()}
            style={{ flex: 1 }}
          />
        )}
      </View>

      <ConfirmDialog
        visible={confirmClose}
        title={t('workbook.unsaved')}
        message={t('workbook.unsavedHelp')}
        confirmLabel={t('common.save')}
        cancelLabel={t('workbook.discard')}
        onCancel={() => {
          setConfirmClose(false);
          onClose();
        }}
        onConfirm={async () => {
          setConfirmClose(false);
          const ok = await saveAll();
          if (ok) onClose();
        }}
      />

      <ConfirmDialog
        visible={confirmClear}
        title={t('workbook.clearPage')}
        message={t('workbook.clearPageConfirm')}
        confirmLabel={t('workbook.clearPage')}
        destructive
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          setStrokes([]);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { fontSize: fontSize.sm, color: colors.textMuted },
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
  iconBtn: { padding: spacing.xs },
  topTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  topDate: { fontSize: fontSize.xs, color: colors.textMuted },
  dot: { width: 8, height: 8, borderRadius: 999, backgroundColor: colors.accent },
  body: { padding: spacing.lg, paddingBottom: spacing.xxxl },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  pageLabel: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: fontWeight.semibold },
  pageActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    justifyContent: 'center',
  },
  audienceCard: { marginTop: spacing.md },
  audienceHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  audienceTitle: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
