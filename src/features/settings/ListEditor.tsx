import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { Button, TextField } from '@/components/ui';

/**
 * A short editable list of names — class groups, event name presets.
 *
 * Both exist for the same reason: somebody types "Children" or "Weekly Halaqah"
 * over and over, spells it three different ways, and the resulting data cannot
 * be grouped. Offering the list they already agreed on is what stops that.
 *
 * Saving is left to the screen. This edits an array and reports it upward, so
 * the whole settings form stays one save button rather than growing a private
 * one per section.
 */
export function ListEditor({
  values,
  placeholder,
  emptyLabel,
  onChange,
}: {
  values: string[];
  placeholder: string;
  emptyLabel: string;
  onChange: (next: string[]) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState('');

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    // Case-insensitive, because "Adults" and "adults" are one group that would
    // otherwise split every report in two.
    const clash = values.some((existing) => existing.toLowerCase() === value.toLowerCase());
    if (!clash) onChange([...values, value]);
    setDraft('');
  };

  return (
    <>
      <View style={styles.addRow}>
        <TextField
          label=""
          value={draft}
          onChangeText={setDraft}
          placeholder={placeholder}
          returnKeyType="done"
          onSubmitEditing={add}
          containerStyle={styles.addField}
        />
        <Button
          label={t('common.add')}
          icon="add"
          size="sm"
          onPress={add}
          disabled={draft.trim().length === 0}
        />
      </View>

      {values.length === 0 ? (
        <Text style={styles.empty}>{emptyLabel}</Text>
      ) : (
        <View style={styles.chips}>
          {values.map((value) => (
            <View key={value} style={styles.chip}>
              <Text style={styles.chipText}>{value}</Text>
              <Pressable
                onPress={() => onChange(values.filter((item) => item !== value))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${t('common.delete')} ${value}`}
              >
                <Ionicons name="close" size={14} color={colors.textSecondary} />
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  addRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  addField: { flex: 1, marginBottom: spacing.sm },
  empty: { fontSize: fontSize.xs, color: colors.textMuted, paddingVertical: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.pill,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    paddingVertical: 5,
  },
  chipText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.text },
});
