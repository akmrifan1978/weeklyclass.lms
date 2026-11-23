import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
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
  accountsCsv,
  detailsFor,
  removeEntry,
  saveEntry,
} from '@/services/eventFinanceService';
import { safeFilename, saveTextFile } from '@/utils/download';
import type { EventFinanceEntry } from '@/types';
import { ImageField } from '@/components/shared/ImageField';
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

  const load = useCallback(async () => {
    // Two calls, not three: `detailsFor` returns the entries it added up, so
    // the list below is not a second billed read of the same documents.
    const [event, details] = await Promise.all([getEvent(eventId), detailsFor(eventId)]);
    return { event, totals: details.totals, entries: details.entries };
  }, [eventId]);

  const { data, loading, error, refreshing, refresh, reload } = useAsync(load, [eventId]);

  const [editing, setEditing] = useState<EventFinanceEntry | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<EventFinanceEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    type: 'expense' as 'income' | 'expense',
    title: '',
    category: 'venue',
    amount: '',
    date: toISODate(),
    party: '',
    note: '',
    receiptUrl: '',
  });

  const openSheet = (entry: EventFinanceEntry | null) => {
    setEditing(entry);
    setForm({
      type: entry?.type ?? 'expense',
      title: entry?.title ?? '',
      category: entry?.category ?? 'venue',
      amount: entry ? String(entry.amount) : '',
      date: entry?.date ?? toISODate(),
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
          type: form.type,
          title: form.title.trim(),
          category: form.category,
          amount,
          currency: data.totals.currency,
          date: form.date || toISODate(),
          party: form.party.trim() || null,
          note: form.note.trim() || null,
          receiptUrl: form.receiptUrl || null,
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

  /** The accounts as a file: the summary, then every entry behind it. */
  const exportReport = async () => {
    if (!data?.event || !data.totals) return;
    try {
      await saveTextFile(
        safeFilename(`${data.event.title}-accounts`, 'csv'),
        accountsCsv(data.event.title, data.event.date, data.totals, data.entries)
      );
      toast.success(t('eventDash.reportDone'));
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    }
  };

  const totals = data?.totals;
  const currency = totals?.currency ?? 'SAR';
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
          {/* Bookings for this event */}
          <SectionHeader title={t('eventDash.bookingsSection')} icon="people-outline" />
          <Card>
            <View style={styles.grid}>
              <Figure label={t('eventDash.bookings')} value={String(totals?.bookings ?? 0)} />
              <Figure label={t('eventDash.people')} value={String(totals?.participants ?? 0)} />
              <Figure label={t('eventDash.seats')} value={String(totals?.seats ?? 0)} />
            </View>
          </Card>

          <Spacer />

          {/* Money for this event, with the report that files it.
              Built from what is already on screen, so pressing it costs no
              further reads. */}
          <SectionHeader
            title={t('eventDash.accounts')}
            icon="cash-outline"
            actionLabel={data?.totals ? t('eventDash.report') : undefined}
            onAction={data?.totals ? exportReport : undefined}
          />
          <Card>
            <Row label={t('eventDash.bookingIncome')} value={`${totals?.bookedReceived ?? 0} ${currency}`} />
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
        title={editing ? t('common.edit') : t('eventDash.addEntry')}
        onClose={() => setSheetOpen(false)}
        onSubmit={save}
        submitting={busy}
      >
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
        <TextField
          label={t('common.notes')}
          value={form.note}
          onChangeText={(v) => setForm((f) => ({ ...f, note: v }))}
          multiline
        />
        <ImageField
          label={t('eventDash.receipt')}
          value={form.receiptUrl}
          onChange={(url) => setForm((f) => ({ ...f, receiptUrl: url || '' }))}
        />
      </FormSheet>

      <ConfirmDialog
        visible={Boolean(confirmDelete)}
        title={t('common.delete')}
        message={t('eventDash.deleteEntry')}
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
});
