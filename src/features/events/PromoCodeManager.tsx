import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { formatShortDate } from '@/utils/date';
import { listPast, listUpcoming } from '@/services/calendarService';
import * as promos from '@/services/promoCodeService';
import type { CalendarEvent, PromoCode } from '@/types';
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
 * The codes that let somebody in free, and the admin who decides.
 *
 * A code is money given away, so everything here is written to make that
 * visible rather than convenient: how many times each has been used, what it
 * is tied to, and when it stops working. Nothing is generated automatically —
 * an organiser types a code they can say out loud over the phone.
 */
export function PromoCodeManager() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();

  const load = useCallback(async () => {
    const [codes, soon, gone] = await Promise.all([
      promos.listCodes(),
      listUpcoming({ pageSize: 25 }),
      listPast({ pageSize: 15 }).catch(() => ({ items: [] as CalendarEvent[] })),
    ]);
    // Only events that charge: a code admitting somebody free to a free event
    // is an option with nothing behind it.
    const events = [...soon.items, ...gone.items].filter(
      (event) => (event.registration?.price ?? 0) > 0 || event.registration?.pricesByAgeGroup
    );
    return { codes, events };
  }, []);

  const { data, loading, error, refreshing, refresh, reload } = useAsync(load, []);

  const [editing, setEditing] = useState<PromoCode | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<PromoCode | null>(null);
  const [form, setForm] = useState({
    code: '',
    eventId: '',
    maxUses: '',
    active: true,
    expiresOn: '',
    note: '',
  });

  const openSheet = (code: PromoCode | null) => {
    setEditing(code);
    setForm({
      code: code?.code ?? '',
      eventId: code?.eventId ?? '',
      maxUses: code?.maxUses != null ? String(code.maxUses) : '',
      active: code?.active ?? true,
      expiresOn: code?.expiresOn ?? '',
      note: code?.note ?? '',
    });
    setSheetOpen(true);
  };

  const save = async () => {
    if (!user) return;
    const code = promos.normaliseCode(form.code);
    if (!code) {
      toast.error(t('promo.codeRequired'));
      return;
    }
    const limit = form.maxUses.trim() ? Number(form.maxUses) : null;
    if (limit != null && (!Number.isFinite(limit) || limit < 1)) {
      toast.error(t('promo.limitInvalid'));
      return;
    }
    setBusy(true);
    try {
      const event = data?.events.find((e) => e.id === form.eventId) ?? null;
      await promos.saveCode(
        {
          code,
          eventId: form.eventId || null,
          eventTitle: event?.title ?? null,
          maxUses: limit,
          active: form.active,
          expiresOn: form.expiresOn || null,
          note: form.note.trim() || null,
        },
        user,
        editing
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

  const eventOptions: Option[] = [
    { value: '', label: t('promo.anyEvent') },
    ...(data?.events ?? []).map((event) => ({
      value: event.id,
      label: `${event.title} · ${formatShortDate(event.date)}`,
    })),
  ];

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('promo.title')} subtitle={t('promo.lead')} showBack />

      <Screen refreshing={refreshing} onRefresh={refresh} edges={['bottom']}>
        <AsyncBoundary
          loading={loading}
          error={error}
          onRetry={reload}
          skeleton={<SkeletonList count={3} />}
        >
          <SectionHeader
            title={t('promo.codes')}
            icon="pricetags-outline"
            actionLabel={t('promo.add')}
            onAction={() => openSheet(null)}
          />

          {(data?.codes ?? []).length === 0 ? (
            <Card>
              <Text style={styles.empty}>{t('promo.none')}</Text>
            </Card>
          ) : (
            <View style={{ gap: spacing.sm }}>
              {(data?.codes ?? []).map((promo) => {
                const spent = promo.usedCount ?? 0;
                const limit = promo.maxUses ?? null;
                const usedUp = limit != null && spent >= limit;
                const off = promo.active !== true;
                return (
                  <Card key={promo.id}>
                    <View style={styles.row}>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[styles.code, (off || usedUp) && styles.codeOff]}
                          selectable
                        >
                          {promo.code}
                        </Text>
                        <Text style={styles.meta} numberOfLines={1}>
                          {[
                            promo.eventTitle ?? t('promo.anyEvent'),
                            limit == null
                              ? t('promo.usedUnlimited', { count: spent })
                              : t('promo.usedOf', { count: spent, limit }),
                            promo.expiresOn
                              ? t('promo.until', { date: formatShortDate(promo.expiresOn) })
                              : null,
                          ]
                            .filter(Boolean)
                            .join('  ·  ')}
                        </Text>
                        {promo.note ? (
                          <Text style={styles.note} numberOfLines={2}>
                            {promo.note}
                          </Text>
                        ) : null}
                      </View>

                      {off || usedUp ? (
                        <View style={styles.offChip}>
                          <Ionicons
                            name={usedUp ? 'checkmark-done-outline' : 'pause-outline'}
                            size={12}
                            color={colors.textMuted}
                          />
                          <Text style={styles.offText}>
                            {t(usedUp ? 'promo.usedUpChip' : 'promo.offChip')}
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.onChip}>
                          <Ionicons name="ellipse" size={8} color={colors.success} />
                          <Text style={styles.onText}>{t('promo.onChip')}</Text>
                        </View>
                      )}

                      <IconButton
                        icon="create-outline"
                        label={t('common.edit')}
                        size={32}
                        onPress={() => openSheet(promo)}
                      />
                      <IconButton
                        icon="trash-outline"
                        label={t('common.delete')}
                        size={32}
                        color={colors.danger}
                        onPress={() => setConfirmDelete(promo)}
                      />
                    </View>
                  </Card>
                );
              })}
            </View>
          )}

          <Spacer />
          <Text style={styles.footnote}>{t('promo.howItWorks')}</Text>
          <Spacer size={spacing.xxl} />
        </AsyncBoundary>
      </Screen>

      <FormSheet
        visible={sheetOpen}
        title={editing ? t('common.edit') : t('promo.add')}
        onClose={() => setSheetOpen(false)}
        onSubmit={save}
        submitting={busy}
      >
        <TextField
          label={t('promo.code')}
          value={form.code}
          onChangeText={(v) => setForm((f) => ({ ...f, code: promos.normaliseCode(v) }))}
          icon="pricetag-outline"
          // Locked once it exists: the code IS the document, so renaming one
          // would leave the old text working under its own record.
          editable={!editing}
          hint={editing ? t('promo.codeLocked') : t('promo.codeHint')}
          autoCapitalize="characters"
          required
        />
        <Select
          label={t('promo.forEvent')}
          value={form.eventId}
          options={eventOptions}
          onChange={(v) => setForm((f) => ({ ...f, eventId: v ?? '' }))}
        />
        <TextField
          label={t('promo.maxUses')}
          value={form.maxUses}
          onChangeText={(v) => setForm((f) => ({ ...f, maxUses: v.replace(/[^0-9]/g, '') }))}
          keyboardType="numeric"
          icon="repeat-outline"
          hint={t('promo.maxUsesHint')}
        />
        <DateField
          label={t('promo.expiresOn')}
          value={form.expiresOn}
          onChange={(v: string) => setForm((f) => ({ ...f, expiresOn: v }))}
        />
        <TextField
          label={t('common.notes')}
          value={form.note}
          onChangeText={(v) => setForm((f) => ({ ...f, note: v }))}
          hint={t('promo.noteHint')}
          multiline
        />
        <ToggleRow
          label={t('promo.activeLabel')}
          description={t('promo.activeHelp')}
          value={form.active}
          onValueChange={(v) => setForm((f) => ({ ...f, active: v }))}
        />
      </FormSheet>

      <ConfirmDialog
        visible={Boolean(confirmDelete)}
        title={t('common.delete')}
        message={t('promo.deleteWarning', { code: confirmDelete?.code ?? '' })}
        confirmLabel={t('common.delete')}
        destructive
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target && user) {
            void promos
              .removeCode(target, user)
              .then(() => reload())
              .catch((err) => toast.error(friendlyMessage(err, t)));
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  code: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: 2,
  },
  codeOff: { color: colors.textMuted, textDecorationLine: 'line-through' },
  meta: { fontSize: fontSize.xs, color: colors.textSecondary, marginTop: 3 },
  note: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 3 },
  onChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft ?? colors.surfaceMuted,
  },
  onText: { fontSize: 10, color: colors.success, fontWeight: fontWeight.semibold },
  offChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
  },
  offText: { fontSize: 10, color: colors.textMuted, fontWeight: fontWeight.semibold },
  empty: { fontSize: fontSize.sm, color: colors.textMuted },
  footnote: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 18,
    paddingHorizontal: spacing.xs,
  },
});
