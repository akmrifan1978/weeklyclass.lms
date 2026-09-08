import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import type { AppUser } from '@/types';

/**
 * Choosing every teacher who takes a class group, not just one.
 *
 * A dropdown was the wrong shape for this. `teacherIds` has always been what
 * the class-scoped security rules read, but the only way to write to it was a
 * single-value picker, so a group taught by two people could not be described
 * — one of them simply could not see their own students.
 *
 * A list of rows rather than a multi-select modal: the number of teachers at
 * one centre is small enough to show, and seeing who is currently on a group
 * matters more here than saving vertical space.
 */
export function TeacherPicker({
  label,
  hint,
  teachers,
  selected,
  onChange,
}: {
  label: string;
  hint?: string;
  teachers: AppUser[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (uid: string) => {
    onChange(
      selected.includes(uid) ? selected.filter((id) => id !== uid) : [...selected, uid]
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>

      <View style={styles.list}>
        {teachers.map((teacher, index) => {
          const checked = selected.includes(teacher.uid);
          // The first chosen is the primary one — the single name a card or a
          // notification can show — so it is worth saying which that is.
          const primary = checked && selected[0] === teacher.uid;

          return (
            <Pressable
              key={teacher.uid}
              onPress={() => toggle(teacher.uid)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked }}
              accessibilityLabel={teacher.fullName}
              style={[styles.row, index > 0 && styles.rowDivided]}
            >
              <Ionicons
                name={checked ? 'checkbox' : 'square-outline'}
                size={20}
                color={checked ? colors.primary : colors.borderStrong}
              />
              <Text style={[styles.name, checked && styles.nameOn]} numberOfLines={1}>
                {teacher.fullName}
              </Text>
              {primary ? <Text style={styles.primary}>1</Text> : null}
            </Pressable>
          );
        })}

        {teachers.length === 0 ? <Text style={styles.empty}>—</Text> : null}
      </View>

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.lg },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  list: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  name: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  nameOn: { color: colors.text, fontWeight: fontWeight.medium },
  primary: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
    backgroundColor: colors.primary,
    width: 18,
    height: 18,
    borderRadius: 9,
    textAlign: 'center',
    lineHeight: 18,
    overflow: 'hidden',
  },
  empty: { padding: spacing.md, fontSize: fontSize.xs, color: colors.textMuted },
  hint: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 16 },
});
