import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { useAsync, useDebounced, usePaginated } from '@/hooks/useAsync';
import { friendlyMessage } from '@/utils/errors';
import { humanise } from '@/utils/format';
import { DEFAULT_DIAL, formatPhone, localTenDigits } from '@/utils/phone';
import { validate, studentRegistrationSchema, teacherRegistrationSchema } from '@/utils/validation';
import {
  approveUser,
  createUserAsAdmin,
  listUsers,
  removeUser,
  requirePasswordChange,
  requirePasswordChangeForAll,
  sendResetEmail,
  setStatus,
  updateUser,
  changeUsername,
} from '@/services/userService';
import { listBranches, listClasses, listCountries } from '@/services/orgService';
import {
  clearReset,
  requestReset,
  watchPending,
  type PasswordResetRequest,
} from '@/services/passwordResetService';
import { canSetPassword, setPassword } from '@/services/passwordChangeService';
import type { AppUser, Branch, ClassRoom, Country, LanguageCode, UserRole, UserStatus } from '@/types';
import {
  PhoneField,
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
  ToggleRow,
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
  /** Set while the "everyone" version is waiting to be confirmed. */
  const [confirmResetAll, setConfirmResetAll] = useState(false);

  /**
   * Reset links, live.
   *
   * The link is minted by the machine running the notification sender, not by
   * this app, so there is nothing here to await — it simply appears. Watching
   * is the only honest way to show it.
   */
  const [resets, setResets] = useState<PasswordResetRequest[]>([]);

  useEffect(() => {
    if (!can('MANAGE_USERS')) return undefined;
    return watchPending(setResets, () => setResets([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [confirm, setConfirm] = useState<{ user: AppUser; action: 'delete' | 'deactivate' } | null>(
    null
  );
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<AppUser | null>(null);
  const [nextUsername, setNextUsername] = useState('');
  const [renameError, setRenameError] = useState<string | undefined>();

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
        {/* Requiring it of everybody at once. Beside Add rather than buried
            in a menu, because it is a thing an admin does deliberately after
            something has gone wrong and needs to be findable then. */}
        {can('MANAGE_USERS') ? (
          <Button
            label={t('auth.requireResetAll')}
            icon="key-outline"
            variant="outline"
            size="sm"
            onPress={() => setConfirmResetAll(true)}
          />
        ) : null}
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
              <DetailRow
                label={t('auth.mobile')}
                value={formatPhone(selected.mobile, selected.mobileCountryCode)}
                icon="call-outline"
              />
              <Divider />
              <DetailRow label={t('auth.country')} value={selected.country} icon="globe-outline" />
              <Divider />
              <DetailRow
                label={selected.role === 'student' ? t('auth.studentId') : t('auth.teacherId')}
                value={selected.studentId ?? selected.teacherId}
                icon="card-outline"
              />
              {selected.role === 'student' ? (
                <>
                  <Divider />
                  {/* Who teaches them, allocated by the group they joined
                      rather than chosen by anybody. Shown here because an
                      admin asking "who has this student?" should not have to
                      open the class group to find out. */}
                  <DetailRow
                    label={t('admin.allocatedTeachers')}
                    value={
                      (selected.assignedTeacherNames ?? []).filter(Boolean).join(', ') ||
                      t('admin.allocatedTeachersNone')
                    }
                    icon="person-circle-outline"
                  />
                </>
              ) : null}
              {selected.role === 'teacher' ? (
                <>
                  <Divider />
                  <DetailRow
                    label={t('auth.qualification')}
                    value={selected.qualification}
                    icon="ribbon-outline"
                  />
                  <Divider />
                  {/* Whether this person is on the public website, said plainly
                      on the sheet rather than only inside the edit form — where
                      it sits below a dozen fields and is easy to miss. */}
                  <DetailRow
                    label={t('admin.publicProfile')}
                    value={
                      selected.publicProfile
                        ? [t('admin.publicProfileOn'), selected.publicSubjects]
                            .filter(Boolean)
                            .join(' — ')
                        : t('admin.publicProfileOff')
                    }
                    icon={selected.publicProfile ? 'globe-outline' : 'eye-off-outline'}
                  />
                </>
              ) : null}
            </Card>

            <Spacer />

            <SectionHeader title={t('common.actions')} icon="options-outline" />
            <View style={{ gap: spacing.md }}>
              {/* Requires a new password of this one person. Their current one
                  keeps working until they set it — see requirePasswordChange
                  for why a client cannot do more than that. */}
              {/* Mints a one-time link the admin hands over. Works for the
                  mobile-only accounts a reset email can never reach, and
                  ends with the old password dead — which the flag-only
                  version above cannot do. */}
              {can('MANAGE_USERS') ? (
                <Button
                  label={t('auth.resetLink')}
                  icon="link-outline"
                  variant="outline"
                  fullWidth
                  onPress={() => {
                    const target = selected;
                    setSelected(null);
                    void (async () => {
                      try {
                        await requestReset(target, actor!);
                        toast.success(t('auth.resetLinkRequested'));
                      } catch (error) {
                        toast.error(friendlyMessage(error, t));
                      }
                    })();
                  }}
                />
              ) : null}

              {can('MANAGE_USERS') ? (
                <Button
                  label={t('auth.requireReset')}
                  icon="key-outline"
                  variant="outline"
                  fullWidth
                  loading={busy}
                  onPress={() => {
                    const target = selected;
                    setSelected(null);
                    void (async () => {
                      try {
                        await requirePasswordChange([target.uid], actor!);
                        toast.success(t('auth.requireResetDone', { count: 1 }));
                      } catch (error) {
                        toast.error(friendlyMessage(error, t));
                      }
                    })();
                  }}
                />
              ) : null}

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

              {/* Publishing in one tap, for the common case: a name and a
                  qualification are already on the account, so turning the
                  profile on needs no typing. The subjects line and the switch
                  itself also live in the edit form, and both routes go through
                  updateUser — which is what withdraws the public copy when this
                  is turned back off. */}
              {selected.role === 'teacher' && canEdit ? (
                <Button
                  label={
                    selected.publicProfile
                      ? t('admin.publicProfileHide')
                      : t('admin.publicProfileShow')
                  }
                  icon={selected.publicProfile ? 'eye-off-outline' : 'globe-outline'}
                  variant="outline"
                  fullWidth
                  onPress={() => {
                    const target = selected;
                    const next = !target.publicProfile;
                    setSelected(null);
                    void (async () => {
                      try {
                        await updateUser(target.uid, { publicProfile: next }, actor!);
                        toast.success(
                          next ? t('admin.publicProfileShown') : t('admin.publicProfileHidden')
                        );
                        list.refresh();
                      } catch (error) {
                        toast.error(friendlyMessage(error, t));
                      }
                    })();
                  }}
                />
              ) : null}

              {/* An admin renames any student or teacher. Another admin's
                  username stays super-admin work, which firestore.rules also
                  enforces - this only decides whether to offer the button. An
                  admin renames THEMSELVES from Account Settings. */}
              {actor?.role === 'admin' &&
              actor.uid !== selected.uid &&
              (selected.role !== 'admin' || actor.superAdmin === true) ? (
                <Button
                  label={t('profile.changeUsername')}
                  icon="person-outline"
                  variant="outline"
                  fullWidth
                  onPress={() => {
                    setRenaming(selected);
                    // A username from before the 10-digit rule is offered its
                    // replacement: the account's own number, in that form.
                    setNextUsername(
                      /^[0-9]{10}$/.test(selected.username ?? '')
                        ? selected.username
                        : localTenDigits(selected.mobile)
                    );
                    setSelected(null);
                  }}
                />
              ) : null}

              {/* Students too, not only teachers.
                  A centre may want a senior student marking attendance, and
                  the rules now honour a granted permission whoever holds it —
                  see `can()` in firestore.rules. Admins are excluded because
                  they already hold everything; a screen offering to grant them
                  something would be a screen that does nothing. */}
              {selected.role !== 'admin' && can('MANAGE_USERS') ? (
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

      {/* --- Rename --- */}
      <FormSheet
        visible={Boolean(renaming)}
        title={t('profile.changeUsername')}
        onClose={() => setRenaming(null)}
        submitting={busy}
        onSubmit={async () => {
          if (!renaming || !actor) return;
          setBusy(true);
          setRenameError(undefined);
          try {
            await changeUsername(renaming.uid, nextUsername, actor);
            setRenaming(null);
            toast.success(t('profile.usernameChanged'));
            list.refresh();
          } catch (error) {
            setRenameError(friendlyMessage(error, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField
          label={t('auth.username')}
          value={nextUsername}
          onChangeText={(v) => setNextUsername(v.replace(/[^0-9]/g, '').slice(0, 10))}
          error={renameError}
          autoCapitalize="none"
          keyboardType="number-pad"
          maxLength={10}
          icon="person-outline"
          hint={`${t('auth.usernameRule')} ${t('profile.changeUsernameHint')}`}
        />
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

      {/* The message says plainly that existing passwords keep working. An
          admin reaching for this is usually reacting to a leak, and letting
          them believe it cuts access off would be the harmful kind of wrong. */}
      {/* Above everything, because an admin who pressed the button is
          waiting for exactly this and should not have to hunt for it. */}
      {resets.length > 0 ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <SectionHeader title={t('auth.resetLinks')} icon="link-outline" />
          {resets.map((row) => (
            <View key={row.id} style={styles.resetRow}>
              <Text style={styles.resetName}>{row.userName}</Text>

              {row.status === 'pending' ? (
                <Text style={styles.resetNote}>{t('auth.resetLinkPending')}</Text>
              ) : row.status === 'failed' ? (
                <Text style={styles.resetFailed}>{row.error}</Text>
              ) : (
                <>
                  <Text style={styles.resetNote}>{t('auth.resetLinkReady')}</Text>
                  {/* Selectable rather than only copyable: on a phone the
                      clipboard is not always available and the link still
                      has to be gettable. */}
                  <Text selectable style={styles.resetLink}>
                    {row.link}
                  </Text>
                </>
              )}

              <View style={styles.resetActions}>
                {row.status === 'ready' && row.link ? (
                  <Button
                    label={t('common.copy')}
                    icon="copy-outline"
                    size="sm"
                    variant="outline"
                    onPress={() => {
                      void navigator.clipboard
                        ?.writeText(row.link!)
                        .then(() => toast.success(t('common.copied')))
                        .catch(() => undefined);
                    }}
                  />
                ) : null}
                <Button
                  label={t('common.done')}
                  icon="checkmark"
                  size="sm"
                  variant="ghost"
                  onPress={() => void clearReset(row.id)}
                />
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      <ConfirmDialog
        visible={confirmResetAll}
        title={t('auth.requireResetAll')}
        message={t('auth.requireResetConfirm')}
        confirmLabel={t('common.confirm')}
        loading={busy}
        onCancel={() => setConfirmResetAll(false)}
        onConfirm={() => {
          setConfirmResetAll(false);
          void (async () => {
            try {
              const count = await requirePasswordChangeForAll(actor!);
              toast.success(t('auth.requireResetDone', { count }));
              list.refresh();
            } catch (error) {
              toast.error(friendlyMessage(error, t));
            }
          })();
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
    mobileCountryCode: DEFAULT_DIAL,
    country: '',
    password: '',
    confirmPassword: '',
    dateOfBirth: '',
    gender: '' as 'male' | 'female' | '',
    qualification: '',
    publicProfile: false,
    publicSubjects: '',
    branchId: '',
    classId: '',
    language: 'en' as LanguageCode,
    status: 'active' as UserStatus,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  // Set once somebody types a username themselves; until then it follows the
  // phone number.
  const [usernameTouched, setUsernameTouched] = useState(false);

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
    setUsernameTouched(false);
    if (existing) {
      setForm({
        fullName: existing.fullName,
        username: existing.username,
        email: existing.email,
        mobile: existing.mobile,
        mobileCountryCode: existing.mobileCountryCode ?? DEFAULT_DIAL,
        country: existing.country,
        password: '',
        confirmPassword: '',
        dateOfBirth: existing.dateOfBirth ?? '',
        gender: existing.gender ?? '',
        qualification: existing.qualification ?? '',
        publicProfile: existing.publicProfile ?? false,
        publicSubjects: existing.publicSubjects ?? '',
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
        mobileCountryCode: DEFAULT_DIAL,
        country: '',
        password: '',
        confirmPassword: '',
        dateOfBirth: '',
        gender: '',
        qualification: '',
        // Off for somebody who does not exist yet. Publishing a person is a
        // decision somebody makes about them, never a default they inherit.
        publicProfile: false,
        publicSubjects: '',
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
      (org?.branches ?? []).map((b) => ({
        value: b.id,
        label: b.name,
        description: [b.city, countryName(org?.countries ?? [], b.countryCode)]
          .filter(Boolean)
          .join(', '),
      })),
    [org?.branches, org?.countries]
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
      // Checked before anything is saved, so a rejected password does not
      // leave the rest of the edit half-applied.
      const newPassword = form.password.trim();
      if (newPassword && newPassword.length < 6) {
        setErrors({ password: 'validation.passwordTooShort' });
        return;
      }

      setBusy(true);
      try {
        // A changed username goes first, through the rename that moves its
        // sign-in row - so a name that is taken is reported on the field and
        // nothing else has been saved yet.
        const nextUsername = form.username.trim().toLowerCase();
        if (actor.role === 'admin' && nextUsername && nextUsername !== existing.username) {
          try {
            await changeUsername(existing.uid, nextUsername, actor);
          } catch (error) {
            setErrors({ username: friendlyMessage(error, t) });
            return;
          }
        }
        await updateUser(
          existing.uid,
          {
            fullName: form.fullName.trim(),
            mobile: form.mobile.trim(),
            mobileCountryCode: form.mobileCountryCode,
            country: form.country,
            branchId: form.branchId || null,
            classId: effectiveRole === 'student' ? form.classId || null : null,
            language: form.language,
            status: form.status,
            ...(effectiveRole === 'student'
              ? { dateOfBirth: form.dateOfBirth || null, gender: form.gender || null }
              : {
                qualification: form.qualification.trim(),
                publicProfile: form.publicProfile,
                publicSubjects: form.publicSubjects.trim(),
              }),
          },
          actor
        );
        // After the profile, because a password change is applied by another
        // machine a moment later and should not be queued against an edit
        // that then failed to save.
        if (newPassword) {
          await setPassword(existing, newPassword, actor);
          toast.success(t('auth.passwordQueued'));
        } else {
          toast.success(t('profile.profileUpdated'));
        }
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
          mobileCountryCode: form.mobileCountryCode,
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
        onChangeText={(v) => {
          setUsernameTouched(true);
          set('username', v.replace(/[^0-9]/g, '').slice(0, 10));
        }}
        error={errors.username}
        icon="at-outline"
        autoCapitalize="none"
        keyboardType="number-pad"
        maxLength={10}
        // An admin can always change it; it stays unique, checked on save.
        editable={!isEdit || actor?.role === 'admin'}
        hint={t('auth.usernameRule')}
        required
      />
      <EmailField
        label={t('auth.email')}
        value={form.email}
        onChangeText={(v) => set('email', v)}
        error={errors.email}
        editable={!isEdit}
        hint={!isEdit ? t('auth.emailOptionalHint') : undefined}
      />
      <PhoneField
        label={t('auth.mobile')}
        dial={form.mobileCountryCode}
        onDialChange={(dial) => set('mobileCountryCode', dial)}
        value={form.mobile}
        onChangeText={(v) => {
          set('mobile', v);
          // The username is the phone number without its country code, and
          // follows the number until a username is typed by hand. When
          // editing, only where the username was the old number (or was not
          // a number at all), so a deliberately different one is left alone.
          const follows =
            !usernameTouched &&
            (!isEdit ||
              !/^[0-9]{10}$/.test(existing?.username ?? '') ||
              existing?.username === localTenDigits(existing?.mobile));
          const next = localTenDigits(v);
          if (follows && next) set('username', next);
        }}
        error={errors.mobile}
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
        <>
          <TextField
            label={t('auth.qualification')}
            value={form.qualification}
            onChangeText={(v) => set('qualification', v)}
            error={errors.qualification}
            icon="ribbon-outline"
          />

          {/*
            The public profile, and the one field it publishes that is not
            already on this form.

            Off unless somebody turns it on, per teacher. The public Teachers
            page reads a separate document that only exists while this is on —
            see publicSiteService — so switching it off takes the profile down
            rather than merely hiding it behind a flag.
          */}
          <ToggleRow
            label={t('admin.publicProfile')}
            description={t('admin.publicProfileHint')}
            value={form.publicProfile}
            onValueChange={(v) => set('publicProfile', v)}
          />

          {form.publicProfile ? (
            <TextField
              label={t('admin.publicSubjects')}
              value={form.publicSubjects}
              onChangeText={(v) => set('publicSubjects', v)}
              icon="book-outline"
            />
          ) : null}
        </>
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

      {/* Editing: setting a password is optional, and left blank changes
          nothing. Only offered where the browser can encrypt it — the
          password is sealed before it is written, so a device without Web
          Crypto cannot offer this safely and does not pretend to. */}
      {isEdit && canSetPassword() ? (
        <PasswordField
          label={t('auth.newPasswordOptional')}
          value={form.password}
          onChangeText={(v) => set('password', v)}
          error={errors.password}
          icon="lock-closed-outline"
          hint={t('auth.newPasswordOptionalHint')}
        />
      ) : null}

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
  resetRow: { gap: spacing.xs, paddingVertical: spacing.sm },
  resetName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  resetNote: { fontSize: fontSize.xs, color: colors.textMuted },
  resetFailed: { fontSize: fontSize.xs, color: colors.danger },
  resetLink: {
    fontSize: fontSize.xs,
    color: colors.primary,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  resetActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
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

/** A country's name from its code, for labelling a branch by where it is. */
function countryName(countries: Country[], code?: string): string {
  if (!code) return '';
  return countries.find((c) => c.code === code)?.name ?? code;
}
