import React, { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import { APP_NAME } from '@/constants/app';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { humanise } from '@/utils/format';
import { passwordSchema, validate } from '@/utils/validation';
import { useAsync } from '@/hooks/useAsync';
import { changePassword } from '@/services/authService';
import { updateUser } from '@/services/userService';
import { getBranch, getClass } from '@/services/orgService';
import * as storageService from '@/services/storageService';
import type { LanguageCode } from '@/types';
import {
  AppHeader,
  Avatar,
  Button,
  Card,
  ConfirmDialog,
  DetailRow,
  Divider,
  FormSheet,
  PasswordField,
  Screen,
  SectionHeader,
  Select,
  Spacer,
  StatusBadge,
  TextField,
} from '@/components/ui';

/**
 * Profile screen for every role. The fields shown adapt to the role, and
 * everything a user is allowed to change about themselves lives here.
 */
export function ProfileScreen() {
  const { t } = useTranslation();
  const { user, logout, refresh } = useAuth();
  const { language, available, setLanguage } = useLanguage();
  const toast = useToast();

  const [editing, setEditing] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [form, setForm] = useState({ fullName: '', mobile: '', qualification: '' });
  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const loadContext = useCallback(async () => {
    if (!user) return { branchName: null, className: null };
    const [branch, klass] = await Promise.all([
      user.branchId ? getBranch(user.branchId).catch(() => null) : Promise.resolve(null),
      user.classId ? getClass(user.classId).catch(() => null) : Promise.resolve(null),
    ]);
    return { branchName: branch?.name ?? null, className: klass?.name ?? null };
  }, [user]);

  const { data: context } = useAsync(loadContext, [user?.branchId, user?.classId]);

  if (!user) return null;

  const openEdit = () => {
    setForm({
      fullName: user.fullName,
      mobile: user.mobile,
      qualification: user.qualification ?? '',
    });
    setErrors({});
    setEditing(true);
  };

  const handleSaveProfile = async () => {
    if (form.fullName.trim().length < 2) {
      setErrors({ fullName: 'validation.nameRequired' });
      return;
    }
    setBusy(true);
    try {
      await updateUser(
        user.uid,
        {
          fullName: form.fullName.trim(),
          mobile: form.mobile.trim(),
          ...(user.role === 'teacher' ? { qualification: form.qualification.trim() } : {}),
        },
        user
      );
      await refresh();
      toast.success(t('profile.profileUpdated'));
      setEditing(false);
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  const handleChangePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.error(t('errors.permissionDenied'));
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });
    if (picked.canceled || !picked.assets[0]) return;

    const asset = picked.assets[0];
    setUploading(true);
    try {
      const uploaded = await storageService.upload({
        uri: asset.uri,
        fileName: asset.fileName ?? `avatar-${user.uid}.jpg`,
        kind: 'avatar',
        ownerId: user.uid,
        contentType: asset.mimeType ?? 'image/jpeg',
      });
      await updateUser(user.uid, { profileImage: uploaded.url }, user);
      await refresh();
      toast.success(t('profile.profileUpdated'));
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setUploading(false);
    }
  };

  const handleChangePassword = async () => {
    const parsed = validate(passwordSchema, passwords.next);
    if (!parsed.ok) {
      setErrors({ next: parsed.errors._form ?? 'validation.passwordTooShort' });
      return;
    }
    if (passwords.next !== passwords.confirm) {
      setErrors({ confirm: 'validation.passwordsDoNotMatch' });
      return;
    }

    setBusy(true);
    try {
      await changePassword(passwords.current, passwords.next);
      toast.success(t('profile.passwordChanged'));
      setChangingPassword(false);
      setPasswords({ current: '', next: '', confirm: '' });
      setErrors({});
    } catch (error) {
      setErrors({ current: friendlyMessage(error, t) });
    } finally {
      setBusy(false);
    }
  };

  const isStudent = user.role === 'student';
  const isTeacher = user.role === 'teacher';

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('profile.title')} />

      <Screen>
        <Card style={styles.headerCard}>
          <Avatar name={user.fullName} uri={user.profileImage} size={88} />
          <Text style={styles.name} accessibilityRole="header">
            {user.fullName}
          </Text>
          <Text style={styles.username}>@{user.username}</Text>
          <View style={styles.badgeRow}>
            <View style={styles.roleBadge}>
              <Ionicons
                name={
                  user.role === 'admin'
                    ? 'shield-checkmark'
                    : user.role === 'teacher'
                      ? 'people'
                      : 'school'
                }
                size={13}
                color={brand.navyDeep}
              />
              <Text style={styles.roleBadgeText}>
                {t(`admin.role${user.role.charAt(0).toUpperCase()}${user.role.slice(1)}`)}
              </Text>
            </View>
            <StatusBadge status={user.status} />
          </View>

          <View style={styles.headerActions}>
            <Button
              label={t('profile.changePhoto')}
              icon="camera-outline"
              variant="outline"
              size="sm"
              loading={uploading}
              onPress={handleChangePhoto}
            />
            <Button
              label={t('profile.editProfile')}
              icon="create-outline"
              size="sm"
              onPress={openEdit}
            />
          </View>
        </Card>

        <Spacer />

        <SectionHeader title={t('profile.personalDetails')} icon="person-outline" />
        <Card>
          <DetailRow label={t('auth.email')} value={user.email} icon="mail-outline" />
          <Divider />
          <DetailRow label={t('auth.mobile')} value={user.mobile} icon="call-outline" />
          <Divider />
          <DetailRow label={t('auth.country')} value={user.country} icon="globe-outline" />
          {isStudent ? (
            <>
              <Divider />
              <DetailRow
                label={t('auth.dateOfBirth')}
                value={user.dateOfBirth}
                icon="calendar-outline"
              />
              <Divider />
              <DetailRow
                label={t('auth.gender')}
                value={user.gender ? t(`auth.${user.gender}`) : null}
                icon="person-outline"
              />
            </>
          ) : null}
        </Card>

        <Spacer />

        <SectionHeader
          title={isTeacher ? t('profile.academicDetails') : t('profile.academicDetails')}
          icon="school-outline"
        />
        <Card>
          {isStudent ? (
            <DetailRow label={t('auth.studentId')} value={user.studentId} icon="card-outline" />
          ) : isTeacher ? (
            <DetailRow label={t('auth.teacherId')} value={user.teacherId} icon="card-outline" />
          ) : (
            <DetailRow label={t('admin.role')} value={t('admin.roleAdmin')} icon="shield-outline" />
          )}
          <Divider />
          <DetailRow label={t('auth.branch')} value={context?.branchName} icon="business-outline" />
          {isStudent ? (
            <>
              <Divider />
              <DetailRow label={t('auth.class')} value={context?.className} icon="people-outline" />
            </>
          ) : null}
          {isTeacher ? (
            <>
              <Divider />
              <DetailRow
                label={t('auth.qualification')}
                value={user.qualification}
                icon="ribbon-outline"
              />
            </>
          ) : null}
          <Divider />
          <DetailRow
            label={t('profile.accountStatus')}
            value={humanise(user.status)}
            icon="checkmark-circle-outline"
          />
        </Card>

        <Spacer />

        <SectionHeader title={t('profile.preferences')} icon="settings-outline" />
        <Card>
          <Select
            label={t('profile.appLanguage')}
            value={language}
            options={available.map((l) => ({
              value: l.code,
              label: l.nativeName,
              description: l.name,
            }))}
            onChange={(code) => void setLanguage(code as LanguageCode)}
            containerStyle={{ marginBottom: 0 }}
          />
        </Card>

        <Spacer />

        <Card>
          <Button
            label={t('profile.changePassword')}
            icon="key-outline"
            variant="outline"
            fullWidth
            onPress={() => {
              setPasswords({ current: '', next: '', confirm: '' });
              setErrors({});
              setChangingPassword(true);
            }}
          />
          <Spacer size={spacing.md} />
          <Button
            label={t('auth.logout')}
            icon="log-out-outline"
            variant="danger"
            fullWidth
            onPress={() => setConfirmLogout(true)}
          />
        </Card>

        <View style={styles.about}>
          <Text style={styles.aboutName}>{APP_NAME}</Text>
          <Text style={styles.aboutTagline}>{t('app.tagline')}</Text>
          <Text style={styles.aboutVersion}>{t('profile.version')} 1.0.0</Text>
        </View>
      </Screen>

      <FormSheet
        visible={editing}
        title={t('profile.editProfile')}
        onClose={() => setEditing(false)}
        onSubmit={handleSaveProfile}
        submitting={busy}
      >
        <TextField
          label={t('auth.fullName')}
          value={form.fullName}
          onChangeText={(v) => setForm((p) => ({ ...p, fullName: v }))}
          error={errors.fullName}
          icon="person-outline"
          required
        />
        <TextField
          label={t('auth.mobile')}
          value={form.mobile}
          onChangeText={(v) => setForm((p) => ({ ...p, mobile: v }))}
          icon="call-outline"
          keyboardType="phone-pad"
        />
        {isTeacher ? (
          <TextField
            label={t('auth.qualification')}
            value={form.qualification}
            onChangeText={(v) => setForm((p) => ({ ...p, qualification: v }))}
            icon="ribbon-outline"
          />
        ) : null}
        <Text style={styles.note}>
          {t('auth.username')}, {t('auth.email')} — {t('admin.manageUsers')}
        </Text>
      </FormSheet>

      <FormSheet
        visible={changingPassword}
        title={t('profile.changePassword')}
        onClose={() => setChangingPassword(false)}
        onSubmit={handleChangePassword}
        submitting={busy}
      >
        <PasswordField
          label={t('profile.currentPassword')}
          value={passwords.current}
          onChangeText={(v) => setPasswords((p) => ({ ...p, current: v }))}
          error={errors.current}
          icon="lock-closed-outline"
          required
        />
        <PasswordField
          label={t('profile.newPassword')}
          value={passwords.next}
          onChangeText={(v) => setPasswords((p) => ({ ...p, next: v }))}
          error={errors.next}
          hint={t('auth.passwordHint')}
          icon="key-outline"
          required
        />
        <PasswordField
          label={t('auth.confirmPassword')}
          value={passwords.confirm}
          onChangeText={(v) => setPasswords((p) => ({ ...p, confirm: v }))}
          error={errors.confirm}
          icon="key-outline"
          required
        />
      </FormSheet>

      <ConfirmDialog
        visible={confirmLogout}
        title={t('auth.logout')}
        message={t('auth.logoutConfirm')}
        confirmLabel={t('auth.logout')}
        destructive
        onCancel={() => setConfirmLogout(false)}
        onConfirm={() => {
          setConfirmLogout(false);
          void logout();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  headerCard: { alignItems: 'center', paddingVertical: spacing.xxl },
  name: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  username: { fontSize: fontSize.sm, color: colors.textMuted, marginTop: 2 },
  badgeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: brand.sandLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  roleBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: brand.navyDeep,
  },
  headerActions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  note: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.sm },
  about: { alignItems: 'center', paddingVertical: spacing.xxxl },
  aboutName: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textSecondary },
  aboutTagline: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  aboutVersion: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.sm },
});
