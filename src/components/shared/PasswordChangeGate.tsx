import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { changePassword } from '@/services/authService';
import { friendlyMessage } from '@/utils/errors';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { Button, TextField } from '@/components/ui';
import { LogoutButton } from '@/components/shared/LogoutButton';

/**
 * Stands between a person and the app until they choose a new password.
 *
 * Shown when an admin has required it. Deliberately not a dismissible dialog:
 * a prompt that can be waved away is a prompt nobody acts on, and the point of
 * requiring it is that everybody actually re-secures their account.
 *
 * WHAT IT CANNOT DO, said plainly here because the limit shapes the screen: it
 * does not stop the old password working. A client cannot invalidate another
 * account's password — only the Admin SDK can. So this holds the app closed
 * until a new one is set, which is the strongest thing available without a
 * server, and the copy does not pretend otherwise.
 *
 * A way out is always offered. Somebody who cannot remember the current
 * password they just signed in with — an admin having set a temporary one for
 * them, say — must be able to leave rather than be trapped in a screen they
 * cannot satisfy.
 */

const MIN_LENGTH = 6;

export function PasswordChangeGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!user?.mustChangePassword) return <>{children}</>;

  const submit = async () => {
    setError(null);

    if (next.length < MIN_LENGTH) {
      setError(t('validation.passwordTooShort', { count: MIN_LENGTH }));
      return;
    }
    if (next !== confirm) {
      setError(t('validation.passwordsDoNotMatch'));
      return;
    }
    if (next === current) {
      setError(t('auth.passwordMustDiffer'));
      return;
    }

    setBusy(true);
    try {
      // The profile listener carries the cleared flag back, which is what takes
      // this screen down — nothing here has to navigate.
      await changePassword(current, next);
    } catch (caught) {
      setError(friendlyMessage(caught, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <View style={styles.icon}>
            <Ionicons name="key" size={26} color={brand.orange} />
          </View>

          <Text style={styles.title}>{t('auth.mustChangeTitle')}</Text>
          <Text style={styles.body}>{t('auth.mustChangeBody')}</Text>

          <TextField
            label={t('auth.currentPassword')}
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            autoComplete="current-password"
          />
          <TextField
            label={t('auth.newPassword')}
            value={next}
            onChangeText={setNext}
            secureTextEntry
            autoComplete="new-password"
            hint={t('validation.passwordTooShort', { count: MIN_LENGTH })}
          />
          <TextField
            label={t('auth.confirmPassword')}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoComplete="new-password"
          />

          {error ? (
            <View style={styles.error}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Button
            label={t('auth.setNewPassword')}
            icon="checkmark"
            onPress={submit}
            loading={busy}
            fullWidth
            style={{ marginTop: spacing.md }}
          />

          {/* Not trapped. Somebody who cannot satisfy this screen has to be
              able to leave it. */}
          <View style={styles.out}>
            <LogoutButton tint={colors.textMuted} />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: brand.navyDeep },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  icon: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  body: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  errorText: { flex: 1, fontSize: fontSize.xs, color: colors.text, lineHeight: 18 },
  out: { alignItems: 'center', marginTop: spacing.lg },
});
