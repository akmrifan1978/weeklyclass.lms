import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PublicPage } from '@/components/public/PublicPage';
import { ListState, PublicCard, SearchBar } from '@/components/public/PublicControls';
import { useAsync } from '@/hooks/useAsync';
import { listPublicTeachers } from '@/services/publicSiteService';
import type { PublicTeacher } from '@/types';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { tone } from '@/components/public/tone';

/**
 * Who teaches here.
 *
 * Reads `publicTeachers`, which holds a name, a qualification and a line of
 * subjects — and holds nothing at all for a teacher an admin has not switched
 * on. That is why this page can be empty on a platform full of staff: being
 * listed is a decision each profile is turned on for, not a side effect of
 * having an account.
 *
 * There is no email address on this page and no setting that adds one. Staff
 * are reached through the app or through the centre's own address on the
 * Contact page — never through a personal inbox printed on the open web.
 */
export default function PublicTeachers() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const load = useCallback(() => listPublicTeachers(60), []);
  const { data, loading, refreshing, refresh } = useAsync(load, []);

  const teachers = useMemo(() => {
    const rows = data ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((teacher) =>
      [teacher.name, teacher.subjects, teacher.qualification]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle))
    );
  }, [data, query]);

  return (
    <PublicPage
      badge={t('public.teachers.badge')}
      title={t('public.teachers.title')}
      subtitle={t('public.teachers.lead')}
      onRefresh={refresh}
      refreshing={refreshing}
    >
      <SearchBar value={query} onChange={setQuery} placeholder={t('public.teachers.search')} />

      <ListState
        loading={loading}
        empty={teachers.length === 0}
        icon="people-outline"
        title={t('public.teachers.emptyTitle')}
        message={t('public.teachers.emptyBody')}
      />

      {teachers.map((teacher) => (
        <TeacherCard key={teacher.id} teacher={teacher} />
      ))}
    </PublicPage>
  );
}

function TeacherCard({ teacher }: { teacher: PublicTeacher }) {
  // The first letter, because there is no photograph to show. A monogram reads
  // as a deliberate placeholder where an empty grey circle reads as a picture
  // that failed to load.
  const initial = teacher.name.trim().charAt(0).toUpperCase() || '?';

  return (
    <PublicCard>
      <View style={styles.row}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>

        <View style={styles.details}>
          <Text style={styles.name}>{teacher.name}</Text>
          {teacher.subjects ? <Text style={styles.subjects}>{teacher.subjects}</Text> : null}
          {teacher.qualification ? (
            <Text style={styles.qualification}>{teacher.qualification}</Text>
          ) : null}
        </View>
      </View>
    </PublicCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    backgroundColor: tone.pressed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.textInverse,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.heavy,
  },
  details: { flex: 1, gap: 3 },
  name: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: tone.title },
  subjects: { fontSize: fontSize.sm, color: brand.orangeLight, fontWeight: fontWeight.semibold },
  qualification: { fontSize: fontSize.xs, color: tone.body, lineHeight: 17 },
});
