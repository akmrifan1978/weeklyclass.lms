import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { formatShortDate, toISODate } from '@/utils/date';
import { getEvent, setStatementVisible } from '@/services/calendarService';
import {
  FINANCE_CATEGORIES,
  budgetReportCsv,
  detailsFor,
  incomeExpenseCsv,
  removeEntry,
  saveEntry,
} from '@/services/eventFinanceService';
import { safeFilename, saveTextFile } from '@/utils/download';
import type { EventFinanceEntry } from '@/types';
import { ImageField } from '@/components/shared/ImageField';
import { CrashBoundary } from '@/components/shared/CrashBoundary';
import { BookingsSheet } from './BookingsSheet';
import {
  AppHeader,
  AsyncBoundary,
  Card,
  ConfirmDialog,
  DateField,
  FormSheet,
  IconButton,
  Screen,
  SectionHeader,
  Select,
  SkeletonList,
  Spacer,
  TextField,
  ToggleRow,
  type Option,
} from '@/components/ui';

/**
 * One event: what it took, what it cost, and what is left.
 *
 * THIS EVENT ONLY. Every figure on this screen comes from this event's
 * bookings and this event's entries; nothing is added across events, and
 * there is no way from here to a combined total. See eventFinanceService.
 *
 * WHO SEES WHAT. Reading needs VIEW_EVENT_DASHBOARD — an assistant may study
 * the figures. Writing needs MANAGE_EVENT_FINANCE, so the same assistant
 * cannot change one. The security rules enforce both; the buttons below merely
 * agree with them.
 */
export function EventAccounts({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const toast = useToast();
  const mayWrite = can('MANAGE_EVENT_FINANCE');
  /** The statement lives on the event, so changing it is editing the event. */
  const mayDecide = can('MANAGE_CALENDAR');
  /**
   * Approving, declining and taking payment are organiser's work.
   *
   * Gated on the same permission the security rules check, so an assistant who
   * may read the accounts is not shown an Approve button that the database
   * would refuse — a control that appears to work and does nothing is worse
   * than no control.
   */
  const mayManageBookings = can('MANAGE_CALENDAR');
  const [managing, setManaging] = useState(false);

  const load = useCallback(async () => {
    // Two calls, not three: `detailsFor` returns the entries it added up, so
    // the list below is not a second billed read of the same documents.
    const [event, details] = await Promise.all([getEvent(eventId), detailsFor(eventId)]);
    return {
      event,
      totals: details.totals,
      entries: details.entries,
      budget: details.budget,
    };
  }, [eventId]);

  const { data, loading, error, refreshing, refresh, reload } = useAsync(load, [eventId]);

  const [editing, setEditing] = useState<EventFinanceEntry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<EventFinanceEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    /*
     * Which of the two lists this sheet is writing to.
     *
     * One form serves both, because a budget line and a real entry ask almost
     * the same questions - a category and an amount, in or out. The three
     * questions that only make sense for money already moved (the day, who it
     * went to, the receipt) are hidden while planning, and the flag travels to
     * the document so nothing has to guess afterwards.
     */
    planned: false,
    type: 'expense' as 'income' | 'expense',
    title: '',
    category: 'venue',
    amount: '',
    date: toISODate(),
    party: '',
    note: '',
    receiptUrl: '',
  });

  const openSheet = (entry: EventFinanceEntry | null, planned = false) => {
    setEditing(entry);
    setForm({
      planned: entry ? entry.planned === true : planned,
      type: entry?.type ?? 'expense',
      title: entry?.title ?? '',
      category: entry?.category ?? 'venue',
      amount: entry ? String(entry.amount) : '',
      // A budget line is dated to the event, not to today: it is not a thing
      // that happened on the afternoon somebody wrote it down.
      date: entry?.date ?? (planned ? (data?.event?.date ?? toISODate()) : toISODate()),
      party: entry?.party ?? '',
      note: entry?.note ?? '',
      receiptUrl: entry?.receiptUrl ?? '',
    });
    setSheetOpen(true);
  };

  const save = async () => {
    if (!user || !data?.event) return;
    if (!form.title.trim()) {
      toast.error(t('validation.titleRequired'));
      return;
    }
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(t('eventDash.amountRequired'));
      return;
    }
    setBusy(true);
    try {
      await saveEntry(
        {
          id: editing?.id,
          eventId,
          eventTitle: data.event.title,
          planned: form.planned,
          type: form.type,
          title: form.title.trim(),
          category: form.category,
          amount,
          currency: data.totals.currency,
          date: form.date || toISODate(),
          // A plan has nobody to pay yet and no receipt to show, so these are
          // cleared rather than carried over from whatever the form last held.
          party: form.planned ? null : form.party.trim() || null,
          note: form.note.trim() || null,
          receiptUrl: form.planned ? null : form.receiptUrl || null,
        },
        user
      );
      toast.success(t('common.success'));
      setSheetOpen(false);
      setEditing(null);
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  /** The statement switch, per event, off until an admin turns it on. */
  const setStatement = async (visible: boolean) => {
    if (!user || !data?.event) return;
    try {
      await setStatementVisible(data.event, visible, user);
      toast.success(t(visible ? 'eventDash.statementOn' : 'eventDash.statementOff'));
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    }
  };

  /**
   * The two reports, as files.
   *
   * Both are built from what is already on screen, so neither costs a further
   * read. Two rather than one because they answer different questions: did we
   * keep to the plan, and where did the money go.
   */
  const exportReport = async (kind: 'budget' | 'income') => {
    if (!data?.event || !data.totals) return;
    try {
      const { title, date } = data.event;
      await saveTextFile(
        safeFilename(`${title}-${kind === 'budget' ? 'budget-vs-actual' : 'income-expenses'}`, 'csv'),
        kind === 'budget'
          ? budgetReportCsv(title, date, data.totals, data.entries, data.budget)
          : incomeExpenseCsv(title, date, data.totals, data.entries)
      );
      toast.success(t('eventDash.reportDone'));
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    }
  };

  const totals = data?.totals;
  const currency = totals?.currency ?? 'SAR';
  /** Everything that actually came in — attendees' payments and donations. */
  const actualIncome = (totals?.bookedReceived ?? 0) + (totals?.otherIncome ?? 0);
  const outstanding = totals ? totals.bookedDue - totals.bookedReceived : 0;

  const categoryOptions: Option[] = FINANCE_CATEGORIES.map((c) => ({
    value: c,
    label: t(`eventDash.category_${c}`),
  }));

  return (
    <View style={{ flex: 1 }}>
      <AppHeader
        title={data?.event?.title ?? t('eventDash.title')}
        subtitle={data?.event ? formatShortDate(data.event.date) : undefined}
        showBack
      />

      <Screen refreshing={refreshing} onRefresh={refresh} edges={['bottom']}>
        <AsyncBoundary
          loading={loading}
          error={error}
          onRetry={reload}
          skeleton={<SkeletonList count={4} />}
        >
          {/* Bookings for this event.
              The figures alone were a dead end: an organiser who opens an
              event from the dashboard, sees "Bookings 1", and wants to
              approve that one booking had nowhere to go from here — the list
              and its actions lived only on the Events screen, which is a
              different route reached a different way. The count now opens the
              list it is counting. */}
          <SectionHeader
            title={t('eventDash.bookingsSection')}
            icon="people-outline"
            actionLabel={mayManageBookings && data?.event ? t('event.bookings') : undefined}
            onAction={mayManageBookings && data?.event ? () => setManaging(true) : undefined}
          />
          <Card>
            <View style={styles.grid}>
              <Figure label={t('eventDash.bookings')} value={String(totals?.bookings ?? 0)} />
              <Figure label={t('eventDash.people')} value={String(totals?.participants ?? 0)} />
              <Figure label={t('eventDash.seats')} value={String(totals?.seats ?? 0)} />
            </View>
            {mayManageBookings ? (
              <Text style={styles.netNote}>{t('eventDash.manageBookingsHint')}</Text>
            ) : null}
          </Card>

          <Spacer />

          {/* The budget: what this event was MEANT to take and cost, set
              before it happens, against what it actually did. Planned figures
              are kept out of every real total — see summarise(). */}
          <SectionHeader
            title={t('eventDash.budget')}
            icon="clipboard-outline"
            actionLabel={mayWrite ? t('eventDash.addBudget') : undefined}
            onAction={mayWrite ? () => openSheet(null, true) : undefined}
          />
          <Card>
            <View style={styles.compareHead}>
              <Text style={[styles.compareCell, styles.compareLabel]} />
              <Text style={styles.compareCell}>{t('eventDash.planned')}</Text>
              <Text style={styles.compareCell}>{t('eventDash.actual')}</Text>
              <Text style={styles.compareCell}>{t('eventDash.difference')}</Text>
            </View>
            <Compare
              label={t('eventDash.income')}
              planned={totals?.plannedIncome ?? 0}
              actual={actualIncome}
              currency={currency}
              // More income than planned is good news, so the sign is read
              // actual-less-planned here and the other way round for costs.
              good={actualIncome - (totals?.plannedIncome ?? 0) >= 0}
              difference={actualIncome - (totals?.plannedIncome ?? 0)}
            />
            <Compare
              label={t('eventDash.expenses')}
              planned={totals?.plannedExpenses ?? 0}
              actual={totals?.expenses ?? 0}
              currency={currency}
              good={(totals?.plannedExpenses ?? 0) - (totals?.expenses ?? 0) >= 0}
              difference={(totals?.plannedExpenses ?? 0) - (totals?.expenses ?? 0)}
            />
            <Text style={styles.netNote}>
              {(data?.budget ?? []).length === 0
                ? t('eventDash.noBudget')
                : t('eventDash.budgetNote')}
            </Text>
          </Card>

          {(data?.budget ?? []).length > 0 ? (
            <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
              {(data?.budget ?? []).map((line) => (
                <Card key={line.id}>
                  <View style={styles.entryRow}>
                    <Ionicons
                      name={line.type === 'income' ? 'trending-up-outline' : 'trending-down-outline'}
                      size={20}
                      color={colors.textSecondary}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.entryTitle} numberOfLines={1}>
                        {line.title}
                      </Text>
                      <Text style={styles.entryMeta} numberOfLines={1}>
                        {[t(`eventDash.category_${line.category}`), t('eventDash.planned')]
                          .filter(Boolean)
                          .join('  ·  ')}
                      </Text>
                    </View>
                    <Text style={styles.entryAmount}>
                      {line.amount} {line.currency}
                    </Text>
                    {mayWrite ? (
                      <>
                        <IconButton
                          icon="create-outline"
                          label={t('common.edit')}
                          size={32}
                          onPress={() => openSheet(line)}
                        />
                        <IconButton
                          icon="trash-outline"
                          label={t('common.delete')}
                          size={32}
                          color={colors.danger}
                          onPress={() => setConfirmDelete(line)}
                        />
                      </>
                    ) : null}
                  </View>
                </Card>
              ))}
            </View>
          ) : null}

          <Spacer />

          {/* Money for this event, with the report that files it.
              Built from what is already on screen, so pressing it costs no
              further reads. */}
          <SectionHeader title={t('eventDash.accounts')} icon="cash-outline" />
          <Card>
            <Row label={t('eventDash.bookingIncome')} value={`${totals?.bookedReceived ?? 0} ${currency}`} />
            {/* Only when money has actually gone back out. A permanent
                "Refunded 0" line invites the question it answers. */}
            {(totals?.refunds ?? 0) > 0 ? (
              <Row
                label={t('eventDash.refunded')}
                value={`− ${totals?.refunds ?? 0} ${currency}`}
                tone={colors.warning}
              />
            ) : null}
            <Row
              label={t('eventDash.outstanding')}
              value={`${outstanding} ${currency}`}
              tone={outstanding > 0 ? colors.warning : undefined}
            />
            <Row label={t('eventDash.otherIncome')} value={`${totals?.otherIncome ?? 0} ${currency}`} />
            <Row label={t('eventDash.expenses')} value={`${totals?.expenses ?? 0} ${currency}`} />
            <View style={styles.netRow}>
              <Text style={styles.netLabel}>{t('eventDash.net')}</Text>
              <Text style={styles.netValue}>{`${totals?.net ?? 0} ${currency}`}</Text>
            </View>
            <Text style={styles.netNote}>{t('eventDash.netNote')}</Text>
          </Card>

          <Spacer />

          {/* What it comes to per head — the figure that sets a price.
              Based on people, not bookings: a family of five is five people
              eating, and pricing off four bookings would underprice it. */}
          <SectionHeader title={t('eventDash.perPerson')} icon="person-outline" />
          <Card>
            <Row
              label={t('eventDash.peopleCounted')}
              value={String(totals?.participants ?? 0)}
            />
            <Row
              label={t('eventDash.costPerPerson')}
              value={`${totals?.costPerPerson ?? 0} ${currency}`}
            />
            <Row
              label={t('eventDash.breakEvenPerPerson')}
              value={`${totals?.breakEvenPerPerson ?? 0} ${currency}`}
            />
            {(totals?.plannedCostPerPerson ?? 0) > 0 ? (
              <Row
                label={t('eventDash.plannedCostPerPerson')}
                value={`${totals?.plannedCostPerPerson ?? 0} ${currency}`}
              />
            ) : null}
            <Text style={styles.netNote}>
              {(totals?.participants ?? 0) === 0
                ? t('eventDash.perPersonNobody')
                : t('eventDash.perPersonNote')}
            </Text>
          </Card>

          <Spacer />

          {/* The two reports. */}
          <SectionHeader title={t('eventDash.reports')} icon="document-attach-outline" />
          <Card>
            <Pressable
              onPress={() => exportReport('budget')}
              accessibilityRole="button"
              accessibilityLabel={t('eventDash.reportBudget')}
              style={({ pressed }) => [styles.reportRow, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Ionicons name="clipboard-outline" size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.reportTitle}>{t('eventDash.reportBudget')}</Text>
                <Text style={styles.reportHint}>{t('eventDash.reportBudgetHint')}</Text>
              </View>
              <Ionicons name="download-outline" size={18} color={colors.textMuted} />
            </Pressable>
            <Pressable
              onPress={() => exportReport('income')}
              accessibilityRole="button"
              accessibilityLabel={t('eventDash.reportIncome')}
              style={({ pressed }) => [styles.reportRow, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Ionicons name="cash-outline" size={18} color={colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.reportTitle}>{t('eventDash.reportIncome')}</Text>
                <Text style={styles.reportHint}>{t('eventDash.reportIncomeHint')}</Text>
              </View>
              <Ionicons name="download-outline" size={18} color={colors.textMuted} />
            </Pressable>
          </Card>

          <Spacer />

          {/* Entries */}
          <SectionHeader
            title={t('eventDash.entries')}
            icon="receipt-outline"
            actionLabel={mayWrite ? t('eventDash.addEntry') : undefined}
            onAction={mayWrite ? () => openSheet(null) : undefined}
          />

          {(data?.entries ?? []).length === 0 ? (
            <Card>
              <Text style={styles.empty}>{t('eventDash.noEntries')}</Text>
            </Card>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {(data?.entries ?? []).map((entry) => (
                <Card key={entry.id}>
                  <View style={styles.entryRow}>
                    <Ionicons
                      name={entry.type === 'income' ? 'arrow-down-circle' : 'arrow-up-circle'}
                      size={20}
                      color={entry.type === 'income' ? colors.success : colors.warning}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.entryTitle} numberOfLines={1}>
                        {entry.title}
                      </Text>
                      <Text style={styles.entryMeta} numberOfLines={1}>
                        {[
                          t(`eventDash.category_${entry.category}`),
                          formatShortDate(entry.date),
                          entry.party,
                        ]
                          .filter(Boolean)
                          .join('  ·  ')}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.entryAmount,
                        { color: entry.type === 'income' ? colors.success : colors.text },
                      ]}
                    >
                      {entry.type === 'income' ? '+' : '−'}
                      {entry.amount} {entry.currency}
                    </Text>
                    {mayWrite ? (
                      <>
                        <IconButton
                          icon="create-outline"
                          label={t('common.edit')}
                          size={32}
                          onPress={() => openSheet(entry)}
                        />
                        <IconButton
                          icon="trash-outline"
                          label={t('common.delete')}
                          size={32}
                          color={colors.danger}
                          onPress={() => setConfirmDelete(entry)}
                        />
                      </>
                    ) : null}
                  </View>
                </Card>
              ))}
            </View>
          )}

          <Spacer />

          {/* The statement switch.
              Only for an event that takes bookings — there is no payment to
              make a statement of otherwise — and only for whoever may edit the
              event itself, because that is where the flag is stored and the
              security rules will accept the write from nobody else. A
              treasurer who records expenses does not thereby decide what
              attendees are shown. */}
          {data?.event?.registration ? (
            <>
              <SectionHeader title={t('eventDash.statement')} icon="document-text-outline" />
              <Card>
                <ToggleRow
                  label={t('eventDash.statementToggle')}
                  description={t('eventDash.statementHelp')}
                  value={data.event.registration.statementVisible === true}
                  onValueChange={setStatement}
                  disabled={!mayDecide}
                />
              </Card>
            </>
          ) : null}

          <Spacer size={spacing.xxl} />
        </AsyncBoundary>
      </Screen>

      <FormSheet
        visible={sheetOpen}
        title={
          editing
            ? t('common.edit')
            : form.planned
              ? t('eventDash.addBudget')
              : t('eventDash.addEntry')
        }
        onClose={() => setSheetOpen(false)}
        onSubmit={save}
        submitting={busy}
      >
        {/* Says which list is being written to, so an edit opened from the
            wrong place is obvious before it is saved. */}
        <Text style={styles.sheetKind}>
          {t(form.planned ? 'eventDash.budgetKind' : 'eventDash.actualKind')}
        </Text>
        <Select<'income' | 'expense'>
          label={t('eventDash.entryType')}
          value={form.type}
          options={[
            { value: 'expense', label: t('eventDash.expense') },
            { value: 'income', label: t('eventDash.income') },
          ]}
          onChange={(v) => setForm((f) => ({ ...f, type: v ?? 'expense' }))}
        />
        <TextField
          label={t('common.title')}
          value={form.title}
          onChangeText={(v) => setForm((f) => ({ ...f, title: v }))}
          icon="pricetag-outline"
          required
        />
        <Select
          label={t('eventDash.category')}
          value={form.category}
          options={categoryOptions}
          onChange={(v) => setForm((f) => ({ ...f, category: v ?? 'other' }))}
        />
        <TextField
          label={`${t('eventDash.amount')} (${currency})`}
          value={form.amount}
          onChangeText={(v) => setForm((f) => ({ ...f, amount: v.replace(/[^0-9.]/g, '') }))}
          keyboardType="numeric"
          icon="cash-outline"
          required
        />
        {/* A plan has no day and nobody to pay yet. Asking for either would
            invite a date that means nothing and a name that is a guess. */}
        {!form.planned ? (
          <>
            <DateField
              label={t('common.date')}
              value={form.date}
              onChange={(v: string) => setForm((f) => ({ ...f, date: v }))}
            />
            <TextField
              label={t('eventDash.party')}
              value={form.party}
              onChangeText={(v) => setForm((f) => ({ ...f, party: v }))}
              icon="person-outline"
              hint={t('eventDash.partyHint')}
            />
          </>
        ) : null}
        <TextField
          label={t('common.notes')}
          value={form.note}
          onChangeText={(v) => setForm((f) => ({ ...f, note: v }))}
          multiline
        />
        {/* Nothing to photograph until money has actually changed hands. */}
        {!form.planned ? (
          <ImageField
            label={t('eventDash.receipt')}
            value={form.receiptUrl}
            onChange={(url) => setForm((f) => ({ ...f, receiptUrl: url || '' }))}
          />
        ) : null}
      </FormSheet>

      {/* The same bookings sheet the Events screen opens — the one place
          approvals, payments and refunds are handled, rather than a second
          copy of it that would drift out of step. */}
      <CrashBoundary where="bookings list (from the accounts screen)">
        <BookingsSheet
          event={data?.event ?? null}
          visible={managing}
          onClose={() => setManaging(false)}
          onChanged={() => void reload()}
        />
      </CrashBoundary>

      <ConfirmDialog
        visible={Boolean(confirmDelete)}
        title={t('common.delete')}
        message={t(
          confirmDelete?.planned === true ? 'eventDash.deleteBudget' : 'eventDash.deleteEntry'
        )}
        confirmLabel={t('common.delete')}
        destructive
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target && user) {
            void removeEntry(target, user)
              .then(() => reload())
              .catch((err) => toast.error(friendlyMessage(err, t)));
          }
        }}
      />
    </View>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={styles.figureValue}>{value}</Text>
    </View>
  );
}

/**
 * One line of the budget: planned, actual, and the gap between them.
 *
 * The gap is coloured rather than signed only, because "-1,200" tells a reader
 * nothing until they work out which direction is bad. Under budget and over
 * target are both green; the opposite of each is amber.
 */
function Compare({
  label,
  planned,
  actual,
  difference,
  currency,
  good,
}: {
  label: string;
  planned: number;
  actual: number;
  difference: number;
  currency: string;
  good: boolean;
}) {
  return (
    <View style={styles.compareRow}>
      <Text style={[styles.compareCell, styles.compareLabel]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.compareCell}>{planned}</Text>
      <Text style={styles.compareCell}>{actual}</Text>
      <Text
        style={[styles.compareCell, { color: good ? colors.success : colors.warning }]}
        numberOfLines={1}
      >
        {difference > 0 ? '+' : ''}
        {difference} {currency}
      </Text>
    </View>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  figure: {
    flexGrow: 1,
    minWidth: 96,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  figureLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  figureValue: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  rowLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  compareHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  compareRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  compareCell: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'right',
  },
  compareLabel: { flex: 1.2, textAlign: 'left', color: colors.textSecondary },
  rowValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  netRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  netLabel: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  netValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  netNote: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 17 },
  entryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  entryTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  entryMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  entryAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  empty: { fontSize: fontSize.sm, color: colors.textMuted },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 48,
  },
  reportTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  reportHint: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2, lineHeight: 16 },
  sheetKind: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    lineHeight: 17,
  },
});
