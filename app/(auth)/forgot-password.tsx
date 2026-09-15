import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { brand, colors, fontSize, fontWeight, radius, shadow, spacing } from '@/constants/theme';
import { AppError, friendlyMessage } from '@/utils/errors';
import { recoverySchema, validate } from '@/utils/validation';
import { requestPasswordReset } from '@/services/authService';
import { requestPasswordHelp } from '@/services/supportService';
import { Button, IconButton, TextField, useDialPicker } from '@/components/ui';
import { DEFAULT_DIAL, formatPhone, looksLikePhone, splitInternational } from '@/utils/phone';

/**
 * Three outcomes, not two.
 *
 * Most accounts sign in at a real email address and get Firebase's own reset
 * link. But an account whose email was already taken by a relative signs in at
 * a synthetic `@mobile.…` address, and there is no inbox behind it — a reset
 * link would be sent into a void. Telling those people "check your email" would
 * be a lie they would wait on, so they get the third outcome instead: a request
 * that reaches an admin, who can identify them by name and phone number.
 */
type Stage = 'ask' | 'sent' | 'needsHelp' | 'helpSent';

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const [identifier, setIdentifier] = useState('');
  const [contact, setContact] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>('ask');
  const [dial, setDial] = useState(DEFAULT_DIAL);
  const dialPicker = useDialPicker({ dial, onDialChange: setDial });
  const isPhone = looksLikePhone(identifier);
  // What an admin reads on the help request: the number with its code.
  const typedIdentifier = isPhone ? formatPhone(identifier.trim(), dial) : identifier.trim();

  const handleSubmit = async () => {
    const result = validate(recoverySchema, identifier);
    if (!result.ok) {
      setError(result.errors._form ?? 'validation.identifierRequired');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(result.data, isPhone ? dial : null);
      // Always report success: confirming which addresses exist would let
      // anyone enumerate the platform's users.
      setStage('sent');
    } catch (err) {
      if (err instanceof AppError && err.code === 'auth/no-reset-address') {
        // Not an error the person can do anything about, so it is not shown as
        // one. It is a fork in the road.
        setStage('needsHelp');
        setContact(typedIdentifier);
      } else {
        setError(friendlyMessage(err, t));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAskAdmin = async () => {
    setBusy(true);
    try {
      await requestPasswordHelp({ identifier: typedIdentifier, contact: contact.trim() });
      setStage('helpSent');
    } catch (err) {
      setError(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  const sent = stage === 'sent' || stage === 'helpSent';

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
                  {t(stage === 'helpSent' ? 'auth.helpRequestSent' : 'auth.resetEmailSent')}
                </Text>
                <Button
                  label={t('auth.login')}
                  onPress={() => router.replace('/(auth)/login')}
                  fullWidth
                  size="lg"
                  style={{ marginTop: spacing.xl }}
                />
              </>
            ) : stage === 'needsHelp' ? (
              <>
                <Text style={styles.message} accessibilityLiveRegion="polite">
                  {t('auth.resetNeedsAdmin')}
                </Text>
                <TextField
                  label={t('auth.contactBackOn')}
                  value={contact}
                  onChangeText={(value) => {
                    setContact(value);
                    setError(null);
                  }}
                  error={error}
                  icon="call-outline"
                  autoCapitalize="none"
                  autoCorrect={false}
                  hint={t('auth.contactBackOnHint')}
                  containerStyle={{ marginTop: spacing.xl, width: '100%' }}
                  required
                />
                <Button
                  label={t('auth.askAdminForHelp')}
                  onPress={handleAskAdmin}
                  loading={busy}
                  disabled={contact.trim().length === 0}
                  fullWidth
                  size="lg"
                  icon="help-buoy-outline"
                />
              </>
            ) : (
              <>
                <Text style={styles.message}>{t('auth.resetPasswordHelp')}</Text>
                <TextField
                  label={t('auth.mobileOrEmail')}
                  value={identifier}
                  onChangeText={(value) => {
                    const intl = splitInternational(value);
                    if (intl) setDial(intl.dial);
                    setIdentifier(intl ? intl.national : value);
                    setError(null);
                  }}
                  error={error}
                  leading={isPhone ? dialPicker.chip : undefined}
                  icon={isPhone ? undefined : 'person-outline'}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="send"
                  onSubmitEditing={handleSubmit}
                  containerStyle={{ marginTop: spacing.xl, width: '100%' }}
                  required
                />
                {isPhone && dialPicker.panel ? (
                  <View style={{ width: '100%' }}>{dialPicker.panel}</View>
                ) : null}
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
