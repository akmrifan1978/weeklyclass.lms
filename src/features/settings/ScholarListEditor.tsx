import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, spacing } from '@/constants/theme';
import { newListId } from '@/utils/branding';
import type { QaScholar } from '@/types';
import { Button, IconButton, TextField } from '@/components/ui';

/**
 * The Mowlavis a Live Q&A question can be addressed to.
 *
 * Add, rename in place, or remove. Renaming keeps the entry's id, so questions
 * already addressed to a Mowlavi stay addressed to them — each question also
 * keeps a copy of the name it was asked with, so an old question still says who
 * it was for even after that person is removed from the list.
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

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    // The same person twice would be two identical choices for a student.
    if (scholars.some((s) => s.name.trim().toLowerCase() === name.toLowerCase())) {
      setDraft('');
      return;
    }
    onChange([...scholars, { id: newListId('mowlavi'), name }]);
    setDraft('');
  };

  return (
    <View>
      <Text style={styles.hint}>{t('settings.scholarsHint')}</Text>

      {scholars.length === 0 ? (
        <Text style={styles.empty}>{t('settings.scholarsEmpty')}</Text>
      ) : (
        scholars.map((scholar) => (
          <View key={scholar.id} style={styles.row}>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
});
