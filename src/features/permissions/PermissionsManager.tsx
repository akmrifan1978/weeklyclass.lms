import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { useAsync, useDebounced } from '@/hooks/useAsync';
import { friendlyMessage } from '@/utils/errors';
import { getUser, listUsers, updatePermissions } from '@/services/userService';
import { PERMISSION_GROUPS, type Permission, type PermissionMap } from '@/types/permissions';
import type { AppUser } from '@/types';
import {
  AsyncBoundary,
  Avatar,
  Button,
  Card,
  Divider,
  Screen,
  SearchField,
  SectionHeader,
  SkeletonList,
  Spacer,
  StatusBadge,
  ToggleRow,
} from '@/components/ui';

/**
 * Permission editor.
 *
 * Teachers do not all get the same access: an admin toggles each capability per
 * teacher here, and those same flags are re-checked in the Firestore security
 * rules on every write. Turning a switch off genuinely removes the ability —
 * it is not just a hidden button.
 */
export function PermissionsManager() {
  const { t } = useTranslation();
  const { user: actor } = useAuth();
  const toast = useToast();
  const params = useLocalSearchParams<{ uid?: string }>();

  const [selected, setSelected] = useState<AppUser | null>(null);
  const [draft, setDraft] = useState<PermissionMap>({});
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const search = useDebounced(term, 400);

  const loadTeachers = useCallback(async () => {
    const page = await listUsers({ role: 'teacher', search: search || undefined, pageSize: 50 });
    return page.items;
  }, [search]);

  const { data: teachers, loading, error, reload, refreshing, refresh } = useAsync(loadTeachers, [
    search,
  ]);

  // Deep link from the user detail sheet: open straight onto that teacher.
  useEffect(() => {
    if (!params.uid) return;
    getUser(params.uid)
      .then((found) => {
        if (found) {
          setSelected(found);
          setDraft({ ...(found.permissions ?? {}) });
        }
      })
      .catch(() => undefined);
  }, [params.uid]);

  const dirty = useMemo(() => {
    if (!selected) return false;
    const current = selected.permissions ?? {};
    const keys = new Set([...Object.keys(current), ...Object.keys(draft)]);
    return Array.from(keys).some(
      (key) => (current[key as Permission] ?? false) !== (draft[key as Permission] ?? false)
    );
  }, [selected, draft]);

  const grantedCount = useMemo(
    () => Object.values(draft).filter(Boolean).length,
    [draft]
  );

  const open = (teacher: AppUser) => {
    setSelected(teacher);
    setDraft({ ...(teacher.permissions ?? {}) });
  };

  const toggle = (permission: Permission, value: boolean) => {
    setDraft((previous) => ({ ...previous, [permission]: value }));
  };

  const setGroup = (permissions: Permission[], value: boolean) => {
    setDraft((previous) => {
      const next = { ...previous };
      for (const permission of permissions) next[permission] = value;
      return next;
    });
  };

  const setAll = (value: boolean) => {
    setDraft(() => {
      const next: PermissionMap = {};
      for (const group of PERMISSION_GROUPS) {
        for (const permission of group.permissions) next[permission] = value;
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!actor || !selected) return;
    setBusy(true);
    try {
      await updatePermissions(selected.uid, draft, actor);
      toast.success(t('admin.permissionsSaved'));
      setSelected({ ...selected, permissions: draft });
      await reload();
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  if (selected) {
    return (
      <Screen edges={['bottom']}>
        <View style={styles.detailHeader}>
          <Button
            label={t('common.back')}
            icon="chevron-back"
            variant="ghost"
            size="sm"
            onPress={() => setSelected(null)}
          />
        </View>

        <Card style={styles.teacherCard}>
          <Avatar name={selected.fullName} uri={selected.profileImage} size={56} />
          <View style={{ flex: 1 }}>
            <Text style={styles.teacherName} numberOfLines={1}>
              {selected.fullName}
            </Text>
            <Text style={styles.teacherMeta} numberOfLines={1}>
              {selected.teacherId ?? selected.email}
            </Text>
            <View style={styles.teacherBadges}>
              <StatusBadge status={selected.status} />
              <View style={styles.countChip}>
                <Ionicons name="key-outline" size={11} color={colors.accentDark} />
                <Text style={styles.countText}>{grantedCount}</Text>
              </View>
            </View>
          </View>
        </Card>

        <Spacer />

        <View style={styles.bulkRow}>
          <Button
            label={t('admin.grantAll')}
            icon="checkmark-done-outline"
            variant="outline"
            size="sm"
            onPress={() => setAll(true)}
            style={{ flex: 1 }}
          />
          <Button
            label={t('admin.revokeAll')}
            icon="close-circle-outline"
            variant="outline"
            size="sm"
            onPress={() => setAll(false)}
            style={{ flex: 1 }}
          />
        </View>

        <Spacer />

        {PERMISSION_GROUPS.map((group) => {
          const allOn = group.permissions.every((permission) => draft[permission]);
          return (
            <View key={group.group} style={styles.group}>
              <SectionHeader
                title={group.group}
                actionLabel={allOn ? t('admin.revokeAll') : t('admin.grantAll')}
                onAction={() => setGroup(group.permissions, !allOn)}
              />
              <Card>
                {group.permissions.map((permission, index) => (
                  <View key={permission}>
                    {index > 0 ? <Divider /> : null}
                    <ToggleRow
                      label={t(`permissions.${permission}`)}
                      description={permission}
                      value={draft[permission] ?? false}
                      onValueChange={(value) => toggle(permission, value)}
                    />
                  </View>
                ))}
              </Card>
            </View>
          );
        })}

        <Spacer />
        <Button
          label={t('common.save')}
          icon="save-outline"
          fullWidth
          size="lg"
          loading={busy}
          disabled={!dirty}
          onPress={handleSave}
        />
        <Spacer size={spacing.xxxl} />
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={refresh} edges={['bottom']}>
      <Text style={styles.title} accessibilityRole="header">
        {t('admin.managePermissions')}
      </Text>
      <Text style={styles.subtitle}>{t('admin.permissionsAdminNote')}</Text>

      <Spacer />

      <SearchField value={term} onChangeText={setTerm} />

      <Spacer />

      <AsyncBoundary
        loading={loading}
        error={error}
        empty={(teachers ?? []).length === 0}
        onRetry={reload}
        skeleton={<SkeletonList count={5} />}
        emptyProps={{ icon: 'people-outline', title: t('common.noResults') }}
      >
        <View style={{ gap: spacing.md }}>
          {(teachers ?? []).map((teacher) => {
            const count = Object.values(teacher.permissions ?? {}).filter(Boolean).length;
            return (
              <Card key={teacher.id} onPress={() => open(teacher)} accessibilityLabel={teacher.fullName}>
                <View style={styles.row}>
                  <Avatar name={teacher.fullName} uri={teacher.profileImage} size={42} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {teacher.fullName}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {teacher.teacherId ?? teacher.email}
                    </Text>
                    <Text style={styles.rowMeta}>
                      {count > 0
                        ? `${count} ${t('nav.permissions').toLowerCase()}`
                        : t('admin.noPermissionsGranted')}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                </View>
              </Card>
            );
          })}
        </View>
      </AsyncBoundary>

      <Spacer size={spacing.xxxl} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    paddingTop: spacing.sm,
  },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: spacing.xs },
  detailHeader: { flexDirection: 'row', paddingTop: spacing.sm, marginBottom: spacing.md },
  teacherCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  teacherName: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  teacherMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  teacherBadges: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  countChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
  },
  countText: { fontSize: fontSize.xs, color: colors.accentDark, fontWeight: fontWeight.bold },
  bulkRow: { flexDirection: 'row', gap: spacing.md },
  group: { marginBottom: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  rowMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
});
