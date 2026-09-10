import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import type { Country, Organization } from '@/types';
import {
  Button,
  Card,
  ConfirmDialog,
  FormSheet,
  IconButton,
  TextField,
} from '@/components/ui';

/**
 * Countries and organisations, managed inline on the Branches screen.
 *
 * These are small reference lists — a handful of rows that change rarely — so a
 * whole admin screen each would be more navigation than the data deserves. They
 * do, however, need full add/edit/delete: they were add-only, which meant a typo
 * in a country name was permanent.
 */

interface Editable {
  id: string;
  name: string;
  code?: string;
}

function CollapsibleList<T extends Editable>({
  title,
  icon,
  items,
  emptyLabel,
  addLabel,
  onEdit,
  onDelete,
  onAdd,
  describe,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  items: T[];
  emptyLabel: string;
  addLabel: string;
  onEdit: (item: T) => void;
  onDelete: (item: T) => void;
  onAdd: () => void;
  describe?: (item: T) => string | undefined;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        style={styles.header}
      >
        <Ionicons name={icon} size={18} color={colors.primary} />
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.countChip}>
          <Text style={styles.countText}>{items.length}</Text>
        </View>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textMuted}
        />
      </Pressable>

      {open ? (
        <View style={styles.body}>
          {items.length === 0 ? (
            <Text style={styles.empty}>{emptyLabel}</Text>
          ) : (
            items.map((item) => (
              <View key={item.id} style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {describe?.(item) ? (
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {describe(item)}
                    </Text>
                  ) : null}
                </View>
                <IconButton
                  icon="create-outline"
                  label={t('common.edit')}
                  size={34}
                  color={colors.primary}
                  onPress={() => onEdit(item)}
                />
                <IconButton
                  icon="trash-outline"
                  label={t('common.delete')}
                  size={34}
                  color={colors.danger}
                  background={colors.dangerSoft}
                  onPress={() => onDelete(item)}
                />
              </View>
            ))
          )}

          <Button
            label={addLabel}
            icon="add"
            variant="outline"
            size="sm"
            onPress={onAdd}
            style={styles.addButton}
          />
        </View>
      ) : null}
    </Card>
  );
}

export function CountryList({
  countries,
  onSave,
  onDelete,
}: {
  countries: Country[];
  onSave: (data: { name: string; code: string }, id?: string) => Promise<void>;
  onDelete: (country: Country) => Promise<void>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useAuth();

  const [editing, setEditing] = useState<Country | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', code: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Country | null>(null);

  if (!can('MANAGE_BRANCHES')) return null;

  const open = (country: Country | null) => {
    setEditing(country);
    setCreating(!country);
    setForm({ name: country?.name ?? '', code: country?.code ?? '' });
    setErrors({});
  };

  const close = () => {
    setEditing(null);
    setCreating(false);
  };

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!form.name.trim()) next.name = 'validation.fieldRequired';
    if (form.code.trim().length !== 2) next.code = 'validation.countryCodeLength';
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }

    setBusy(true);
    try {
      await onSave({ name: form.name.trim(), code: form.code.trim() }, editing?.id);
      toast.success(t('common.success'));
      close();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await onDelete(confirm);
      toast.success(t('common.success'));
      setConfirm(null);
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <CollapsibleList<Country>
        title={t('auth.country')}
        icon="globe-outline"
        items={countries}
        emptyLabel={t('empty.noCountriesYet')}
        addLabel={`${t('common.add')} ${t('auth.country')}`}
        describe={(item) => item.code}
        onAdd={() => open(null)}
        onEdit={open}
        onDelete={setConfirm}
      />

      <FormSheet
        visible={creating || Boolean(editing)}
        title={editing ? t('common.edit') : `${t('common.add')} ${t('auth.country')}`}
        onClose={close}
        onSubmit={submit}
        submitting={busy}
      >
        <TextField
          label={t('auth.country')}
          value={form.name}
          onChangeText={(v) => setForm((p) => ({ ...p, name: v }))}
          error={errors.name}
          icon="globe-outline"
          required
        />
        <TextField
          label={t('admin.isoCode')}
          value={form.code}
          onChangeText={(v) =>
            setForm((p) => ({ ...p, code: v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) }))
          }
          error={errors.code}
          hint="Two letters — LK, IN, SA, GB"
          autoCapitalize="characters"
          maxLength={2}
          // The code is the document id, so changing it would orphan every
          // branch pointing at the old one.
          editable={!editing}
          required
        />
      </FormSheet>

      <ConfirmDialog
        visible={Boolean(confirm)}
        title={t('confirm.deleteTitle')}
        message={confirm?.name}
        confirmLabel={t('common.delete')}
        destructive
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={remove}
      />
    </>
  );
}

export function OrganizationList({
  organizations,
  onSave,
  onDelete,
}: {
  organizations: Organization[];
  onSave: (data: { name: string; description?: string }, id?: string) => Promise<void>;
  onDelete: (org: Organization) => Promise<void>;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useAuth();

  const [editing, setEditing] = useState<Organization | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Organization | null>(null);

  if (!can('MANAGE_BRANCHES')) return null;

  const open = (org: Organization | null) => {
    setEditing(org);
    setCreating(!org);
    setForm({ name: org?.name ?? '', description: org?.description ?? '' });
    setErrors({});
  };

  const close = () => {
    setEditing(null);
    setCreating(false);
  };

  const submit = async () => {
    if (!form.name.trim()) {
      setErrors({ name: 'validation.fieldRequired' });
      return;
    }
    setBusy(true);
    try {
      await onSave(
        { name: form.name.trim(), description: form.description.trim() },
        editing?.id
      );
      toast.success(t('common.success'));
      close();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      await onDelete(confirm);
      toast.success(t('common.success'));
      setConfirm(null);
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <CollapsibleList<Organization>
        title={t('admin.organization')}
        icon="business-outline"
        items={organizations}
        emptyLabel={t('empty.nothingHere')}
        addLabel={`${t('common.add')} ${t('admin.organization')}`}
        describe={(item) => item.description}
        onAdd={() => open(null)}
        onEdit={open}
        onDelete={setConfirm}
      />

      <FormSheet
        visible={creating || Boolean(editing)}
        title={editing ? t('common.edit') : `${t('common.add')} ${t('admin.organization')}`}
        onClose={close}
        onSubmit={submit}
        submitting={busy}
      >
        <TextField
          label={t('admin.organization')}
          value={form.name}
          onChangeText={(v) => setForm((p) => ({ ...p, name: v }))}
          error={errors.name}
          icon="business-outline"
          required
        />
        <TextField
          label={t('common.description')}
          value={form.description}
          onChangeText={(v) => setForm((p) => ({ ...p, description: v }))}
          multiline
        />
      </FormSheet>

      <ConfirmDialog
        visible={Boolean(confirm)}
        title={t('confirm.deleteTitle')}
        message={confirm?.name}
        confirmLabel={t('common.delete')}
        destructive
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={remove}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md, paddingVertical: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 36 },
  headerTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  countChip: {
    minWidth: 26,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
  },
  countText: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: fontWeight.bold },
  body: { marginTop: spacing.md, gap: spacing.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: spacing.sm,
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: fontSize.sm, color: colors.text, fontWeight: fontWeight.medium },
  rowMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 1 },
  empty: { fontSize: fontSize.sm, color: colors.textMuted, paddingVertical: spacing.sm },
  addButton: { marginTop: spacing.md, alignSelf: 'flex-start' },
});
