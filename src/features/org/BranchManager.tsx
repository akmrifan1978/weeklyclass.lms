import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { colors, fontSize, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { matchesSearch } from '@/utils/format';
import {
  createCountry,
  createOrganization,
  deleteBranch,
  listBranches,
  listCountries,
  listOrganizations,
  saveBranch,
} from '@/services/orgService';
import type { Branch } from '@/types';
import type { Cursor } from '@/services/firestore';
import { CrudScreen } from '@/features/CrudScreen';
import { AdminRow } from '@/features/AdminRow';
import {
  Button,
  Card,
  FormSheet,
  Select,
  TextField,
  type Option,
} from '@/components/ui';

interface BranchForm {
  name: string;
  organizationId: string;
  countryCode: string;
  city: string;
  address: string;
  contactEmail: string;
  contactPhone: string;
  timezone: string;
  status: 'active' | 'inactive';
}

const EMPTY: BranchForm = {
  name: '',
  organizationId: '',
  countryCode: '',
  city: '',
  address: '',
  contactEmail: '',
  contactPhone: '',
  timezone: '',
  status: 'active',
};

/**
 * Branches, plus the countries and organisations they hang off.
 *
 * Nothing about geography is hard-coded — an admin adds a country before adding
 * the first branch in it, which is what lets the platform run anywhere.
 */
export function BranchManager() {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const toast = useToast();

  const [addingCountry, setAddingCountry] = useState(false);
  const [addingOrg, setAddingOrg] = useState(false);
  const [newCountry, setNewCountry] = useState({ name: '', code: '' });
  const [newOrg, setNewOrg] = useState({ name: '' });
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);

  const loadOrg = useCallback(async () => {
    const [countries, organizations] = await Promise.all([
      listCountries().catch(() => []),
      listOrganizations().catch(() => []),
    ]);
    return { countries, organizations };
  }, []);

  const { data: org, reload: reloadOrg } = useAsync(loadOrg, [version]);

  const countryOptions = useMemo<Option[]>(
    () => (org?.countries ?? []).map((c) => ({ value: c.code, label: c.name, description: c.code })),
    [org?.countries]
  );
  const orgOptions = useMemo<Option[]>(
    () => (org?.organizations ?? []).map((o) => ({ value: o.id, label: o.name })),
    [org?.organizations]
  );
  const countryName = useCallback(
    (code: string) => (org?.countries ?? []).find((c) => c.code === code)?.name ?? code,
    [org?.countries]
  );

  const fetchPage = useCallback(async (_cursor: Cursor, search: string) => {
    const items = await listBranches();
    const filtered = search
      ? items.filter((b) => matchesSearch(search, b.name, b.city, b.countryCode))
      : items;
    return { items: filtered, cursor: null, hasMore: false };
  }, []);

  const handleAddCountry = async () => {
    if (!user || !newCountry.name.trim() || newCountry.code.trim().length !== 2) {
      toast.error(t('validation.fieldRequired'));
      return;
    }
    setBusy(true);
    try {
      await createCountry({ name: newCountry.name.trim(), code: newCountry.code.trim() }, user);
      toast.success(t('common.success'));
      setNewCountry({ name: '', code: '' });
      setAddingCountry(false);
      setVersion((v) => v + 1);
      await reloadOrg();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  const handleAddOrg = async () => {
    if (!user || !newOrg.name.trim()) {
      toast.error(t('validation.fieldRequired'));
      return;
    }
    setBusy(true);
    try {
      await createOrganization({ name: newOrg.name.trim() }, user);
      toast.success(t('common.success'));
      setNewOrg({ name: '' });
      setAddingOrg(false);
      setVersion((v) => v + 1);
      await reloadOrg();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <CrudScreen<Branch, BranchForm>
        title={t('nav.branches')}
        addLabel={t('admin.createBranch')}
        emptyIcon="business-outline"
        emptyTitle={t('empty.nothingHere')}
        canCreate={can('MANAGE_BRANCHES')}
        canDelete={can('MANAGE_BRANCHES')}
        deps={[version]}
        fetchPage={fetchPage}
        header={
          <Card style={{ marginBottom: spacing.lg }}>
            <Text style={styles.helper}>
              {t('admin.organization')} · {t('auth.country')}
            </Text>
            <View style={styles.helperRow}>
              <Button
                label={`${t('common.add')} ${t('auth.country')}`}
                icon="globe-outline"
                variant="outline"
                size="sm"
                onPress={() => setAddingCountry(true)}
                style={{ flex: 1 }}
              />
              <Button
                label={`${t('common.add')} ${t('admin.organization')}`}
                icon="business-outline"
                variant="outline"
                size="sm"
                onPress={() => setAddingOrg(true)}
                style={{ flex: 1 }}
              />
            </View>
            <Text style={styles.counts}>
              {(org?.countries ?? []).length} {t('auth.country')} ·{' '}
              {(org?.organizations ?? []).length} {t('admin.organization')}
            </Text>
          </Card>
        }
        emptyForm={EMPTY}
        toForm={(branch) => ({
          name: branch.name,
          organizationId: branch.organizationId,
          countryCode: branch.countryCode,
          city: branch.city ?? '',
          address: branch.address ?? '',
          contactEmail: branch.contactEmail ?? '',
          contactPhone: branch.contactPhone ?? '',
          timezone: branch.timezone ?? '',
          status: branch.status,
        })}
        validate={(form) => {
          const errors: Record<string, string> = {};
          if (!form.name.trim()) errors.name = 'validation.fieldRequired';
          if (!form.countryCode) errors.countryCode = 'validation.countryRequired';
          if (!form.organizationId) errors.organizationId = 'validation.fieldRequired';
          return Object.keys(errors).length ? errors : null;
        }}
        onSave={async (form, existing) => {
          if (!user) throw new Error('unauthenticated');
          return saveBranch(
            {
              name: form.name.trim(),
              organizationId: form.organizationId,
              countryCode: form.countryCode,
              city: form.city.trim(),
              address: form.address.trim(),
              contactEmail: form.contactEmail.trim(),
              contactPhone: form.contactPhone.trim(),
              timezone: form.timezone.trim(),
              status: form.status,
            },
            user,
            existing?.id
          );
        }}
        onDelete={async (branch) => {
          if (!user) return;
          await deleteBranch(branch.id, user);
        }}
        renderItem={(branch, actions) => (
          <AdminRow
            icon="business-outline"
            title={branch.name}
            subtitle={[branch.city, countryName(branch.countryCode)].filter(Boolean).join(', ')}
            meta={branch.contactEmail || branch.contactPhone || undefined}
            badges={[{ label: t(`common.${branch.status}`), tone: branch.status }]}
            onEdit={can('MANAGE_BRANCHES') ? actions.edit : undefined}
            onDelete={can('MANAGE_BRANCHES') ? actions.remove : undefined}
          />
        )}
        renderForm={(form, set, errors) => (
          <>
            <TextField
              label={t('auth.branch')}
              value={form.name}
              onChangeText={(v) => set('name', v)}
              error={errors.name}
              icon="business-outline"
              required
            />
            <Select
              label={t('admin.organization')}
              value={form.organizationId}
              options={orgOptions}
              onChange={(v) => set('organizationId', v)}
              error={errors.organizationId}
              required
            />
            <Select
              label={t('auth.country')}
              value={form.countryCode}
              options={countryOptions}
              onChange={(v) => set('countryCode', v)}
              error={errors.countryCode}
              searchable
              required
            />
            <TextField
              label={t('admin.city')}
              value={form.city}
              onChangeText={(v) => set('city', v)}
              icon="location-outline"
            />
            <TextField
              label={t('admin.address')}
              value={form.address}
              onChangeText={(v) => set('address', v)}
              multiline
            />
            <TextField
              label={t('settings.supportEmail')}
              value={form.contactEmail}
              onChangeText={(v) => set('contactEmail', v)}
              icon="mail-outline"
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <TextField
              label={t('settings.contactPhone')}
              value={form.contactPhone}
              onChangeText={(v) => set('contactPhone', v)}
              icon="call-outline"
              keyboardType="phone-pad"
            />
            <TextField
              label={t('admin.timezone')}
              value={form.timezone}
              onChangeText={(v) => set('timezone', v)}
              hint="e.g. Asia/Riyadh, Asia/Colombo, Europe/London"
              icon="time-outline"
              autoCapitalize="none"
            />
            <Select<'active' | 'inactive'>
              label={t('common.status')}
              value={form.status}
              options={[
                { value: 'active', label: t('common.active') },
                { value: 'inactive', label: t('common.inactive') },
              ]}
              onChange={(v) => set('status', v)}
            />
          </>
        )}
      />

      <FormSheet
        visible={addingCountry}
        title={`${t('common.add')} ${t('auth.country')}`}
        onClose={() => setAddingCountry(false)}
        onSubmit={handleAddCountry}
        submitting={busy}
      >
        <TextField
          label={t('auth.country')}
          value={newCountry.name}
          onChangeText={(v) => setNewCountry((p) => ({ ...p, name: v }))}
          icon="globe-outline"
          required
        />
        <TextField
          label="ISO code"
          value={newCountry.code}
          onChangeText={(v) => setNewCountry((p) => ({ ...p, code: v.toUpperCase().slice(0, 2) }))}
          hint="Two letters — SA, LK, IN, GB"
          autoCapitalize="characters"
          maxLength={2}
          required
        />
      </FormSheet>

      <FormSheet
        visible={addingOrg}
        title={`${t('common.add')} ${t('admin.organization')}`}
        onClose={() => setAddingOrg(false)}
        onSubmit={handleAddOrg}
        submitting={busy}
      >
        <TextField
          label={t('admin.organization')}
          value={newOrg.name}
          onChangeText={(v) => setNewOrg({ name: v })}
          icon="business-outline"
          required
        />
      </FormSheet>
    </>
  );
}

const styles = StyleSheet.create({
  helper: { fontSize: fontSize.sm, color: colors.textSecondary, marginBottom: spacing.md },
  helperRow: { flexDirection: 'row', gap: spacing.md },
  counts: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.md },
});
