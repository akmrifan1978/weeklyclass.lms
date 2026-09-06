import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { friendlyMessage } from '@/utils/errors';
import {
  deleteLanguage,
  ensureLanguages,
  hasInterfaceTranslations,
  listLanguages,
  saveLanguage,
  setEnabled,
} from '@/services/languageService';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import type { AppLanguage } from '@/types';
import {
  AsyncBoundary,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Divider,
  FormSheet,
  IconButton,
  Screen,
  SkeletonList,
  Spacer,
  TextField,
  ToggleRow,
} from '@/components/ui';

/**
 * Language registry — add, edit, enable, disable and remove.
 *
 * Which languages the app OFFERS is data, so this needs no release. What ships
 * with the app is the interface translations themselves, so a language added
 * here without a matching `src/i18n/locales/<code>.json` shows an English
 * interface. That is stated on the row rather than left to be discovered, and a
 * new language starts disabled so nobody offers an untranslated interface to a
 * whole school by accident.
 *
 * Scripture is unaffected either way: a language with no approved translation
 * shows the Arabic alone, which is handled in ScriptureText.
 */
function LanguagesScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => listLanguages(false), []);
  const { data, loading, error, reload, refreshing, refresh } = useAsync(load, []);

  const handleToggle = async (code: string, enabled: boolean) => {
    if (!user) return;
    try {
      await setEnabled(code, enabled, user);
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    }
  };

  const [editing, setEditing] = useState<AppLanguage | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AppLanguage | null>(null);
  const [form, setForm] = useState({ code: '', name: '', nativeName: '', rtl: false, order: 0 });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const openForm = (language: AppLanguage | null) => {
    setEditing(language);
    setCreating(!language);
    setErrors({});
    setForm({
      code: language?.code ?? '',
      name: language?.name ?? '',
      nativeName: language?.nativeName ?? '',
      rtl: language?.rtl ?? false,
      order: language?.order ?? (data?.length ?? 0),
    });
  };

  const closeForm = () => {
    setEditing(null);
    setCreating(false);
  };

  const handleSave = async () => {
    const next: Record<string, string> = {};
    if (!/^[a-z]{2,3}$/i.test(form.code.trim())) next.code = 'language.codeFormat';
    if (!form.name.trim()) next.name = 'validation.fieldRequired';
    if (!form.nativeName.trim()) next.nativeName = 'validation.fieldRequired';
    if (Object.keys(next).length) {
      setErrors(next);
      return;
    }
    if (!user) return;

    setBusy(true);
    try {
      await saveLanguage(form, user, creating);
      toast.success(t('common.success'));
      closeForm();
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete || !user) return;
    setBusy(true);
    try {
      await deleteLanguage(confirmDelete, user);
      toast.success(t('common.success'));
      setConfirmDelete(null);
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const handleSeed = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await ensureLanguages(user);
      toast.success(t('common.success'));
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} edges={['bottom']}>
      <Text style={styles.title} accessibilityRole="header">
        {t('settings.localisation')}
      </Text>
      <Text style={styles.subtitle}>{t('settings.availableLanguages')}</Text>

      <Spacer />

      <AsyncBoundary
        loading={loading}
        error={error}
        onRetry={reload}
        skeleton={<SkeletonList count={4} />}
      >
        <Card>
          {(data ?? []).map((language, index) => (
            <View key={language.id}>
              {index > 0 ? <Divider /> : null}
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <View style={styles.nameRow}>
                    <Text style={styles.native}>{language.nativeName}</Text>
                    {language.rtl ? <Badge label="RTL" tone="pending" /> : null}
                  </View>
                  <Text style={styles.meta}>
                    {language.name} · {language.code}
                  </Text>
                </View>
                <ToggleRow
                  label=""
                  value={language.enabled}
                  onValueChange={(value) => handleToggle(language.code, value)}
                />
                <IconButton
                  icon="create-outline"
                  label={t('common.edit')}
                  size={32}
                  color={colors.primary}
                  onPress={() => openForm(language)}
                />
                <IconButton
                  icon="trash-outline"
                  label={t('common.delete')}
                  size={32}
                  color={colors.danger}
                  onPress={() => setConfirmDelete(language)}
                />
              </View>

              {/* Said on the row itself. An admin enabling a language needs to
                  know the interface will read in English until someone adds the
                  locale file — discovering that from a student is worse. */}
              {hasInterfaceTranslations(language.code) ? null : (
                <Text style={styles.missingTranslations}>
                  {t('language.noInterfaceTranslations')}
                </Text>
              )}
            </View>
          ))}
        </Card>

        <Spacer />

        <Button
          label={t('language.add')}
          icon="add"
          fullWidth
          onPress={() => openForm(null)}
        />

        <Spacer />

        <Button
          label={t('common.refresh')}
          icon="sync-outline"
          variant="outline"
          fullWidth
          loading={busy}
          onPress={handleSeed}
        />

        <Card style={{ marginTop: spacing.lg }}>
          <Text style={styles.note}>{t('language.howItWorks')}</Text>
        </Card>

        <Spacer size={spacing.xxxl} />
      </AsyncBoundary>

      <FormSheet
        visible={creating || Boolean(editing)}
        title={editing ? t('common.edit') : t('language.add')}
        onClose={closeForm}
        onSubmit={handleSave}
        submitting={busy}
      >
        <TextField
          label={t('language.code')}
          value={form.code}
          onChangeText={(v) =>
            setForm((p) => ({ ...p, code: v.toLowerCase().replace(/[^a-z]/g, '').slice(0, 3) }))
          }
          error={errors.code}
          hint={t('language.codeHint')}
          autoCapitalize="none"
          // The code is the document id and every profile stores it, so
          // changing it on an existing language would orphan all of them.
          editable={creating}
          required
        />
        <TextField
          label={t('language.nameEnglish')}
          value={form.name}
          onChangeText={(v) => setForm((p) => ({ ...p, name: v }))}
          error={errors.name}
          required
        />
        <TextField
          label={t('language.nativeName')}
          value={form.nativeName}
          onChangeText={(v) => setForm((p) => ({ ...p, nativeName: v }))}
          error={errors.nativeName}
          hint={t('language.nativeNameHint')}
          required
        />
        <TextField
          label={t('language.order')}
          value={String(form.order)}
          onChangeText={(v) =>
            setForm((p) => ({ ...p, order: Number(v.replace(/[^0-9]/g, '')) || 0 }))
          }
          keyboardType="number-pad"
          hint={t('language.orderHint')}
        />
        <ToggleRow
          label={t('language.rtl')}
          description={t('language.rtlHint')}
          value={form.rtl}
          onValueChange={(v) => setForm((p) => ({ ...p, rtl: v }))}
        />
      </FormSheet>

      <ConfirmDialog
        visible={Boolean(confirmDelete)}
        title={t('confirm.deleteTitle')}
        message={t('language.deleteWarning', { name: confirmDelete?.name ?? '' })}
        confirmLabel={t('common.delete')}
        destructive
        loading={busy}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={handleDelete}
      />
    </Screen>
  );
}

export default function AdminLanguages() {
  return (
    <PermissionGuard permission="MANAGE_LANGUAGES">
      <LanguagesScreen />
    </PermissionGuard>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    paddingTop: spacing.sm,
  },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  native: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  meta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  missingTranslations: {
    fontSize: fontSize.xs,
    color: colors.warning,
    paddingBottom: spacing.sm,
  },
  note: { fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 18 },
});
