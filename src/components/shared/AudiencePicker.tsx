import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { listClasses } from '@/services/orgService';
import { listUsers } from '@/services/userService';
import type { Audience, AudienceMode, AppUser, ClassRoom } from '@/types';
import { SearchField } from '@/components/ui';

/**
 * "Who is this for?" — the same three answers everywhere they are asked.
 *
 * Publishing to the wrong people is not an error anybody sees until it is too
 * late, so the summary line at the bottom always spells out the actual
 * consequence in words: not "2 selected" but the names of the two groups. The
 * cost of reading one extra line is nothing against the cost of a teacher's
 * workbook reaching a class it was not meant for.
 *
 * The two lists are fetched once, when first needed, rather than up front:
 * most posts go to everybody, and a form that has not asked for the student
 * list should not pay Mumbai a round-trip for it.
 */
export function AudiencePicker({
  value,
  onChange,
  /** Hidden when the caller has no business narrowing to one person. */
  allowStudents = true,
  label,
}: {
  value: Audience;
  onChange: (audience: Audience) => void;
  allowStudents?: boolean;
  label?: string;
}) {
  const { t } = useTranslation();

  const [classes, setClasses] = useState<ClassRoom[] | null>(null);
  const [students, setStudents] = useState<AppUser[] | null>(null);
  const [search, setSearch] = useState('');

  // Only what the chosen mode actually needs.
  useEffect(() => {
    let alive = true;
    if (value.mode === 'classes' && classes === null) {
      void listClasses({ pageSize: 200 })
        .then((page) => alive && setClasses(page.items))
        .catch(() => alive && setClasses([]));
    }
    if (value.mode === 'students' && students === null) {
      void listUsers({ role: 'student', status: 'active', pageSize: 300 })
        .then((page) => alive && setStudents(page.items))
        .catch(() => alive && setStudents([]));
    }
    return () => {
      alive = false;
    };
  }, [value.mode, classes, students]);

  const modes: { mode: AudienceMode; icon: keyof typeof Ionicons.glyphMap; key: string }[] = [
    { mode: 'all', icon: 'people-outline', key: 'audience.all' },
    { mode: 'classes', icon: 'school-outline', key: 'audience.classes' },
    ...(allowStudents
      ? [{ mode: 'students' as const, icon: 'person-outline' as const, key: 'audience.students' }]
      : []),
  ];

  const toggle = (list: string[], id: string): string[] =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const chosenClasses = value.classIds ?? [];
  const chosenStudents = value.studentIds ?? [];

  const filteredStudents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = students ?? [];
    if (!needle) return rows;
    return rows.filter(
      (s) =>
        s.fullName.toLowerCase().includes(needle) ||
        s.username?.toLowerCase().includes(needle) ||
        s.studentId?.toLowerCase().includes(needle)
    );
  }, [students, search]);

  // Spelled out, never counted. See the note at the top.
  const summary = (() => {
    if (value.mode === 'all') return t('audience.summaryAll');
    if (value.mode === 'classes') {
      if (!chosenClasses.length) return t('audience.summaryNobody');
      const names = chosenClasses
        .map((id) => classes?.find((c) => c.id === id)?.name)
        .filter(Boolean);
      return names.length ? t('audience.summaryClasses', { names: names.join(', ') }) : null;
    }
    if (!chosenStudents.length) return t('audience.summaryNobody');
    const names = chosenStudents
      .map((uid) => students?.find((s) => s.uid === uid)?.fullName)
      .filter(Boolean);
    return names.length ? t('audience.summaryStudents', { names: names.join(', ') }) : null;
  })();

  const empty =
    (value.mode === 'classes' && chosenClasses.length === 0) ||
    (value.mode === 'students' && chosenStudents.length === 0);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label ?? t('audience.label')}</Text>

      <View style={styles.modeRow}>
        {modes.map((m) => {
          const active = value.mode === m.mode;
          return (
            <Pressable
              key={m.mode}
              onPress={() => onChange({ ...value, mode: m.mode })}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              accessibilityLabel={t(m.key)}
              style={[styles.mode, active && styles.modeActive]}
            >
              <Ionicons
                name={m.icon}
                size={16}
                color={active ? colors.textInverse : colors.textSecondary}
              />
              <Text style={[styles.modeText, active && styles.modeTextActive]}>{t(m.key)}</Text>
            </Pressable>
          );
        })}
      </View>

      {value.mode === 'classes' ? (
        <PickList
          loading={classes === null}
          emptyLabel={t('audience.noClasses')}
          rows={(classes ?? []).map((c) => ({
            id: c.id,
            title: c.name,
            subtitle: c.code ?? undefined,
          }))}
          selected={chosenClasses}
          onToggle={(id) => onChange({ ...value, classIds: toggle(chosenClasses, id) })}
        />
      ) : null}

      {value.mode === 'students' ? (
        <>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder={t('audience.searchStudents')}
            style={{ marginBottom: spacing.sm }}
          />
          <PickList
            loading={students === null}
            emptyLabel={t('audience.noStudents')}
            rows={filteredStudents.map((s) => ({
              id: s.uid,
              title: s.fullName,
              subtitle: s.studentId ?? s.username,
            }))}
            selected={chosenStudents}
            onToggle={(id) => onChange({ ...value, studentIds: toggle(chosenStudents, id) })}
          />
        </>
      ) : null}

      {summary ? (
        <View style={[styles.summary, empty && styles.summaryWarn]}>
          <Ionicons
            name={empty ? 'alert-circle-outline' : 'information-circle-outline'}
            size={14}
            color={empty ? colors.danger : colors.textSecondary}
          />
          <Text style={[styles.summaryText, empty && styles.summaryTextWarn]}>{summary}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * A bounded, scrolling tick list.
 *
 * Capped in height on purpose: a class of sixty students inside a form sheet
 * would push the save button off the bottom of a phone, and a picker you have
 * to scroll past to reach the button is how people give up halfway.
 */
function PickList({
  rows,
  selected,
  onToggle,
  loading,
  emptyLabel,
}: {
  rows: { id: string; title: string; subtitle?: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  loading: boolean;
  emptyLabel: string;
}) {
  const { t } = useTranslation();

  if (loading) return <Text style={styles.hint}>{t('common.loading')}</Text>;
  if (!rows.length) return <Text style={styles.hint}>{emptyLabel}</Text>;

  return (
    <ScrollView style={styles.list} nestedScrollEnabled keyboardShouldPersistTaps="handled">
      {rows.map((row) => {
        const on = selected.includes(row.id);
        return (
          <Pressable
            key={row.id}
            onPress={() => onToggle(row.id)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={row.title}
            style={styles.row}
          >
            <Ionicons
              name={on ? 'checkbox' : 'square-outline'}
              size={20}
              color={on ? colors.primary : colors.textMuted}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {row.title}
              </Text>
              {row.subtitle ? (
                <Text style={styles.rowSub} numberOfLines={1}>
                  {row.subtitle}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  modeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  mode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  modeActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  modeText: { fontSize: fontSize.xs, color: colors.textSecondary, fontWeight: fontWeight.semibold },
  modeTextActive: { color: colors.textInverse },
  list: {
    maxHeight: 220,
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowTitle: { fontSize: fontSize.sm, color: colors.text },
  rowSub: { fontSize: fontSize.xs, color: colors.textMuted },
  hint: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.md },
  summary: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
  },
  summaryWarn: { backgroundColor: colors.dangerSoft },
  summaryText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17 },
  summaryTextWarn: { color: colors.danger },
});
