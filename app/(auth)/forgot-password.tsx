import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { brand, colors, fontSize, fontWeight, radius, shadow, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { emailSchema, validate } from '@/utils/validation';
import { requestPasswordReset } from '@/services/authService';
import { Button, EmailField, IconButton } from '@/components/ui';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    const result = validate(emailSchema, email);
    if (!result.ok) {
      setError(result.errors._form ?? 'validation.emailInvalid');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(result.data);
      // Always report success: confirming which addresses exist would let
      // anyone enumerate the platform's users.
      setSent(true);
    } catch (err) {
      setError(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.topBar}>
            <IconButton
              icon="chevron-back"
              label={t('common.back')}
              onPress={() => router.back()}
              background="rgba(255,255,255,0.12)"
              color={colors.textInverse}
            />
          </View>

          <View style={styles.card}>
            <View style={styles.icon}>
              <Ionicons
                name={sent ? 'mail-open-outline' : 'key-outline'}
                size={28}
                color={sent ? colors.success : brand.orange}
              />
            </View>

            <Text style={styles.title} accessibilityRole="header">
              {t('auth.resetPassword')}
            </Text>

            {sent ? (
              <>
                <Text style={styles.message} accessibilityLiveRegion="polite">
                  {t('auth.resetEmailSent')}
                </Text>
                <Button
                  label={t('auth.login')}
                  onPress={() => router.replace('/(auth)/login')}
                  fullWidth
                  size="lg"
                  style={{ marginTop: spacing.xl }}
                />
              </>
            ) : (
              <>
                <Text style={styles.message}>{t('auth.resetPasswordHelp')}</Text>
                <EmailField
                  label={t('auth.email')}
                  value={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    setError(null);
                  }}
                  error={error}
                  returnKeyType="send"
                  onSubmitEditing={handleSubmit}
                  containerStyle={{ marginTop: spacing.xl, width: '100%' }}
                  required
                />
                <Button
                  label={t('auth.resetPassword')}
                  onPress={handleSubmit}
                  loading={busy}
                  fullWidth
                  size="lg"
                  icon="paper-plane-outline"
                />
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.navyDeep },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: spacing.xl },
  topBar: { position: 'absolute', top: spacing.lg, left: spacing.lg },
  card: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xxl,
    alignItems: 'center',
    ...shadow.lg,
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.text },
  message: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: spacing.sm,
  },
});
