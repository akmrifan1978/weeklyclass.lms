import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
import { Button, IconButton, PasswordField, TextField, useDialPicker } from '@/components/ui';
import { DEFAULT_DIAL, looksLikePhone, splitInternational } from '@/utils/phone';
import type { UserRole } from '@/types';
import { InstallSheet, useInstall } from '@/components/shared/InstallApp';

const ROLE_COPY: Record<UserRole, { titleKey: string; icon: keyof typeof Ionicons.glyphMap }> = {
  student: { titleKey: 'auth.studentLogin', icon: 'school-outline' },
  teacher: { titleKey: 'auth.teacherLogin', icon: 'people-outline' },
  admin: { titleKey: 'auth.adminLogin', icon: 'shield-checkmark-outline' },
};

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const install = useInstall();
  const [installOpen, setInstallOpen] = useState(false);
  const toast = useToast();
  const { login, busy } = useAuth();
  const params = useLocalSearchParams<{ role?: string }>();

  const role = (params.role as UserRole) ?? 'student';
  const copy = ROLE_COPY[role] ?? ROLE_COPY.student;

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  // The code chip appears only once what is typed is a number; a username or
  // an email needs no country.
  const [dial, setDial] = useState(DEFAULT_DIAL);
  const dialPicker = useDialPicker({ dial, onDialChange: setDial });
  const isPhone = looksLikePhone(identifier);
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
      const profile = await login(result.data.identifier, result.data.password, isPhone ? dial : null);
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
              onChangeText={(value) => {
                // "+966 56..." pasted whole: the code goes to the chip.
                const intl = splitInternational(value);
                if (intl) {
                  setDial(intl.dial);
                  setIdentifier(intl.national);
                } else {
                  setIdentifier(value);
                }
              }}
              error={errors.identifier}
              leading={isPhone ? dialPicker.chip : undefined}
              icon={isPhone ? undefined : 'person-outline'}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              returnKeyType="next"
              required
            />
            {isPhone ? dialPicker.panel : null}

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
                variant="outlineLight"
                size="sm"
              />
              {/*
               * Look around without an account.
               *
               * A guest is signed OUT, not signed in as a lesser kind of user, and
               * that is what keeps the limits honest: booking an event and taking a
               * weekly assignment both need an account, and the security rules
               * refuse both to anybody without one. There is no guest flag for a
               * screen to forget to check.
               */}
              {/* A text link, in the same light colour as the line above it.
                  The ghost button drew navy text on this navy background and
                  was all but invisible; a second outlined button would have
                  competed with Create account. */}
              <Pressable
                onPress={() => router.push('/(auth)/guest')}
                accessibilityRole="link"
                accessibilityLabel={t('guest.enter')}
                hitSlop={8}
                style={({ pressed }) => [styles.guestLink, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="eye-outline" size={16} color={brand.sandLight} />
                <Text style={styles.guestLinkText}>{t('guest.enter')}</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.adminNote}>
              {t('admin.permissionsAdminNote')}
            </Text>
          )}

          {/* For every role, admin included, and hidden once installed. */}
          {install.web && !install.installed ? (
            <Pressable
              onPress={() => setInstallOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={t('install.open')}
              hitSlop={8}
              style={({ pressed }) => [styles.installLink, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="download-outline" size={16} color={brand.sandLight} />
              <Text style={styles.guestLinkText}>{t('install.open')}</Text>
            </Pressable>
          ) : null}
          <InstallSheet visible={installOpen} onClose={() => setInstallOpen(false)} />
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
  installLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingVertical: spacing.xs,
  },
  guestLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xs },
  guestLinkText: {
    color: brand.sandLight,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    textDecorationLine: 'underline',
  },
  adminNote: {
    color: brand.slate,
    fontSize: fontSize.xs,
    textAlign: 'center',
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.xl,
  },
});
