import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { friendlyMessage } from '@/utils/errors';
import { ensureLanguages, listLanguages, setEnabled } from '@/services/languageService';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import {
  AsyncBoundary,
  Badge,
  Button,
  Card,
  Divider,
  Screen,
  SkeletonList,
  Spacer,
  ToggleRow,
} from '@/components/ui';

/**
 * Language registry.
 *
 * Toggling a language here changes what the splash screen and profile screen
 * offer, without a new build. Adding a genuinely new language still needs a
 * translation file — the seed button below writes the bundled set into
 * Firestore so the list is editable from day one.
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
              </View>
            </View>
          ))}
        </Card>

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
          <Text style={styles.note}>
            Translation files ship with the app (src/i18n/locales). To add a language, copy
            en.json, translate it, register it in src/constants/app.ts and src/i18n/index.ts, then
            rebuild. Enabling or disabling an existing language takes effect immediately.
          </Text>
        </Card>

        <Spacer size={spacing.xxxl} />
      </AsyncBoundary>
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
  note: { fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 18 },
});
