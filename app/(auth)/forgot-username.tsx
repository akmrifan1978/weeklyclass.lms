import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { brand, colors, fontSize, fontWeight, radius, shadow, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { recoverySchema, validate } from '@/utils/validation';
import { usernameForEmail, usernameForMobile } from '@/services/identityService';
import { Button, IconButton, TextField } from '@/components/ui';

/**
 * Username recovery, by mobile number or email address.
 *
 * The mobile number is the reliable one: it belongs to exactly one account,
 * whereas a household may share a single email between several. An address is
 * still accepted, and resolves to whichever account registered with it first.
 *
 * Both look up a document whose id you can only compute if you already know the
 * number or the address, and neither collection can be listed, so this cannot be
 * used to harvest accounts.
 */
export default function ForgotUsernameScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ username: string | null } | null>(null);

  const handleSubmit = async () => {
    const parsed = validate(recoverySchema, identifier);
    if (!parsed.ok) {
      setError(parsed.errors._form ?? 'validation.identifierRequired');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const typed = parsed.data;
      // Digits mean a phone number, however it was punctuated. Try that index
      // first — it is the one that names exactly one account — and fall back to
      // the email index for anything else.
      const username = /^[+0-9\s()-]+$/.test(typed)
        ? await usernameForMobile(typed)
        : await usernameForEmail(typed);
      setResult({ username });
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
              <Ionicons name="help-circle-outline" size={28} color={brand.orange} />
            </View>

            <Text style={styles.title} accessibilityRole="header">
              {t('auth.recoverUsername')}
            </Text>
            <Text style={styles.message}>{t('auth.recoverUsernameHelp')}</Text>

            <TextField
              label={t('auth.mobileOrEmail')}
              icon="person-outline"
              autoCapitalize="none"
              autoCorrect={false}
              value={identifier}
              onChangeText={(value) => {
                setIdentifier(value);
                setError(null);
                setResult(null);
              }}
              error={error}
              returnKeyType="search"
              onSubmitEditing={handleSubmit}
              containerStyle={{ marginTop: spacing.xl, width: '100%' }}
              required
            />

            <Button
              label={t('auth.recoverUsername')}
              onPress={handleSubmit}
              loading={busy}
              fullWidth
              size="lg"
              icon="search-outline"
            />

            {result ? (
              result.username ? (
                <View style={styles.resultBox} accessibilityLiveRegion="polite">
                  <Text style={styles.resultLabel}>{t('auth.usernameFound')}</Text>
                  <Text style={styles.resultValue} selectable>
                    {result.username}
                  </Text>
                  <Button
                    label={t('auth.login')}
                    onPress={() => router.replace('/(auth)/login')}
                    variant="outline"
                    size="sm"
                    style={{ marginTop: spacing.md }}
                  />
                </View>
              ) : (
                <View style={[styles.resultBox, styles.resultBoxEmpty]} accessibilityRole="alert">
                  <Text style={styles.resultEmpty}>{t('auth.usernameNotFound')}</Text>
                </View>
              )
            ) : null}
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
  resultBox: {
    width: '100%',
    backgroundColor: colors.successSoft,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  resultBoxEmpty: { backgroundColor: colors.warningSoft },
  resultLabel: { fontSize: fontSize.xs, color: colors.textSecondary },
  resultValue: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.success,
    marginTop: spacing.xs,
  },
  resultEmpty: { fontSize: fontSize.sm, color: colors.textSecondary, textAlign: 'center' },
});
