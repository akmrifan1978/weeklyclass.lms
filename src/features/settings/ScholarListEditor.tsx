import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { newListId } from '@/utils/branding';
import { listUsers } from '@/services/userService';
import type { AppUser, QaScholar } from '@/types';
import { Button, IconButton, Select, TextField, type Option } from '@/components/ui';

/**
 * The Mowlavis a Live Q&A question can be addressed to.
 *
 * Add, rename in place, or remove. Renaming keeps the entry's id, so questions
 * already addressed to a Mowlavi stay addressed to them — each question also
 * keeps a copy of the name it was asked with, so an old question still says who
 * it was for even after that person is removed from the list.
 *
 * Each Mowlavi is linked to the account that signs in for them. That account
 * is who gets the notification when a student asks them something; a name with
 * no account still works as a choice, but tells nobody.
 */
export function ScholarListEditor({
  scholars,
  onChange,
}: {
  scholars: QaScholar[];
  onChange: (next: QaScholar[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  // The accounts a Mowlavi can be: active teachers and admins.
  const loadStaff = useCallback(async () => {
    const [teachers, admins] = await Promise.all([
      listUsers({ role: 'teacher', pageSize: 100 })
        .then((page) => page.items)
        .catch(() => [] as AppUser[]),
      listUsers({ role: 'admin', pageSize: 50 })
        .then((page) => page.items)
        .catch(() => [] as AppUser[]),
    ]);
    return [...teachers, ...admins].filter((account) => account.status === 'active');
  }, []);
  const { data: staff } = useAsync(loadStaff, [loadStaff]);

  const accountOptions = useMemo<Option[]>(
    () =>
      (staff ?? []).map((account) => ({
        value: account.uid,
        label: account.fullName,
        description: t(account.role === 'admin' ? 'admin.roleAdmin' : 'admin.roleTeacher'),
      })),
    [staff, t]
  );

  const link = (uid: string | null | undefined) => {
    const account = uid ? (staff ?? []).find((a) => a.uid === uid) : undefined;
    return {
      userId: account?.uid ?? null,
      userRole: account ? (account.role === 'admin' ? ('admin' as const) : ('teacher' as const)) : null,
    };
  };

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    // The same person twice would be two identical choices for a student.
    if (scholars.some((s) => s.name.trim().toLowerCase() === name.toLowerCase())) {
      setDraft('');
      return;
    }
    // A name that is exactly an account's name is linked to it straight away.
    const match = (staff ?? []).find(
      (account) => account.fullName.trim().toLowerCase() === name.toLowerCase()
    );
    onChange([...scholars, { id: newListId('mowlavi'), name, ...link(match?.uid) }]);
    setDraft('');
  };

  return (
    <View>
      <Text style={styles.hint}>{t('settings.scholarsHint')}</Text>

      {scholars.length === 0 ? (
        <Text style={styles.empty}>{t('settings.scholarsEmpty')}</Text>
      ) : (
        scholars.map((scholar) => (
          <View key={scholar.id} style={styles.entry}>
            <View style={styles.row}>
              <TextField
                value={scholar.name}
                onChangeText={(name) =>
                  onChange(scholars.map((s) => (s.id === scholar.id ? { ...s, name } : s)))
                }
                icon="person-outline"
                containerStyle={{ flex: 1, marginBottom: 0 }}
              />
              <IconButton
                icon="trash-outline"
                label={t('settings.scholarRemove')}
                size={36}
                color={colors.danger}
                onPress={() => onChange(scholars.filter((s) => s.id !== scholar.id))}
              />
            </View>
            <Select
              label={t('settings.scholarAccount')}
              value={scholar.userId ?? null}
              options={accountOptions}
              placeholder={t('settings.scholarAccountPick')}
              onChange={(uid) =>
                onChange(
                  scholars.map((s) => (s.id === scholar.id ? { ...s, ...link(uid) } : s))
                )
              }
              searchable
              allowClear
              containerStyle={styles.account}
            />
            {!scholar.userId ? (
              <Text style={styles.warning}>{t('settings.scholarNotLinked')}</Text>
            ) : null}
          </View>
        ))
      )}

      <View style={[styles.row, { marginTop: spacing.md }]}>
        <TextField
          value={draft}
          onChangeText={setDraft}
          placeholder={t('settings.scholarPlaceholder')}
          icon="person-add-outline"
          containerStyle={{ flex: 1, marginBottom: 0 }}
          onSubmitEditing={add}
        />
        <Button label={t('settings.scholarAdd')} icon="add" size="sm" onPress={add} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 17, marginBottom: spacing.md },
  empty: { fontSize: fontSize.sm, color: colors.textMuted, marginBottom: spacing.sm },
  entry: { marginBottom: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  account: { marginBottom: 0 },
  warning: { fontSize: fontSize.xs, color: colors.accentDark, marginTop: spacing.xs, lineHeight: 17 },
});
