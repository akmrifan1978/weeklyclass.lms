import React, { useEffect, useMemo, useState } from 'react';
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

import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import { APP_NAME } from '@/constants/app';
import { brand, colors, fontSize, fontWeight, radius, shadow, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import {
  studentRegistrationSchema,
  teacherRegistrationSchema,
  validate,
} from '@/utils/validation';
import { register } from '@/services/authService';
import { isMobileAvailable, isUsernameAvailable } from '@/services/identityService';
import { getSettings } from '@/services/settingsService';
import { listBranches, listClasses, listCountries } from '@/services/orgService';
import { logEvent, AnalyticsEvents } from '@/firebase/analytics';
import {
  Button,
  ChipGroup,
  DateField,
  EmailField,
  IconButton,
  PasswordField,
  Select,
  TextField,
  type Option,
} from '@/components/ui';
import type { Branch, ClassRoom, Country, LanguageCode, UserRole } from '@/types';

type Role = Extract<UserRole, 'student' | 'teacher'>;

interface FormState {
  fullName: string;
  username: string;
  email: string;
  mobile: string;
  country: string;
  language: LanguageCode;
  password: string;
  confirmPassword: string;
  dateOfBirth: string;
  gender: 'male' | 'female' | '';
  qualification: string;
  branchId: string;
  classId: string;
}

/**
 * Turns a typed mobile number into a legal username: usernames allow only
 * [a-z0-9._-], so "+94 77 123 4567" becomes "94771234567". Returns '' when the
 * result would be too short to be valid, so the field simply stays empty rather
 * than showing a "too short" error while someone is still typing.
 */
function usernameFromMobile(mobile: string): string {
  const digits = mobile.replace(/[^0-9]/g, '');
  return digits.length >= 4 ? digits.slice(0, 24) : '';
}

const EMPTY: FormState = {
  fullName: '',
  username: '',
  email: '',
  mobile: '',
  country: '',
  language: 'en',
  password: '',
  confirmPassword: '',
  dateOfBirth: '',
  gender: '',
  qualification: '',
  branchId: '',
  classId: '',
};

export default function RegisterScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const { language, available } = useLanguage();
  const params = useLocalSearchParams<{ role?: string }>();

  const [role, setRole] = useState<Role>(
    params.role === 'teacher' ? 'teacher' : 'student'
  );
  const [form, setForm] = useState<FormState>({ ...EMPTY, language });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ id: string; pending: boolean } | null>(null);
  // Until someone edits the username themselves, it mirrors their mobile
  // number — that is what most people here expect to sign in with.
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [declarationAccepted, setDeclarationAccepted] = useState(false);

  const [countries, setCountries] = useState<Country[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [classes, setClasses] = useState<ClassRoom[]>([]);
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [classRequired, setClassRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [settings, countryRows, branchRows] = await Promise.all([
        getSettings(),
        listCountries().catch(() => []),
        listBranches().catch(() => []),
      ]);
      if (cancelled) return;
      setRegistrationOpen(settings.registrationEnabled);
      setClassRequired(settings.requireClassId === true);
      setCountries(countryRows);
      setBranches(branchRows);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Classes depend on the chosen branch, so they load on demand.
  useEffect(() => {
    if (!form.branchId || role !== 'student') {
      setClasses([]);
      return;
    }
    let cancelled = false;
    listClasses({ branchId: form.branchId })
      .then((page) => {
        if (!cancelled) setClasses(page.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [form.branchId, role]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      if (!previous[key as string]) return previous;
      const next = { ...previous };
      delete next[key as string];
      return next;
    });
  };

  const countryOptions = useMemo<Option[]>(
    () =>
      countries.length
        ? countries.map((c) => ({ value: c.code, label: c.name }))
        : // Until an admin adds countries, let people type nothing but still
          // proceed with a sensible fallback list is not appropriate — instead
          // we surface that the admin has not configured them yet.
          [],
    [countries]
  );

  /**
   * Every branch, labelled with where it is.
   *
   * These used to be filtered to the person's own country, which quietly
   * conflates two unrelated facts: a branch's country is where the branch is,
   * and a person's is where the person is. A teacher living in Sri Lanka who
   * belongs to the Jeddah branch is an ordinary case, and the filter made it
   * unrepresentable — the picker simply came up empty, with nothing to say why.
   *
   * The country is shown against each branch instead, so the choice is informed
   * rather than made for you.
   */
  const branchOptions = useMemo<Option[]>(
    () =>
      branches.map((b) => ({
        value: b.id,
        label: b.name,
        description: [b.city, countries.find((c) => c.code === b.countryCode)?.name]
          .filter(Boolean)
          .join(', '),
      })),
    [branches, countries]
  );

  const classOptions = useMemo<Option[]>(
    () => classes.map((c) => ({ value: c.id, label: c.name, description: c.schedule })),
    [classes]
  );

  const languageOptions = useMemo<Option[]>(
    () => available.map((l) => ({ value: l.code, label: l.nativeName, description: l.name })),
    [available]
  );

  const handleSubmit = async () => {
    setFormError(null);

    if (!declarationAccepted) {
      setErrors({ declaration: 'validation.declarationRequired' });
      return;
    }

    // Checked here rather than in the schema, because whether it is required at
    // all is a setting the schema cannot see. No placeholder is invented when
    // it is missing: a made-up class id points at a class that does not exist,
    // and every report grouped by class then quietly disagrees with itself.
    if (classRequired && role === 'student' && !form.classId) {
      setErrors({ classId: 'validation.classRequired' });
      return;
    }

    const payload = {
      fullName: form.fullName,
      username: form.username,
      email: form.email,
      mobile: form.mobile,
      country: form.country,
      language: form.language,
      password: form.password,
      confirmPassword: form.confirmPassword,
      branchId: form.branchId || null,
      ...(role === 'student'
        ? {
            dateOfBirth: form.dateOfBirth,
            gender: form.gender || null,
            classId: form.classId || null,
          }
        : { qualification: form.qualification }),
    };

    const result = validate(
      role === 'student' ? studentRegistrationSchema : teacherRegistrationSchema,
      payload
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      // Both checked here so the message lands on the field that is actually
      // wrong; the writes themselves are guarded by a Firestore transaction, so
      // a race still cannot create a duplicate.
      //
      // The mobile number is checked FIRST and deliberately so. It is the unique
      // identity, and the username defaults to the same digits — so registering
      // a number twice fails both checks, and reporting "username taken" would
      // send someone off editing the wrong field.
      //
      // Both default to "free" if the lookup itself fails. These are a courtesy
      // that puts the message on the right field; the transaction inside
      // claimIdentity is the actual guarantee. Letting a failed *check* block
      // registration would be the worst of both worlds — it stops nothing and
      // refuses someone who has done nothing wrong.
      const [mobileFree, usernameFree] = await Promise.all([
        isMobileAvailable(result.data.mobile).catch(() => true),
        isUsernameAvailable(result.data.username).catch(() => true),
      ]);
      if (!mobileFree) {
        setErrors({ mobile: 'validation.mobileTaken' });
        return;
      }
      if (!usernameFree) {
        setErrors({ username: 'validation.usernameTaken' });
        return;
      }

      const outcome = await register(role, {
        fullName: result.data.fullName,
        username: result.data.username,
        email: result.data.email,
        mobile: result.data.mobile,
        country: result.data.country,
        language: result.data.language as LanguageCode,
        password: result.data.password,
        branchId: form.branchId || null,
        classId: role === 'student' ? form.classId || null : null,
        dateOfBirth: role === 'student' ? form.dateOfBirth : null,
        gender: role === 'student' ? (form.gender || null) : null,
        qualification: role === 'teacher' ? form.qualification : undefined,
      });

      logEvent(AnalyticsEvents.signUp, { role });
      setDone({ id: outcome.generatedId, pending: outcome.requiresApproval });
    } catch (error) {
      setFormError(friendlyMessage(error, t));
      toast.error(friendlyMessage(error, t));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.successWrap}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={54} color={colors.success} />
          </View>
          <Text style={styles.successTitle} accessibilityRole="header">
            {t('auth.registrationSubmitted')}
          </Text>
          <Text style={styles.successMessage}>
            {done.pending ? t('auth.registrationPendingApproval') : t('auth.registrationActive')}
          </Text>
          <View style={styles.idChip}>
            <Text style={styles.idLabel}>
              {role === 'student' ? t('auth.studentId') : t('auth.teacherId')}
            </Text>
            <Text style={styles.idValue} selectable>
              {done.id}
            </Text>
          </View>
          <Text style={styles.verifyNote}>{t('auth.verifyEmailSent')}</Text>
          <Button
            label={t('auth.login')}
            onPress={() => router.replace({ pathname: '/(auth)/login', params: { role } })}
            fullWidth
            size="lg"
            style={{ marginTop: spacing.xxl, maxWidth: 380 }}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!registrationOpen) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.successWrap}>
          <View style={[styles.successIcon, { backgroundColor: colors.warningSoft }]}>
            <Ionicons name="lock-closed" size={44} color={colors.warning} />
          </View>
          <Text style={styles.successTitle}>{t('auth.registrationClosed')}</Text>
          <Button
            label={t('common.back')}
            onPress={() => router.replace('/')}
            variant="outlineLight"
            style={{ marginTop: spacing.xxl }}
          />
        </View>
      </SafeAreaView>
    );
  }

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
          <View style={styles.headerRow}>
            <IconButton
              icon="chevron-back"
              label={t('common.back')}
              onPress={() => router.back()}
              background="rgba(255,255,255,0.12)"
              color={colors.textInverse}
            />
            <View style={styles.headerText}>
              <Text style={styles.appName}>{APP_NAME}</Text>
              <Text style={styles.title} accessibilityRole="header">
                {t(role === 'student' ? 'auth.registerStudent' : 'auth.registerTeacher')}
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <ChipGroup<Role>
              options={[
                { value: 'student', label: t('admin.roleStudent') },
                { value: 'teacher', label: t('admin.roleTeacher') },
              ]}
              value={role}
              onChange={(next) => {
                setRole(next);
                setErrors({});
              }}
              style={{ marginBottom: spacing.xl }}
            />

            <TextField
              label={t('auth.fullName')}
              value={form.fullName}
              onChangeText={(v) => set('fullName', v)}
              error={errors.fullName}
              icon="person-outline"
              autoComplete="name"
              required
            />

            <TextField
              label={t('auth.username')}
              value={form.username}
              onChangeText={(v) => {
                setUsernameEdited(true);
                set('username', v.toLowerCase().replace(/\s/g, ''));
              }}
              error={errors.username}
              hint={usernameEdited ? undefined : t('auth.usernameFromMobileHint')}
              icon="at-outline"
              autoCapitalize="none"
              autoCorrect={false}
              required
            />

            <EmailField
              label={t('auth.email')}
              value={form.email}
              onChangeText={(v) => set('email', v)}
              error={errors.email}
              // A household shares one inbox, so the same address may appear on
              // several accounts. The mobile number is what has to be unique.
              //
              // No longer required: the asterisk had to go with the rule behind
              // it, or the form would demand something the validator does not.
              hint={t('auth.sharedEmailNote')}
            />

            <TextField
              label={t('auth.mobile')}
              value={form.mobile}
              onChangeText={(v) => {
                set('mobile', v);
                if (!usernameEdited) set('username', usernameFromMobile(v));
              }}
              error={errors.mobile}
              icon="call-outline"
              keyboardType="phone-pad"
              autoComplete="tel"
              required
            />

            <Select
              label={t('auth.country')}
              value={form.country}
              options={countryOptions}
              onChange={(v) => {
                set('country', v);
                set('branchId', '');
                set('classId', '');
              }}
              error={errors.country}
              placeholder={
                countryOptions.length ? undefined : t('empty.noCountriesYet')
              }
              searchable
              required
            />

            {branchOptions.length ? (
              <Select
                label={t('auth.branch')}
                value={form.branchId}
                options={branchOptions}
                onChange={(v) => {
                  set('branchId', v);
                  set('classId', '');
                }}
                allowClear
              />
            ) : null}

            {role === 'student' ? (
              <>
                {classOptions.length ? (
                  <Select
                    label={t('auth.class')}
                    value={form.classId}
                    options={classOptions}
                    onChange={(v) => set('classId', v)}
                    error={errors.classId}
                    required={classRequired}
                    allowClear={!classRequired}
                  />
                ) : null}

                <DateField
                  label={t('auth.dateOfBirth')}
                  value={form.dateOfBirth}
                  onChange={(v) => set('dateOfBirth', v)}
                  error={errors.dateOfBirth}
                  required
                />

                <Select<'male' | 'female'>
                  label={t('auth.gender')}
                  value={form.gender || null}
                  options={[
                    { value: 'male', label: t('auth.male') },
                    { value: 'female', label: t('auth.female') },
                  ]}
                  onChange={(v) => set('gender', v)}
                  allowClear
                />
              </>
            ) : (
              <TextField
                label={t('auth.qualification')}
                value={form.qualification}
                onChangeText={(v) => set('qualification', v)}
                error={errors.qualification}
                icon="ribbon-outline"
              />
            )}

            <Select
              label={t('auth.preferredLanguage')}
              value={form.language}
              options={languageOptions}
              onChange={(v) => set('language', v as LanguageCode)}
              required
            />

            <PasswordField
              label={t('auth.password')}
              value={form.password}
              onChangeText={(v) => set('password', v)}
              error={errors.password}
              icon="lock-closed-outline"
              hint={t('auth.passwordHint')}
              autoComplete="new-password"
              required
            />

            <PasswordField
              label={t('auth.confirmPassword')}
              value={form.confirmPassword}
              onChangeText={(v) => set('confirmPassword', v)}
              error={errors.confirmPassword}
              icon="lock-closed-outline"
              autoComplete="new-password"
              required
            />

            {formError ? (
              <View style={styles.formError} accessibilityRole="alert">
                <Ionicons name="alert-circle" size={17} color={colors.danger} />
                <Text style={styles.formErrorText}>{formError}</Text>
              </View>
            ) : null}

            <Pressable
              onPress={() => {
                setDeclarationAccepted((v) => !v);
                setErrors((previous) => {
                  const next = { ...previous };
                  delete next.declaration;
                  return next;
                });
              }}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: declarationAccepted }}
              accessibilityLabel={t('auth.declaration')}
              style={styles.declarationRow}
            >
              <View
                style={[
                  styles.checkbox,
                  declarationAccepted ? styles.checkboxOn : null,
                  errors.declaration ? styles.checkboxError : null,
                ]}
              >
                {declarationAccepted ? (
                  <Ionicons name="checkmark" size={15} color={colors.textInverse} />
                ) : null}
              </View>
              <Text style={styles.declarationText}>{t('auth.declaration')}</Text>
            </Pressable>

            {errors.declaration ? (
              <Text style={styles.declarationError}>{t(errors.declaration)}</Text>
            ) : null}

            <Button
              label={t('auth.createAccount')}
              onPress={handleSubmit}
              loading={submitting}
              disabled={!declarationAccepted}
              fullWidth
              size="lg"
              icon="person-add-outline"
            />

            <View style={styles.footer}>
              <Text style={styles.footerHint}>{t('auth.haveAccount')}</Text>
              <Button
                label={t('auth.login')}
                onPress={() => router.replace({ pathname: '/(auth)/login', params: { role } })}
                variant="ghost"
                size="sm"
              />
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: brand.navyDeep },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: spacing.lg, paddingBottom: spacing.huge },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.xl,
    marginTop: spacing.sm,
  },
  headerText: { flex: 1 },
  appName: {
    fontSize: fontSize.xs,
    color: brand.sandLight,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontWeight: fontWeight.semibold,
  },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.textInverse },
  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
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
  declarationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkboxError: { borderColor: colors.danger },
  declarationText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  declarationError: {
    fontSize: fontSize.xs,
    color: colors.danger,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  footer: { alignItems: 'center', marginTop: spacing.lg },
  footerHint: { color: colors.textMuted, fontSize: fontSize.sm },
  successWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
  },
  successIcon: {
    width: 96,
    height: 96,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  successTitle: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
    textAlign: 'center',
  },
  successMessage: {
    fontSize: fontSize.md,
    color: brand.sandLight,
    textAlign: 'center',
    marginTop: spacing.md,
    lineHeight: 22,
    maxWidth: 400,
  },
  idChip: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    marginTop: spacing.xxl,
  },
  idLabel: {
    fontSize: fontSize.xs,
    color: brand.slate,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  idValue: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: brand.orangeLight,
    marginTop: spacing.xs,
  },
  verifyNote: {
    fontSize: fontSize.xs,
    color: brand.slate,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
