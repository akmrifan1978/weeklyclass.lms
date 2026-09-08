import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useLanguageScope } from '@/hooks/useLanguageScope';
import { useAsync } from '@/hooks/useAsync';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import * as quranService from '@/services/quranService';
import * as plans from '@/services/quranPlanService';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import { AyahAudio } from './AyahAudio';
import { ScriptureText } from './ScriptureText';
import {
  AppHeader,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Screen,
  SectionHeader,
  SkeletonList,
  Select,
  TextField,
  ToggleRow,
  type Option,
} from '@/components/ui';

/**
 * The daily Qur'an reading plan.
 *
 * One screen deliberately, not a flow. Setting the plan, reading today's pages
 * and seeing how far you have come are the same activity done daily, and
 * splitting them across screens would put two taps between opening the app and
 * reading — which is the one thing a daily habit cannot afford.
 */
export function ReadingPlanScreen({ headerTint }: { headerTint?: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();
  const { language, setLanguage } = useLanguageScope('quran');

  const [plan, setPlan] = useState<plans.ReadingPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(true);
  const [editing, setEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // A plan stored on the profile is adopted only when this device has none,
      // so a plan in progress here is never overwritten by an older copy.
      await plans.adoptFromProfile(
        (user as { quranPlan?: plans.ReadingPlan } | null)?.quranPlan
      );
      const stored = await plans.loadPlan();
      if (cancelled) return;
      setPlan(stored);
      setEditing(!stored);
      setLoadingPlan(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const { data: surahs } = useAsync(() => quranService.listSurahs(), []);

  const pagesDue = plan ? plans.todaysPages(plan) : [];
  const done = plan ? plans.completedToday(plan) : false;
  const finished = plan ? plans.isFinished(plan) : false;

  /**
   * Reading on past the day's portion.
   *
   * The screen showed today's pages and stopped there: the only way forward was
   * to mark the day complete, which is a claim about having read it rather than
   * a way to turn a page. Somebody who finished early and wanted to carry on,
   * or who wanted to look back at yesterday, had nowhere to press.
   *
   * `null` means today. Browsing away from it never touches the plan — the
   * cursor, the history and the streak are all untouched by looking — so the
   * reading position is exactly where it was when they come back.
   */
  const [browseStart, setBrowseStart] = useState<number | null>(null);

  const windowSize = Math.max(1, pagesDue.length || (plan?.dailyPages ?? 1));
  const firstPage = browseStart ?? pagesDue[0] ?? 1;
  const onToday = browseStart === null;

  const shownPages = useMemo(() => {
    if (!plan) return [];
    if (onToday) return pagesDue;
    const out: number[] = [];
    for (let page = firstPage; page < firstPage + windowSize; page += 1) {
      if (page >= 1 && page <= quranService.TOTAL_PAGES) out.push(page);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, onToday, pagesDue.join(','), firstPage, windowSize]);

  const canGoBack = shownPages.length > 0 && shownPages[0] > 1;
  const canGoForward =
    shownPages.length > 0 && shownPages[shownPages.length - 1] < quranService.TOTAL_PAGES;

  /** Moves the window without disturbing the plan. */
  const step = (direction: -1 | 1) => {
    const from = shownPages[0] ?? 1;
    const next = Math.min(
      quranService.TOTAL_PAGES,
      Math.max(1, from + direction * windowSize)
    );
    setBrowseStart(next);
  };

  const loadPages = useCallback(async () => {
    if (!plan || shownPages.length === 0) return [];
    return Promise.all(
      shownPages.map((page) =>
        quranService.getPage(page, language, { audio: plan.audioEnabled })
      )
    );
    // Keyed on the pages themselves rather than the cursor: marking a day done
    // moves the cursor but must keep today's reading on screen, and undoing it
    // moves the cursor back to the same pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownPages.join(','), plan?.audioEnabled, language]);

  const {
    data: pages,
    loading: loadingPages,
    error,
    reload,
  } = useAsync(loadPages, [loadPages], { enabled: Boolean(plan) && !finished });

  /**
   * Surahs finished since the plan began.
   *
   * Reading runs forward through the mushaf, so every surah before the one now
   * open is complete. Counting from the plan's own starting surah rather than
   * from Al-Faatiha keeps this honest for a plan that starts partway in — it
   * reports what THIS plan has covered, not what the reader has ever read.
   */
  const surahsCompleted = useMemo(() => {
    if (!plan || !pages?.length) return 0;
    const current = pages[0].surahs[0]?.number ?? plan.startSurah;
    return Math.max(0, current - plan.startSurah);
  }, [plan, pages]);

  const progress = plan ? plans.progressFor(plan, surahsCompleted) : null;

  const complete = async () => {
    if (!plan) return;
    setSaving(true);
    try {
      setPlan(await plans.markComplete(plan, user?.uid));
      toast.success(t('quran.markedComplete'));
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    if (!plan) return;
    setPlan(await plans.undoToday(plan, user?.uid));
  };

  const toggle = async (key: 'reminderEnabled' | 'audioEnabled', value: boolean) => {
    if (!plan) return;
    setPlan(await plans.updatePlan(plan, { [key]: value }, user?.uid));
  };

  if (loadingPlan) {
    return (
      <>
        <AppHeader title={t('quran.readingPlan')} showBack />
        <Screen>
          <SkeletonList count={4} />
        </Screen>
      </>
    );
  }

  return (
    <>
      <AppHeader
        title={t('quran.readingPlan')}
        showBack
        right={<LanguageMenu value={language} onChange={setLanguage} tint={headerTint} />}
      />
      <Screen>
        {editing || !plan ? (
          <PlanForm
            plan={plan}
            surahs={surahs ?? []}
            onCancel={plan ? () => setEditing(false) : undefined}
            onSaved={(saved) => {
              setPlan(saved);
              setEditing(false);
            }}
          />
        ) : (
          <>
            {progress ? <ProgressCard progress={progress} plan={plan} /> : null}

            {finished ? (
              <Card style={styles.finished}>
                <Ionicons name="ribbon" size={40} color={brand.orange} />
                <Text style={styles.finishedTitle}>{t('quran.planFinished')}</Text>
                <Button
                  label={t('quran.startNewPlan')}
                  icon="refresh"
                  size="sm"
                  onPress={() => setEditing(true)}
                  style={{ marginTop: spacing.lg }}
                />
              </Card>
            ) : (
              <>
                <SectionHeader
                  title={t('quran.todaysReading')}
                  icon="book-outline"
                  actionLabel={done ? t('common.undo') : undefined}
                  onAction={done ? undo : undefined}
                />

                <Card style={styles.todayCard}>
                  <View style={styles.todayRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.todayPages}>
                        {shownPages.length === 1
                          ? t('quran.pageNumber', { page: shownPages[0] })
                          : t('quran.pageRange', {
                              from: shownPages[0],
                              to: shownPages[shownPages.length - 1],
                            })}
                      </Text>
                      <Text style={styles.todayMeta}>
                        {t('quran.juzNumber', { juz: pages?.[0]?.juz ?? '—' })}
                      </Text>
                    </View>
                    {done && onToday ? (
                      <View style={styles.doneChip}>
                        <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                        <Text style={styles.doneText}>{t('quran.completed')}</Text>
                      </View>
                    ) : null}
                  </View>

                  {/* Turning the page. Wraps on a narrow screen so the three
                      controls never run off the edge of a phone. */}
                  <View style={styles.pager}>
                    <Button
                      label={t('quran.previousPage')}
                      icon="chevron-back"
                      variant="outline"
                      size="sm"
                      disabled={!canGoBack}
                      onPress={() => step(-1)}
                      style={styles.pagerButton}
                    />
                    <Button
                      label={t('quran.nextPage')}
                      icon="chevron-forward"
                      variant="outline"
                      size="sm"
                      disabled={!canGoForward}
                      onPress={() => step(1)}
                      style={styles.pagerButton}
                    />
                  </View>

                  {/* Only offered once they have actually wandered off, so it
                      is never a button that does nothing. */}
                  {!onToday ? (
                    <Button
                      label={t('quran.backToToday')}
                      icon="today-outline"
                      variant="ghost"
                      size="sm"
                      onPress={() => setBrowseStart(null)}
                      fullWidth
                      style={{ marginTop: spacing.sm }}
                    />
                  ) : null}

                  {/* Completing the day is a claim about today's portion, so it
                      is not offered while looking at some other part of the
                      mushaf — that would mark the wrong pages read. */}
                  {!done && onToday ? (
                    <Button
                      label={t('quran.markComplete')}
                      icon="checkmark-done"
                      onPress={complete}
                      loading={saving}
                      fullWidth
                      style={{ marginTop: spacing.md }}
                    />
                  ) : null}
                </Card>

                {loadingPages ? (
                  <SkeletonList count={5} />
                ) : error ? (
                  <ErrorState error={error} onRetry={reload} />
                ) : (
                  pages?.map((page) => (
                    <View key={page.page}>
                      <SectionHeader
                        title={`${page.surahs.map((s) => s.englishName).join(' · ')} — ${t(
                          'quran.pageNumber',
                          { page: page.page }
                        )}`}
                        icon="document-text-outline"
                      />
                      {page.ayahs.map((ayah) => (
                        <Card
                          key={`${ayah.surahNumber}:${ayah.number}`}
                          style={styles.ayah}
                        >
                          <View style={styles.ayahHeader}>
                            <View style={styles.badge}>
                              <Text style={styles.badgeText}>
                                {ayah.surahNumber}:{ayah.number}
                              </Text>
                            </View>
                            {plan.audioEnabled && ayah.audio ? (
                              <AyahAudio url={ayah.audio} />
                            ) : null}
                          </View>
                          <ScriptureText
                            arabic={ayah.arabic}
                            translation={
                              ayah.translation
                                ? {
                                    text: ayah.translation,
                                    language,
                                    source: quranService.translationSourceFor(language),
                                  }
                                : null
                            }
                          />
                        </Card>
                      ))}
                    </View>
                  ))
                )}
              </>
            )}

            <SectionHeader title={t('quran.planSettings')} icon="options-outline" />
            <Card style={styles.settings}>
              <ToggleRow
                label={t('quran.dailyReminder')}
                description={
                  plans.remindersSupported()
                    ? t('quran.dailyReminderHint', { time: plan.reminderTime })
                    : t('quran.remindersNeedApp')
                }
                value={plan.reminderEnabled}
                onValueChange={(v) => toggle('reminderEnabled', v)}
                disabled={!plans.remindersSupported()}
              />
              <ToggleRow
                label={t('quran.audioRecitation')}
                description={t('quran.audioRecitationHint')}
                value={plan.audioEnabled}
                onValueChange={(v) => toggle('audioEnabled', v)}
              />
              <View style={styles.settingsActions}>
                <Button
                  label={t('quran.editPlan')}
                  icon="create-outline"
                  variant="outline"
                  size="sm"
                  onPress={() => setEditing(true)}
                />
                <Button
                  label={t('quran.resetPlan')}
                  icon="trash-outline"
                  variant="ghost"
                  size="sm"
                  onPress={() => setConfirmReset(true)}
                />
              </View>
            </Card>

            {plan.history.length ? (
              <>
                <SectionHeader title={t('quran.readingHistory')} icon="time-outline" />
                <Card style={styles.history}>
                  {plan.history.slice(0, 30).map((entry) => (
                    <View key={entry.date} style={styles.historyRow}>
                      <Ionicons
                        name="checkmark-circle"
                        size={16}
                        color={colors.success}
                      />
                      <Text style={styles.historyDate}>{entry.date}</Text>
                      <Text style={styles.historyPages}>
                        {entry.fromPage === entry.toPage
                          ? t('quran.pageNumber', { page: entry.fromPage })
                          : t('quran.pageRange', {
                              from: entry.fromPage,
                              to: entry.toPage,
                            })}
                      </Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}
          </>
        )}
      </Screen>

      <ConfirmDialog
        visible={confirmReset}
        title={t('quran.resetPlan')}
        message={t('quran.resetPlanConfirm')}
        confirmLabel={t('common.delete')}
        destructive
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          await plans.deletePlan(user?.uid);
          setPlan(null);
          setEditing(true);
          setConfirmReset(false);
        }}
      />
    </>
  );
}

function ProgressCard({
  progress,
  plan,
}: {
  progress: plans.PlanProgress;
  plan: plans.ReadingPlan;
}) {
  const { t } = useTranslation();
  return (
    <Card style={styles.progressCard}>
      <View style={styles.progressHeader}>
        <Text style={styles.progressPercent}>{progress.percent}%</Text>
        {progress.streak > 1 ? (
          <View style={styles.streak}>
            <Ionicons name="flame" size={15} color={brand.orange} />
            <Text style={styles.streakText}>
              {t('quran.streak', { count: progress.streak })}
            </Text>
          </View>
        ) : null}
      </View>

      <View
        style={styles.bar}
        accessibilityRole="progressbar"
        accessibilityValue={{ now: progress.percent, min: 0, max: 100 }}
      >
        <View style={[styles.barFill, { width: `${progress.percent}%` }]} />
      </View>

      <View style={styles.stats}>
        <Stat
          value={`${progress.pagesRead}/${progress.pagesTotal}`}
          label={t('quran.pages')}
        />
        <Stat value={`${progress.juzRead}/${progress.juzTotal}`} label={t('quran.juz')} />
        <Stat value={String(progress.daysRead)} label={t('quran.daysRead')} />
      </View>

      <Text style={styles.resumeNote}>
        {t('quran.resumesAt', { page: plan.currentPage })}
      </Text>
    </Card>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function PlanForm({
  plan,
  surahs,
  onSaved,
  onCancel,
}: {
  plan: plans.ReadingPlan | null;
  surahs: quranService.SurahSummary[];
  onSaved: (plan: plans.ReadingPlan) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();

  const [startSurah, setStartSurah] = useState(String(plan?.startSurah ?? 1));
  const [startAyah, setStartAyah] = useState(String(plan?.startAyah ?? 1));
  const [endSurah, setEndSurah] = useState(plan?.endSurah ? String(plan.endSurah) : '');
  const [endAyah, setEndAyah] = useState(plan?.endAyah ? String(plan.endAyah) : '');
  const [daily, setDaily] = useState<plans.DailyTarget>(plan?.dailyPages ?? 1);
  const [reminder, setReminder] = useState(plan?.reminderEnabled ?? false);
  const [reminderTime, setReminderTime] = useState(plan?.reminderTime ?? '06:00');
  const [audio, setAudio] = useState(plan?.audioEnabled ?? false);
  const [busy, setBusy] = useState(false);

  const surahOptions = useMemo<Option[]>(
    () =>
      surahs.map((s) => ({
        value: String(s.number),
        label: `${s.number}. ${s.englishName}`,
        description: t('quran.ayahCount', { count: s.numberOfAyahs }),
      })),
    [surahs, t]
  );

  const targetOptions = useMemo<Option[]>(
    () =>
      plans.DAILY_TARGETS.map((pages) => ({
        value: String(pages),
        label:
          pages === plans.PAGES_PER_JUZ
            ? t('quran.targetJuz')
            : t('quran.targetPages', { count: pages }),
      })),
    [t]
  );

  const save = async () => {
    setBusy(true);
    try {
      const input = {
        startSurah: Number(startSurah) || 1,
        startAyah: Number(startAyah) || 1,
        endSurah: endSurah ? Number(endSurah) : null,
        endAyah: endSurah ? Number(endAyah) || 1 : null,
        dailyPages: daily,
        reminderEnabled: reminder,
        reminderTime,
        audioEnabled: audio,
      };
      const saved = plan
        ? await plans.updatePlan(
            plan,
            {
              ...input,
              ...(await recomputeRange(input)),
            },
            user?.uid
          )
        : await plans.createPlan(input, user?.uid);
      onSaved(saved);
      toast.success(t('common.success'));
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.form}>
      <Text style={styles.formTitle}>
        {plan ? t('quran.editPlan') : t('quran.createPlan')}
      </Text>
      <Text style={styles.formHint}>{t('quran.createPlanHint')}</Text>

      <Select
        label={t('quran.startSurah')}
        value={startSurah}
        options={surahOptions}
        onChange={setStartSurah}
        searchable
        required
      />
      <TextField
        label={t('quran.startAyah')}
        value={startAyah}
        onChangeText={(v) => setStartAyah(v.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        icon="bookmark-outline"
        required
      />

      <Select
        label={t('quran.endSurah')}
        value={endSurah}
        options={surahOptions}
        onChange={setEndSurah}
        placeholder={t('quran.endSurahHint')}
        searchable
        allowClear
      />
      {endSurah ? (
        <TextField
          label={t('quran.endAyah')}
          value={endAyah}
          onChangeText={(v) => setEndAyah(v.replace(/[^0-9]/g, ''))}
          keyboardType="number-pad"
          icon="bookmark-outline"
        />
      ) : null}

      <Select
        label={t('quran.dailyTarget')}
        value={String(daily)}
        options={targetOptions}
        onChange={(v) => setDaily(Number(v) as plans.DailyTarget)}
        required
      />

      <ToggleRow
        label={t('quran.dailyReminder')}
        description={
          plans.remindersSupported()
            ? t('quran.dailyReminderSet')
            : t('quran.remindersNeedApp')
        }
        value={reminder}
        onValueChange={setReminder}
        disabled={!plans.remindersSupported()}
      />
      {reminder ? (
        <TextField
          label={t('quran.reminderTime')}
          value={reminderTime}
          onChangeText={setReminderTime}
          placeholder="06:00"
          icon="alarm-outline"
        />
      ) : null}

      <ToggleRow
        label={t('quran.audioRecitation')}
        description={t('quran.audioRecitationHint')}
        value={audio}
        onValueChange={setAudio}
      />

      <View style={styles.formActions}>
        <Button
          label={plan ? t('common.save') : t('quran.startPlan')}
          icon="checkmark"
          onPress={save}
          loading={busy}
          style={{ flex: 1 }}
        />
        {onCancel ? (
          <Button
            label={t('common.cancel')}
            variant="ghost"
            onPress={onCancel}
          />
        ) : null}
      </View>
    </Card>
  );
}

/**
 * Recomputes the page boundaries when an existing plan's range is edited.
 *
 * The cursor is deliberately clamped rather than reset: someone narrowing their
 * range after a month of reading should not be sent back to the beginning.
 */
async function recomputeRange(input: {
  startSurah: number;
  startAyah: number;
  endSurah: number | null;
  endAyah: number | null;
}): Promise<{ startPage: number; endPage: number }> {
  const start = await quranService.locateAyah(input.startSurah, input.startAyah);
  const end =
    input.endSurah != null && input.endAyah != null
      ? await quranService.locateAyah(input.endSurah, input.endAyah)
      : { page: quranService.TOTAL_PAGES };
  return { startPage: start.page, endPage: Math.max(start.page, end.page) };
}

const styles = StyleSheet.create({
  form: { marginBottom: spacing.lg },
  formTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  formHint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginBottom: spacing.lg,
    lineHeight: 17,
  },
  formActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },

  progressCard: { marginBottom: spacing.lg },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressPercent: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.primary,
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  streakText: { fontSize: fontSize.xs, color: colors.text, fontWeight: fontWeight.semibold },
  bar: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  barFill: { height: '100%', backgroundColor: brand.orange, borderRadius: radius.pill },
  stats: { flexDirection: 'row', marginTop: spacing.lg },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  statLabel: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 1 },
  resumeNote: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  pager: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  pagerButton: { flexGrow: 1, flexBasis: 130 },
  todayCard: { marginBottom: spacing.lg },
  todayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  todayPages: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  todayMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  doneChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  doneText: { fontSize: fontSize.xs, color: colors.success, fontWeight: fontWeight.semibold },

  finished: { alignItems: 'center', paddingVertical: spacing.xxl },
  finishedTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: spacing.md,
    textAlign: 'center',
  },

  ayah: { marginBottom: spacing.md },
  ayahHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: brand.orange },
  arabic: {
    fontSize: 26,
    lineHeight: 52,
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  translation: {
    fontSize: fontSize.sm,
    lineHeight: 22,
    color: colors.textSecondary,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },

  settings: { marginBottom: spacing.lg },
  settingsActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },

  history: { paddingVertical: spacing.xs },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  historyDate: { flex: 1, fontSize: fontSize.sm, color: colors.text },
  historyPages: { fontSize: fontSize.xs, color: colors.textMuted },
});
