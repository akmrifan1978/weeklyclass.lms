import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { useAsync, useDebounced, usePaginated } from '@/hooks/useAsync';
import { friendlyMessage } from '@/utils/errors';
import { humanise } from '@/utils/format';
import { validate, studentRegistrationSchema, teacherRegistrationSchema } from '@/utils/validation';
import {
  approveUser,
  createUserAsAdmin,
  listUsers,
  removeUser,
  sendResetEmail,
  setStatus,
  updateUser,
} from '@/services/userService';
import { listBranches, listClasses, listCountries } from '@/services/orgService';
import type { AppUser, Branch, ClassRoom, Country, LanguageCode, UserRole, UserStatus } from '@/types';
import {
  AsyncBoundary,
  Avatar,
  Badge,
  Button,
  Card,
  ChipGroup,
  ConfirmDialog,
  DateField,
  DetailRow,
  Divider,
  EmailField,
  FormSheet,
  PasswordField,
  Screen,
  SearchField,
  SectionHeader,
  Select,
  SkeletonList,
  Spacer,
  StatusBadge,
  TextField,
  type Option,
} from '@/components/ui';
import type { Cursor } from '@/services/firestore';

/**
 * User management, shared by the admin screens for Users / Students / Teachers.
 *
 * `role` fixes the list to one role; leaving it undefined shows everyone with a
 * role filter. Every mutating action here is also permission-checked in the
 * Firestore rules — the buttons are only the friendly half.
 */
export function UserManager({
  role,
  title,
}: {
  role?: Extract<UserRole, 'student' | 'teacher'>;
  title: string;
}) {
  const { t } = useTranslation();
  const { user: actor, can } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const params = useLocalSearchParams<{ action?: string }>();

  const [term, setTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | 'all'>(role ?? 'all');
  const [statusFilter, setStatusFilter] = useState<UserStatus | 'all'>('all');
  const [selected, setSelected] = useState<AppUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [confirm, setConfirm] = useState<{ user: AppUser; action: 'delete' | 'deactivate' } | null>(
    null
  );
  const [busy, setBusy] = useState(false);

  const search = useDebounced(term, 400);

  const canCreate = role === 'teacher' ? can('CREATE_TEACHERS') : can('CREATE_STUDENTS');
  const canEdit = role === 'teacher' ? can('EDIT_TEACHERS') : can('EDIT_STUDENTS');
  const canDelete = role === 'teacher' ? can('DELETE_TEACHERS') : can('DELETE_STUDENTS');

  const fetchPage = useCallback(
    (cursor: Cursor) =>
      listUsers({
        role: role ?? (roleFilter === 'all' ? undefined : roleFilter),
        status: statusFilter === 'all' ? undefined : statusFilter,
        search: search || undefined,
        cursor,
        pageSize: 20,
      }),
    [role, roleFilter, statusFilter, search]
  );

  const list = usePaginated(fetchPage, [role, roleFilter, statusFilter, search]);

  // A deep link from the dashboard opens the create sheet directly.
  useEffect(() => {
    if (params.action === 'new' && canCreate) setCreating(true);
  }, [params.action, canCreate]);

  const handleApprove = async (target: AppUser) => {
    if (!actor) return;
    setBusy(true);
    try {
      await approveUser(target.uid, actor);
      toast.success(t('common.success'));
      await list.reload();
      setSelected(null);
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  const handleStatus = async (target: AppUser, status: UserStatus) => {
    if (!actor) return;
    setBusy(true);
    try {
      await setStatus(target.uid, status, actor);
      toast.success(t('common.success'));
      await list.reload();
      setSelected(null);
      setConfirm(null);
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (target: AppUser) => {
    if (!actor) return;
    setBusy(true);
    try {
      await removeUser(target.uid, actor);
      list.removeLocal(target.id);
      toast.success(t('common.success'));
      setSelected(null);
      setConfirm(null);
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  const handleResetEmail = async (target: AppUser) => {
    try {
      await sendResetEmail(target.email);
      toast.success(t('auth.resetEmailSent'));
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    }
  };

  return (
    <Screen refreshing={list.refreshing} onRefresh={list.refresh} edges={['bottom']}>
      <View style={styles.toolbar}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {canCreate ? (
          <Button
            label={t('common.add')}
            icon="add"
            size="sm"
            onPress={() => setCreating(true)}
          />
        ) : null}
      </View>

      <SearchField
        value={term}
        onChangeText={setTerm}
        placeholder={`${t('common.search')} — ${t('auth.fullName')}, ${t('auth.username')}, ${t('auth.email')}`}
      />

      <Spacer size={spacing.md} />

      {!role ? (
        <ChipGroup<UserRole | 'all'>
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'student', label: t('admin.roleStudent') },
            { value: 'teacher', label: t('admin.roleTeacher') },
            { value: 'admin', label: t('admin.roleAdmin') },
          ]}
          value={roleFilter}
          onChange={setRoleFilter}
        />
      ) : null}

      <ChipGroup<UserStatus | 'all'>
        options={[
          { value: 'all', label: t('common.all') },
          { value: 'active', label: t('common.active') },
          { value: 'pending', label: t('common.pending') },
          { value: 'inactive', label: t('common.inactive') },
          { value: 'suspended', label: t('common.suspended') },
        ]}
        value={statusFilter}
        onChange={setStatusFilter}
        style={{ marginTop: spacing.sm }}
      />

      <Spacer />

      <AsyncBoundary
        loading={list.loading}
        error={list.error}
        empty={list.items.length === 0}
        onRetry={list.reload}
        skeleton={<SkeletonList count={6} />}
        emptyProps={{ icon: 'people-outline', title: t('common.noResults') }}
      >
        <View style={{ gap: spacing.md }}>
          {list.items.map((item) => (
            <Card key={item.id} onPress={() => setSelected(item)} accessibilityLabel={item.fullName}>
              <View style={styles.row}>
                <Avatar name={item.fullName} uri={item.profileImage} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {item.fullName}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    @{item.username} · {item.studentId ?? item.teacherId ?? humanise(item.role)}
                  </Text>
                  <Text style={styles.rowMeta} numberOfLines={1}>
                    {item.email}
                  </Text>
                </View>
                <View style={styles.rowEnd}>
                  <StatusBadge status={item.status} />
                  {item.status === 'pending' && canEdit ? (
                    <Pressable
                      onPress={() => handleApprove(item)}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={t('admin.approve')}
                      style={styles.approveButton}
                    >
                      <Ionicons name="checkmark" size={16} color={colors.success} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
            </Card>
          ))}

          {list.hasMore ? (
            <Button
              label={t('common.loadMore')}
              onPress={list.loadMore}
              loading={list.loadingMore}
              variant="outline"
            />
          ) : null}
        </View>
      </AsyncBoundary>

      <Spacer size={spacing.xxxl} />

      {/* --- Detail sheet --- */}
      <FormSheet
        visible={Boolean(selected)}
        title={selected?.fullName ?? ''}
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <>
            <View style={styles.detailHeader}>
              <Avatar name={selected.fullName} uri={selected.profileImage} size={72} />
              <Text style={styles.detailName}>{selected.fullName}</Text>
              <Text style={styles.rowMeta}>@{selected.username}</Text>
              <View style={styles.detailBadges}>
                <Badge label={humanise(selected.role)} tone="active" />
                <StatusBadge status={selected.status} />
              </View>
            </View>

            <Card>
              <DetailRow label={t('auth.email')} value={selected.email} icon="mail-outline" />
              <Divider />
              <DetailRow label={t('auth.mobile')} value={selected.mobile} icon="call-outline" />
              <Divider />
              <DetailRow label={t('auth.country')} value={selected.country} icon="globe-outline" />
              <Divider />
              <DetailRow
                label={selected.role === 'student' ? t('auth.studentId') : t('auth.teacherId')}
                value={selected.studentId ?? selected.teacherId}
                icon="card-outline"
              />
              {selected.role === 'teacher' ? (
                <>
                  <Divider />
                  <DetailRow
                    label={t('auth.qualification')}
                    value={selected.qualification}
                    icon="ribbon-outline"
                  />
                </>
              ) : null}
            </Card>

            <Spacer />

            <SectionHeader title={t('common.actions')} icon="options-outline" />
            <View style={{ gap: spacing.md }}>
              {canEdit ? (
                <Button
                  label={t('common.edit')}
                  icon="create-outline"
                  variant="outline"
                  fullWidth
                  onPress={() => {
                    setEditing(selected);
                    setSelected(null);
                  }}
                />
              ) : null}

              {selected.role === 'teacher' && can('MANAGE_USERS') ? (
                <Button
                  label={t('admin.managePermissions')}
                  icon="key-outline"
                  variant="outline"
                  fullWidth
                  onPress={() => {
                    const target = selected;
                    setSelected(null);
                    router.push({
                      pathname: '/(admin)/permissions',
                      params: { uid: target.uid },
                    });
                  }}
                />
              ) : null}

              {canEdit ? (
                <Button
                  label={t('admin.resetUserPassword')}
                  icon="mail-outline"
                  variant="outline"
                  fullWidth
                  onPress={() => handleResetEmail(selected)}
                />
              ) : null}

              {canEdit && selected.status === 'pending' ? (
                <Button
                  label={t('admin.approve')}
                  icon="checkmark-circle-outline"
                  fullWidth
                  loading={busy}
                  onPress={() => handleApprove(selected)}
                />
              ) : null}

              {canEdit && selected.status === 'active' ? (
                <Button
                  label={t('admin.deactivate')}
                  icon="pause-circle-outline"
                  variant="outline"
                  fullWidth
                  onPress={() => setConfirm({ user: selected, action: 'deactivate' })}
                />
              ) : null}

              {canEdit && selected.status !== 'active' ? (
                <Button
                  label={t('admin.activate')}
                  icon="play-circle-outline"
                  fullWidth
                  loading={busy}
                  onPress={() => handleStatus(selected, 'active')}
                />
              ) : null}

              {canDelete ? (
                <Button
                  label={t('common.delete')}
                  icon="trash-outline"
                  variant="danger"
                  fullWidth
                  onPress={() => setConfirm({ user: selected, action: 'delete' })}
                />
              ) : null}
            </View>
          </>
        ) : null}
      </FormSheet>

      {/* --- Create / edit --- */}
      <UserForm
        visible={creating || Boolean(editing)}
        existing={editing}
        role={role ?? 'student'}
        onClose={() => {
          setCreating(false);
          setEditing(null);
          if (params.action === 'new') router.setParams({ action: undefined });
        }}
        onSaved={async () => {
          setCreating(false);
          setEditing(null);
          await list.reload();
        }}
      />

      <ConfirmDialog
        visible={Boolean(confirm)}
        title={t(confirm?.action === 'delete' ? 'confirm.deleteTitle' : 'confirm.deactivateTitle')}
        message={t(
          confirm?.action === 'delete' ? 'confirm.deleteMessage' : 'confirm.deactivateMessage'
        )}
        confirmLabel={t(confirm?.action === 'delete' ? 'common.delete' : 'admin.deactivate')}
        destructive
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.action === 'delete') void handleDelete(confirm.user);
          else void handleStatus(confirm.user, 'inactive');
        }}
      />
    </Screen>
  );
}

/** Create or edit a user. Creating also provisions the Firebase Auth account. */
function UserForm({
  visible,
  existing,
  role,
  onClose,
  onSaved,
}: {
  visible: boolean;
  existing: AppUser | null;
  role: Extract<UserRole, 'student' | 'teacher'>;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { user: actor } = useAuth();
  const toast = useToast();

  const isEdit = Boolean(existing);
  const effectiveRole = (existing?.role as 'student' | 'teacher') ?? role;

  const [form, setForm] = useState({
    fullName: '',
    username: '',
    email: '',
    mobile: '',
    country: '',
    password: '',
    confirmPassword: '',
    dateOfBirth: '',
    gender: '' as 'male' | 'female' | '',
    qualification: '',
    branchId: '',
    classId: '',
    language: 'en' as LanguageCode,
    status: 'active' as UserStatus,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const loadOrg = useCallback(async () => {
    const [countries, branches] = await Promise.all([
      listCountries().catch(() => [] as Country[]),
      listBranches().catch(() => [] as Branch[]),
    ]);
    return { countries, branches };
  }, []);

  const { data: org } = useAsync(loadOrg, [visible], { enabled: visible });
  const [classes, setClasses] = useState<ClassRoom[]>([]);

  useEffect(() => {
    if (!form.branchId) {
      setClasses([]);
      return;
    }
    listClasses({ branchId: form.branchId })
      .then((page) => setClasses(page.items))
      .catch(() => undefined);
  }, [form.branchId]);

  useEffect(() => {
    if (!visible) return;
    setErrors({});
    if (existing) {
      setForm({
        fullName: existing.fullName,
        username: existing.username,
        email: existing.email,
        mobile: existing.mobile,
        country: existing.country,
        password: '',
        confirmPassword: '',
        dateOfBirth: existing.dateOfBirth ?? '',
        gender: existing.gender ?? '',
        qualification: existing.qualification ?? '',
        branchId: existing.branchId ?? '',
        classId: existing.classId ?? '',
        language: existing.language,
        status: existing.status,
      });
    } else {
      setForm({
        fullName: '',
        username: '',
        email: '',
        mobile: '',
        country: '',
        password: '',
        confirmPassword: '',
        dateOfBirth: '',
        gender: '',
        qualification: '',
        branchId: '',
        classId: '',
        language: 'en',
        status: 'active',
      });
    }
  }, [visible, existing]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setErrors((previous) => {
      if (!previous[key as string]) return previous;
      const next = { ...previous };
      delete next[key as string];
      return next;
    });
  };

  const countryOptions = useMemo<Option[]>(
    () => (org?.countries ?? []).map((c) => ({ value: c.code, label: c.name })),
    [org?.countries]
  );
  const branchOptions = useMemo<Option[]>(
    () =>
      (org?.branches ?? [])
        .filter((b) => !form.country || b.countryCode === form.country)
        .map((b) => ({ value: b.id, label: b.name, description: b.city })),
    [org?.branches, form.country]
  );
  const classOptions = useMemo<Option[]>(
    () => classes.map((c) => ({ value: c.id, label: c.name })),
    [classes]
  );

  const handleSubmit = async () => {
    if (!actor) return;

    if (isEdit && existing) {
      if (form.fullName.trim().length < 2) {
        setErrors({ fullName: 'validation.nameRequired' });
        return;
      }
      setBusy(true);
      try {
        await updateUser(
          existing.uid,
          {
            fullName: form.fullName.trim(),
            mobile: form.mobile.trim(),
            country: form.country,
            branchId: form.branchId || null,
            classId: effectiveRole === 'student' ? form.classId || null : null,
            language: form.language,
            status: form.status,
            ...(effectiveRole === 'student'
              ? { dateOfBirth: form.dateOfBirth || null, gender: form.gender || null }
              : { qualification: form.qualification.trim() }),
          },
          actor
        );
        toast.success(t('profile.profileUpdated'));
        await onSaved();
      } catch (error) {
        toast.error(friendlyMessage(error, t));
      } finally {
        setBusy(false);
      }
      return;
    }

    const parsed = validate(
      effectiveRole === 'student' ? studentRegistrationSchema : teacherRegistrationSchema,
      {
        fullName: form.fullName,
        username: form.username,
        email: form.email,
        mobile: form.mobile,
        country: form.country,
        language: form.language,
        password: form.password,
        confirmPassword: form.confirmPassword,
        branchId: form.branchId || null,
        ...(effectiveRole === 'student'
          ? { dateOfBirth: form.dateOfBirth, gender: form.gender || null, classId: form.classId || null }
          : { qualification: form.qualification }),
      }
    );
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }

    setBusy(true);
    try {
      const created = await createUserAsAdmin(
        {
          role: effectiveRole,
          fullName: form.fullName,
          username: form.username,
          email: form.email,
          password: form.password,
          mobile: form.mobile,
          country: form.country,
          language: form.language,
          branchId: form.branchId || null,
          classId: effectiveRole === 'student' ? form.classId || null : null,
          dateOfBirth: effectiveRole === 'student' ? form.dateOfBirth : null,
          gender: effectiveRole === 'student' ? form.gender || null : null,
          qualification: effectiveRole === 'teacher' ? form.qualification : undefined,
          status: form.status,
        },
        actor
      );
      toast.success(`${t('common.success')} · ${created.generatedId}`);
      await onSaved();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet
      visible={visible}
      title={
        isEdit
          ? t('common.edit')
          : effectiveRole === 'student'
            ? t('dashboard.addStudent')
            : t('dashboard.addTeacher')
      }
      onClose={onClose}
      onSubmit={handleSubmit}
      submitting={busy}
      submitLabel={isEdit ? t('common.save') : t('common.create')}
    >
      <TextField
        label={t('auth.fullName')}
        value={form.fullName}
        onChangeText={(v) => set('fullName', v)}
        error={errors.fullName}
        icon="person-outline"
        required
      />
      <TextField
        label={t('auth.username')}
        value={form.username}
        onChangeText={(v) => set('username', v.toLowerCase().replace(/\s/g, ''))}
        error={errors.username}
        icon="at-outline"
        autoCapitalize="none"
        editable={!isEdit}
        hint={isEdit ? t('common.required') : undefined}
        required
      />
      <EmailField
        label={t('auth.email')}
        value={form.email}
        onChangeText={(v) => set('email', v)}
        error={errors.email}
        editable={!isEdit}
        required
      />
      <TextField
        label={t('auth.mobile')}
        value={form.mobile}
        onChangeText={(v) => set('mobile', v)}
        error={errors.mobile}
        icon="call-outline"
        keyboardType="phone-pad"
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
        searchable
        required
      />
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
      {effectiveRole === 'student' ? (
        <>
          <Select
            label={t('auth.class')}
            value={form.classId}
            options={classOptions}
            onChange={(v) => set('classId', v)}
            allowClear
          />
          <DateField
            label={t('auth.dateOfBirth')}
            value={form.dateOfBirth}
            onChange={(v) => set('dateOfBirth', v)}
            error={errors.dateOfBirth}
            required={!isEdit}
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
          required={!isEdit}
        />
      )}

      <Select<UserStatus>
        label={t('common.status')}
        value={form.status}
        options={[
          { value: 'active', label: t('common.active') },
          { value: 'pending', label: t('common.pending') },
          { value: 'inactive', label: t('common.inactive') },
          { value: 'suspended', label: t('common.suspended') },
        ]}
        onChange={(v) => set('status', v)}
      />

      {!isEdit ? (
        <>
          <PasswordField
            label={t('auth.password')}
            value={form.password}
            onChangeText={(v) => set('password', v)}
            error={errors.password}
            icon="lock-closed-outline"
            hint={t('auth.passwordHint')}
            required
          />
          <PasswordField
            label={t('auth.confirmPassword')}
            value={form.confirmPassword}
            onChangeText={(v) => set('confirmPassword', v)}
            error={errors.confirmPassword}
            icon="lock-closed-outline"
            required
          />
        </>
      ) : null}
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.lg,
    paddingTop: spacing.sm,
  },
  title: { flex: 1, fontSize: fontSize.xxl, fontWeight: fontWeight.bold, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  rowMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  rowEnd: { alignItems: 'flex-end', gap: spacing.sm },
  approveButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailHeader: { alignItems: 'center', marginBottom: spacing.xl },
  detailName: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: spacing.md,
  },
  detailBadges: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
});
