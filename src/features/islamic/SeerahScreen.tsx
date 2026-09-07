import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { useLanguageScope } from '@/hooks/useLanguageScope';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { matchesSearch } from '@/utils/format';
import * as seerah from '@/services/seerahService';
import type { SeerahChapter } from '@/types';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import {
  AppHeader,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  FormSheet,
  Screen,
  SearchField,
  SectionHeader,
  SkeletonList,
  Spacer,
  TextField,
} from '@/components/ui';

/**
 * The Seerah, chapter by chapter.
 *
 * Reading and writing are the same screen rather than two. Whoever writes these
 * chapters is also the person who reads them back to check, and sending them to
 * a separate admin area to fix a sentence they just spotted is the surest way
 * for the sentence to stay wrong.
 *
 * Chapters open one at a time. This is long prose meant to be read in order,
 * not a list to scan, and an accordion keeps the place in the narrative visible
 * while one chapter is open.
 */
export function SeerahScreen() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const toast = useToast();
  const { language, setLanguage } = useLanguageScope('seerah');

  const canEdit = can('MANAGE_ARTICLES');

  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<SeerahChapter | null>(null);
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<SeerahChapter | null>(null);
  const [form, setForm] = useState({
    title: '',
    body: '',
    period: '',
    author: '',
    source: '',
    order: '',
  });

  const load = useCallback(
    () => seerah.listChapters({ language, includeDrafts: canEdit }),
    [language, canEdit]
  );
  const { data, loading, error, reload } = useAsync(load, [language, canEdit]);

  const chapters = (data ?? []).filter((chapter) =>
    matchesSearch(search, chapter.title, chapter.body, chapter.period ?? undefined)
  );
  const groups = seerah.groupByPeriod(chapters);

  const startNew = () => {
    setEditing(null);
    setForm({
      title: '',
      body: '',
      period: '',
      author: '',
      source: '',
      // Next in sequence, so chapters added in order need no thought.
      order: String((data?.length ?? 0) + 1),
    });
    setComposing(true);
  };

  const startEdit = (chapter: SeerahChapter) => {
    setEditing(chapter);
    setForm({
      title: chapter.title,
      body: chapter.body,
      period: chapter.period ?? '',
      author: chapter.author ?? '',
      source: chapter.source ?? '',
      order: String(chapter.order ?? 0),
    });
    setComposing(true);
  };

  const save = async () => {
    if (!user || !form.title.trim() || !form.body.trim()) return;
    setBusy(true);
    try {
      await seerah.saveChapter(
        {
          title: form.title.trim(),
          body: form.body.trim(),
          period: form.period.trim() || null,
          author: form.author.trim() || null,
          source: form.source.trim() || null,
          order: Number.parseInt(form.order, 10) || 0,
          language,
          status: 'published',
        },
        user,
        editing?.id
      );
      setComposing(false);
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <AppHeader
        title={t('nav.seerah')}
        showBack
        right={<LanguageMenu value={language} onChange={setLanguage} />}
      />

      <Screen refreshing={loading} onRefresh={reload}>
        <Text style={styles.lead}>{t('seerah.lead')}</Text>

        <View style={styles.toolbar}>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder={t('seerah.search')}
            style={{ flex: 1 }}
          />
          {canEdit ? (
            <Button label={t('seerah.addChapter')} icon="add" size="sm" onPress={startNew} />
          ) : null}
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
        ) : chapters.length === 0 ? (
          <EmptyState
            icon="book-outline"
            title={search ? t('empty.noResults') : t('seerah.empty')}
            message={search ? undefined : canEdit ? t('seerah.emptyAdmin') : t('seerah.emptyHelp')}
            actionLabel={!search && canEdit ? t('seerah.addChapter') : undefined}
            onAction={!search && canEdit ? startNew : undefined}
          />
        ) : (
          Array.from(groups.entries()).map(([period, rows]) => (
            <React.Fragment key={period || 'ungrouped'}>
              {period ? (
                <>
                  <Spacer size={spacing.lg} />
                  <SectionHeader title={period} icon="bookmark-outline" />
                </>
              ) : null}

              {rows.map((chapter) => {
                const expanded = open === chapter.id;
                return (
                  <Card key={chapter.id} style={styles.chapter}>
                    <Pressable
                      onPress={() => setOpen(expanded ? null : chapter.id)}
                      accessibilityRole="button"
                      accessibilityState={{ expanded }}
                      accessibilityLabel={chapter.title}
                      style={styles.chapterHead}
                    >
                      <Text style={styles.chapterNumber}>{chapter.order || '–'}</Text>
                      <Text style={styles.chapterTitle}>{chapter.title}</Text>
                      <Ionicons
                        name={expanded ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={colors.textMuted}
                      />
                    </Pressable>

                    {expanded ? (
                      <>
                        {/* Split on blank lines rather than rendered as one
                            block: this is prose, and a wall of unbroken text is
                            what stops somebody reading it. */}
                        {chapter.body.split(/\n\s*\n/).map((paragraph, index) => (
                          <Text key={index} style={styles.paragraph}>
                            {paragraph.trim()}
                          </Text>
                        ))}

                        {chapter.author || chapter.source ? (
                          <Text style={styles.credit}>
                            {[chapter.author, chapter.source].filter(Boolean).join('  ·  ')}
                          </Text>
                        ) : null}

                        {canEdit ? (
                          <View style={styles.chapterActions}>
                            <Button
                              label={t('common.edit')}
                              icon="create-outline"
                              size="sm"
                              variant="outline"
                              onPress={() => startEdit(chapter)}
                            />
                            <Button
                              label={t('common.delete')}
                              icon="trash-outline"
                              size="sm"
                              variant="ghost"
                              onPress={() => setConfirmDelete(chapter)}
                            />
                          </View>
                        ) : null}
                      </>
                    ) : null}
                  </Card>
                );
              })}
            </React.Fragment>
          ))
        )}
      </Screen>

      <FormSheet
        visible={composing}
        title={t(editing ? 'seerah.editChapter' : 'seerah.addChapter')}
        onClose={() => setComposing(false)}
        onSubmit={save}
        submitting={busy}
        submitDisabled={!form.title.trim() || !form.body.trim()}
      >
        <TextField
          label={t('seerah.chapterTitle')}
          value={form.title}
          onChangeText={(v) => setForm((f) => ({ ...f, title: v }))}
          icon="book-outline"
          required
        />
        <TextField
          label={t('seerah.period')}
          value={form.period}
          onChangeText={(v) => setForm((f) => ({ ...f, period: v }))}
          icon="bookmark-outline"
          hint={t('seerah.periodHint')}
        />
        <TextField
          label={t('seerah.order')}
          value={form.order}
          onChangeText={(v) => setForm((f) => ({ ...f, order: v.replace(/[^0-9]/g, '') }))}
          keyboardType="number-pad"
          icon="list-outline"
          hint={t('seerah.orderHint')}
        />
        <TextField
          label={t('seerah.body')}
          value={form.body}
          onChangeText={(v) => setForm((f) => ({ ...f, body: v }))}
          multiline
          required
        />
        <TextField
          label={t('seerah.author')}
          value={form.author}
          onChangeText={(v) => setForm((f) => ({ ...f, author: v }))}
          icon="person-outline"
          hint={t('seerah.authorHint')}
        />
        <TextField
          label={t('seerah.source')}
          value={form.source}
          onChangeText={(v) => setForm((f) => ({ ...f, source: v }))}
          icon="link-outline"
          hint={t('seerah.sourceHint')}
          containerStyle={{ marginBottom: 0 }}
        />
      </FormSheet>

      <ConfirmDialog
        visible={Boolean(confirmDelete)}
        title={t('common.delete')}
        message={t('seerah.deleteConfirm', { title: confirmDelete?.title ?? '' })}
        confirmLabel={t('common.delete')}
        destructive
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const chapter = confirmDelete;
          setConfirmDelete(null);
          if (!chapter || !user) return;
          try {
            await seerah.deleteChapter(chapter, user);
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
  lead: { fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 21 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  chapter: { marginBottom: spacing.sm },
  chapterHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  chapterNumber: {
    minWidth: 26,
    textAlign: 'center',
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: brand.orange,
  },
  chapterTitle: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  paragraph: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 23,
    marginTop: spacing.md,
  },
  credit: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: spacing.md,
    fontStyle: 'italic',
  },
  chapterActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
});
