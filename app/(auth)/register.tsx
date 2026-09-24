import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { AppError, friendlyMessage } from '@/utils/errors';
import {
  studentRegistrationSchema,
  teacherRegistrationSchema,
  validate,
} from '@/utils/validation';
import { register } from '@/services/authService';
import { DEFAULT_DIAL, localTenDigits } from '@/utils/phone';
import { getSettings } from '@/services/settingsService';
import { listBranches, listClasses, listCountries } from '@/services/orgService';
import { logEvent, AnalyticsEvents } from '@/firebase/analytics';
import {
  PhoneField,
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
import type { AgeBand, Branch, ClassRoom, Country, LanguageCode, UserRole } from '@/types';

type Role = Extract<UserRole, 'student' | 'teacher'>;

interface FormState {
  fullName: string;
  username: string;
  email: string;
  mobile: string;
  mobileCountryCode: string;
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
 * The username a mobile number suggests: its 10-digit local form, leading 0
 * included and no country code - "567560387" with +966 becomes "0567560387".
 * While the number is still being typed it mirrors the digits so far, and
 * stays empty for the first few so no error shows mid-word.
 */
function usernameFromMobile(mobile: string): string {
  const whole = localTenDigits(mobile);
  if (whole) return whole;
  const digits = mobile.replace(/[^0-9]/g, '');
  return digits.length >= 4 ? digits.slice(0, 10) : '';
}

/**
 * The ages the groups are split at. The centre's own bands: children, then
 * teenagers from thirteen, then everybody from eighteen.
 */
const TEENAGER_FROM = 13;
const ADULT_FROM = 18;

/** Which band a date of birth falls in, or null while it is incomplete. */
function ageBandFor(dateOfBirth: string): AgeBand | null {
  if (!dateOfBirth) return null;
  const born = new Date(`${dateOfBirth}T00:00:00`);
  if (Number.isNaN(born.getTime())) return null;
  const now = new Date();
  const beforeBirthday =
    now.getMonth() < born.getMonth() ||
    (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  const age = now.getFullYear() - born.getFullYear() - (beforeBirthday ? 1 : 0);
  if (age < 0 || age > 120) return null;
  if (age >= ADULT_FROM) return 'adults';
  if (age >= TEENAGER_FROM) return 'teenagers';
  return 'children';
}

const EMPTY: FormState = {
  fullName: '',
  username: '',
  email: '',
  mobile: '',
  mobileCountryCode: DEFAULT_DIAL,
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
  const submittingRef = useRef(false);
  // Set once the person chooses a group themselves, which stops the
  // suggestion below from overruling them.
  const classPicked = useRef(false);
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

  /**
   * Every class, loaded once — not the chosen branch's classes, loaded after.
   *
   * The class question now comes BEFORE the branch one, because that is the
   * order a student is told things: they are joining Children or Adults, and
   * the branch is the organisation's business rather than theirs. Loading on
   * the branch meant the field was empty at the moment it is asked, so it
   * simply did not appear and nobody could pick a class at all.
   *
   * The branch is inferred from the class instead, below — a class belongs to
   * exactly one, so asking twice was always asking the same question twice.
   */
  useEffect(() => {
    if (role !== 'student') {
      setClasses([]);
      return;
    }
    let cancelled = false;
    listClasses({ pageSize: 100 })
      .then((page) => {
        if (!cancelled) setClasses(page.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [role]);

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

  const [classCode, setClassCode] = useState('');

  /**
   * Classes that actually have an id somebody could be given.
   *
   * A school which has not filled the codes in gets the picker instead — an
   * input that can never match anything would block registration entirely, and
   * that is a worse outcome than an unfamiliar control.
   */
  const codedClasses = useMemo(
    () => classes.filter((c) => (c.code ?? '').trim().length > 0),
    [classes]
  );
  const matchedClass = useMemo(
    () =>
      codedClasses.find((c) => (c.code ?? '').toUpperCase() === classCode.trim().toUpperCase()) ??
      null,
    [codedClasses, classCode]
  );

  /**
   * The class groups this person can actually join.
   *
   * Filtered by the gender they gave, because the groups are separated and
   * offering a boy the girls' group is offering a mistake. A group marked
   * `mixed`, or one created before groups carried a gender at all, is offered
   * to everybody — the absence of an answer is not the same as "the other one".
   *
   * Before a gender is chosen the list is unfiltered rather than empty: an
   * empty picker reads as "there are no classes", which is a different and
   * more alarming thing than "tell me who you are first".
   */
  const classOptions = useMemo<Option[]>(
    () =>
      classes
        .filter((c) => {
          if (!form.gender) return true;
          const groupGender = c.gender ?? 'mixed';
          return groupGender === 'mixed' || groupGender === form.gender;
        })
        .map((c) => ({
          value: c.id,
          label: c.name,
          // What the group is, under its name — the two things that decide
          // whether it is the right one.
          description: [
            c.ageBand ? t(`classGroup.age_${c.ageBand}`) : null,
            c.gender && c.gender !== 'mixed' ? t(`classGroup.gender_${c.gender}`) : null,
            c.schedule || null,
          ]
            .filter(Boolean)
            .join('  ·  '),
        })),
    [classes, form.gender, t]
  );

  /**
   * The group this student belongs in, worked out rather than asked for.
   *
   * The groups are split by age and by gender - Children, Teenagers and Adults,
   * each male and female - and the student has already said both: the date of
   * birth gives the band, the gender gives the half. Where exactly one group
   * matches, it is filled in for them.
   *
   * Only where exactly one matches. Two groups for the same age and gender is a
   * choice somebody has to make, and none at all is not something to guess at -
   * in both cases the picker is left as it was.
   */
  const suggestedClass = useMemo(() => {
    const band = ageBandFor(form.dateOfBirth);
    if (!band || !form.gender) return null;
    const matches = classes.filter((c) => c.ageBand === band && c.gender === form.gender);
    return matches.length === 1 ? matches[0] : null;
  }, [classes, form.dateOfBirth, form.gender]);

  /*
   * Filled in for them until they fill it in themselves. Somebody who picks a
   * group by hand, or types a class code they were given, has said something
   * about their own case that an age and a gender cannot know.
   */
  useEffect(() => {
    if (!suggestedClass || classPicked.current) return;
    if (form.classId === suggestedClass.id) return;
    set('classId', suggestedClass.id);
    if (suggestedClass.branchId) set('branchId', suggestedClass.branchId);
    // Keyed on the suggestion itself: re-running it whenever the form object
    // changes would undo the person's own choice a moment after they made it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedClass?.id]);

  /**
   * The teachers who come with the chosen group.
   *
   * Not asked for and not chosen — a student does not pick their teacher, the
   * group they join decides it. Shown because being told who will be teaching
   * you is the point at which a class group stops being an abstraction.
   */
  const assignedTeachers = useMemo(() => {
    const chosen = classes.find((c) => c.id === form.classId);
    if (!chosen) return [] as string[];
    // Read from the group rather than looked up: this screen runs signed out
    // and has no access to the users collection.
    return chosen.teacherNames ?? [];
  }, [classes, form.classId]);

  const languageOptions = useMemo<Option[]>(
    () => available.map((l) => ({ value: l.code, label: l.nativeName, description: l.name })),
    [available]
  );

  const handleSubmit = async () => {
    // A second tap while the first is still working is ignored before anything
    // is checked or sent. The button shows a spinner, but a quick double tap
    // lands both taps before the spinner has drawn.
    if (submittingRef.current) return;
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
    submittingRef.current = true;
    setSubmitting(true);
    try {
      /*
      * The number and the username are NOT checked here first.
      *
      * `register` checks both itself, at the same time as it reads the
      * settings, and refuses with the same two messages. Asking here as well
      * put two more round trips to a database in another country in front of
      * every registration - a second or more of waiting, before anything had
      * begun, to learn what the next step was about to learn anyway.
      *
      * The message still lands on the right field: the catch below puts those
      * two refusals back on the number and the username.
      */
      const outcome = await register(role, {
        fullName: result.data.fullName,
        username: result.data.username,
        email: result.data.email,
        mobile: result.data.mobile,
        mobileCountryCode: form.mobileCountryCode,
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
      // "That number is taken" belongs on the number, not in a banner at the
      // bottom of a long form.
      const key = error instanceof AppError ? error.userMessage : '';
      if (key === 'validation.mobileTaken' || key === 'validation.usernameTaken') {
        setErrors({ [key === 'validation.mobileTaken' ? 'mobile' : 'username']: key });
        return;
      }
      setFormError(friendlyMessage(error, t));
      toast.error(friendlyMessage(error, t));
    } finally {
      submittingRef.current = false;
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
                // Digits only, ten at most: 0544170199.
                set('username', v.replace(/[^0-9]/g, '').slice(0, 10));
              }}
              error={errors.username}
              hint={usernameEdited ? t('auth.usernameRule') : t('auth.usernameFromMobileHint')}
              icon="at-outline"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="number-pad"
              maxLength={10}
              required
            />

            <EmailField
              label={t('auth.email')}
              value={form.email}
              onChangeText={(v) => set('email', v)}
              error={errors.email}
              // Required again, and marked as such — an asterisk has to agree
              // with the validator behind it or the form lies about itself.
              //
              // A household may still share one inbox: the same address on
              // several accounts is fine, and the mobile number is what has to
              // be unique.
              required
              hint={t('auth.sharedEmailNote')}
            />

            {/* Saudi Arabia by default, because the centre is in Jeddah and most
                families here have a Saudi number whatever their nationality. */}
            <PhoneField
              label={t('auth.mobile')}
              dial={form.mobileCountryCode}
              onDialChange={(dial) => set('mobileCountryCode', dial)}
              value={form.mobile}
              onChangeText={(v) => {
                set('mobile', v);
                if (!usernameEdited) set('username', usernameFromMobile(v));
              }}
              error={errors.mobile}
              autoComplete="tel-national"
              required
            />

            {/* "Nationality" rather than "Country" here, because this is a
                fact about the person. A branch has a country — where it is —
                and that field keeps its own name; conflating the two asked a
                Sri Lankan teacher working in Jeddah which of the two answers
                was wanted. */}
            <Select
              label={t('auth.nationality')}
              value={form.country}
              options={countryOptions}
              // Clears nothing: the branch list is no longer filtered by it,
              // and the class no longer hangs off the branch.
              onChange={(v) => set('country', v)}
              error={errors.country}
              placeholder={
                countryOptions.length ? undefined : t('empty.noCountriesYet')
              }
              searchable
              required
            />

            {/* Directly after nationality, and above branch, because a student
                is told which class they are joining before they are told
                anything about branches — and asking in the order somebody was
                told is what stops them guessing.
                
                Typed rather than picked, because the id is the thing a student
                is actually given: "join JDC-A1" is a sentence somebody can be
                told over the phone, and a list of class names is not.
                
                Where no class has an id yet the list is offered instead. A
                school that has not set them up must still be able to register
                students, and an input matching nothing would stop that. */}
            {role === 'student' && codedClasses.length > 0 ? (
              <>
                <TextField
                  label={t('auth.classIdEnter')}
                  value={classCode}
                  onChangeText={(value) => {
                    const next = value.toUpperCase();
                    classPicked.current = next.trim().length > 0;
                    setClassCode(next);
                    const match = codedClasses.find(
                      (c) => (c.code ?? '').toUpperCase() === next.trim()
                    );
                    set('classId', match?.id ?? '');
                    // The class carries its branch, so a matched id answers the
                    // branch question too.
                    if (match?.branchId) set('branchId', match.branchId);
                  }}
                  error={errors.classId}
                  icon="key-outline"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  hint={t('auth.classIdEnterHint')}
                  required={classRequired}
                />
                {/* Named back straight away. Somebody typing a code they were
                    read out needs to see they landed in the right class, and
                    the only way to know is to be told which one. */}
                {classCode.trim() ? (
                  matchedClass ? (
                    <Text style={styles.classMatched}>
                      {t('auth.classIdMatched', { name: matchedClass.name })}
                    </Text>
                  ) : (
                    <Text style={styles.classUnknown}>{t('auth.classIdUnknown')}</Text>
                  )
                ) : null}
              </>
            ) : role === 'student' && classOptions.length ? (
              <>
                <Select
                  label={t('classGroup.field')}
                  value={form.classId}
                  options={classOptions}
                  onChange={(v) => {
                    classPicked.current = true;
                    set('classId', v);
                    const chosen = classes.find((c) => c.id === v);
                    if (chosen?.branchId) set('branchId', chosen.branchId);
                  }}
                  error={errors.classId}
                  required={classRequired}
                  allowClear={!classRequired}
                />
                {/* Said out loud, because a field that fills itself in is
                    unsettling unless it tells you why. */}
                {suggestedClass && form.classId === suggestedClass.id && !classPicked.current ? (
                  <Text style={styles.classMatched}>{t('auth.classAutoPicked')}</Text>
                ) : null}
              </>
            ) : null}
            {/* Who will be teaching, named as soon as the group is known —
                whether it was typed as a code or picked from the list. A
                student never chooses a teacher; the group decides. Being told
                is the point at which a class group stops being an
                abstraction. */}
            {role === 'student' && assignedTeachers.length > 0 ? (
              <Text style={styles.classMatched}>
                {t('classGroup.assignedTeachers', { names: assignedTeachers.join(', ') })}
              </Text>
            ) : null}

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
  classMatched: {
    fontSize: fontSize.xs,
    color: colors.success,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  classUnknown: {
    fontSize: fontSize.xs,
    color: colors.warning,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
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
