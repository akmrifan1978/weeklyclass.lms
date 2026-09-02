import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { APP_NAME } from '@/constants/app';
import { brand, colors, fontSize, fontWeight, radius, shadow, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { loginSchema, validate } from '@/utils/validation';
import { Button, IconButton, PasswordField, TextField } from '@/components/ui';
import type { UserRole } from '@/types';

const ROLE_COPY: Record<UserRole, { titleKey: string; icon: keyof typeof Ionicons.glyphMap }> = {
  student: { titleKey: 'auth.studentLogin', icon: 'school-outline' },
  teacher: { titleKey: 'auth.teacherLogin', icon: 'people-outline' },
  admin: { titleKey: 'auth.adminLogin', icon: 'shield-checkmark-outline' },
};

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { login, busy } = useAuth();
  const params = useLocalSearchParams<{ role?: string }>();

  const role = (params.role as UserRole) ?? 'student';
  const copy = ROLE_COPY[role] ?? ROLE_COPY.student;

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const handleLogin = async () => {
    setFormError(null);
    const result = validate(loginSchema, { identifier, password });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});

    try {
      const profile = await login(result.data.identifier, result.data.password);
      // The role buttons on the splash screen are a convenience, not a
      // restriction — an admin who taps "Student Login" still lands correctly.
      if (profile.role !== role) {
        toast.show(t(`admin.role${profile.role.charAt(0).toUpperCase()}${profile.role.slice(1)}`));
      }
      // Redirection itself is handled centrally by RoleGate in app/_layout.tsx.
    } catch (error) {
      setFormError(friendlyMessage(error, t));
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.topBar}>
            <IconButton
              icon="chevron-back"
              label={t('common.back')}
              onPress={() => router.back()}
              background="rgba(255,255,255,0.12)"
              color={colors.textInverse}
            />
          </View>

          <View style={styles.header}>
            <View style={styles.headerIcon}>
              <Ionicons name={copy.icon} size={28} color={brand.orange} />
            </View>
            <Text style={styles.appName}>{APP_NAME}</Text>
            <Text style={styles.title} accessibilityRole="header">
              {t(copy.titleKey)}
            </Text>
          </View>

          <View style={styles.card}>
            <TextField
              label={t('auth.emailOrUsername')}
              value={identifier}
              onChangeText={setIdentifier}
              error={errors.identifier}
              icon="person-outline"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              returnKeyType="next"
              required
            />

            <PasswordField
              label={t('auth.password')}
              value={password}
              onChangeText={setPassword}
              error={errors.password}
              icon="lock-closed-outline"
              autoComplete="current-password"
              returnKeyType="go"
              onSubmitEditing={handleLogin}
              required
            />

            {formError ? (
              <View style={styles.formError} accessibilityLiveRegion="polite" accessibilityRole="alert">
                <Ionicons name="alert-circle" size={17} color={colors.danger} />
                <Text style={styles.formErrorText}>{formError}</Text>
              </View>
            ) : null}

            <Button
              label={busy ? t('auth.loggingIn') : t('auth.login')}
              onPress={handleLogin}
              loading={busy}
              fullWidth
              size="lg"
              icon="log-in-outline"
            />

            <View style={styles.links}>
              <Button
                label={t('auth.forgotPassword')}
                onPress={() => router.push('/(auth)/forgot-password')}
                variant="ghost"
                size="sm"
              />
              <Button
                label={t('auth.forgotUsername')}
                onPress={() => router.push('/(auth)/forgot-username')}
                variant="ghost"
                size="sm"
              />
            </View>
          </View>

          {role !== 'admin' ? (
            <View style={styles.footer}>
              <Text style={styles.footerText}>{t('auth.noAccount')}</Text>
              <Button
                label={t('auth.createAccount')}
                onPress={() =>
                  router.push({ pathname: '/(auth)/register', params: { role } })
                }
                variant="outline"
                size="sm"
              />
            </View>
          ) : (
            <Text style={styles.adminNote}>
              {t('admin.permissionsAdminNote')}
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.navyDeep },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: spacing.xl, justifyContent: 'center' },
  topBar: { position: 'absolute', top: spacing.lg, left: spacing.lg, zIndex: 2 },
  header: { alignItems: 'center', marginBottom: spacing.xxl },
  headerIcon: {
    width: 66,
    height: 66,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
    ...shadow.md,
  },
  appName: {
    fontSize: fontSize.sm,
    color: brand.sandLight,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontWeight: fontWeight.semibold,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
    marginTop: spacing.xs,
  },
  card: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xxl,
    ...shadow.lg,
  },
  formError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  formErrorText: { flex: 1, color: colors.danger, fontSize: fontSize.sm },
  links: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.md,
  },
  footer: {
    alignItems: 'center',
    marginTop: spacing.xxl,
    gap: spacing.md,
  },
  footerText: { color: brand.sandLight, fontSize: fontSize.sm },
  adminNote: {
    color: brand.slate,
    fontSize: fontSize.xs,
    textAlign: 'center',
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
});
