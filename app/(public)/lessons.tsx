import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PublicPage } from '@/components/public/PublicPage';
import {
  ChipRow,
  Fact,
  ListState,
  PublicCard,
  SearchBar,
  SignInPrompt,
  Tag,
} from '@/components/public/PublicControls';
import { useAsync } from '@/hooks/useAsync';
import { listPublicLessons } from '@/services/publicSiteService';
import type { PublicLesson } from '@/types';
import { brand, fontSize, fontWeight, spacing } from '@/constants/theme';

/**
 * The syllabus, as far as a visitor may read it.
 *
 * Every card here is a headline and nothing more: subject, week, title, how
 * long it takes. The lesson's notes, its recording and its handouts are not
 * absent from the page — they are absent from the DOCUMENT this page reads.
 * See publicSiteService for why that distinction is the whole design.
 *
 * So the page ends with the way in rather than with a link that would fail.
 * Somebody reading the curriculum and wanting the material is exactly the
 * person who should be signing up.
 */
export default function PublicLessons() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [room, setRoom] = useState('all');

  const load = useCallback(() => listPublicLessons(60), []);
  const { data, loading, refreshing, refresh } = useAsync(load, []);

  const rooms = useMemo(() => {
    const found = new Set<string>();
    for (const lesson of data ?? []) if (lesson.className?.trim()) found.add(lesson.className.trim());
    return [
      { value: 'all', label: t('public.lessons.allClasses') },
      ...[...found].sort().map((name) => ({ value: name, label: name })),
    ];
  }, [data, t]);

  const lessons = useMemo(() => {
    let rows = data ?? [];
    if (room !== 'all') rows = rows.filter((lesson) => lesson.className?.trim() === room);

    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((lesson) =>
      [lesson.title, lesson.subject, lesson.teacherName, lesson.className]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle))
    );
  }, [data, query, room]);

  return (
    <PublicPage
      badge={t('public.lessons.badge')}
      title={t('public.lessons.title')}
      subtitle={t('public.lessons.lead')}
      onRefresh={refresh}
      refreshing={refreshing}
    >
      <SearchBar value={query} onChange={setQuery} placeholder={t('public.lessons.search')} />
      {rooms.length > 1 ? <ChipRow options={rooms} value={room} onChange={setRoom} /> : null}

      <ListState
        loading={loading}
        empty={lessons.length === 0}
        icon="book-outline"
        title={t('public.lessons.emptyTitle')}
        message={t('public.lessons.emptyBody')}
      />

      {lessons.map((lesson) => (
        <LessonCard key={lesson.id} lesson={lesson} />
      ))}

      {lessons.length > 0 ? <SignInPrompt message={t('public.lessons.notesNote')} /> : null}
    </PublicPage>
  );
}

function LessonCard({ lesson }: { lesson: PublicLesson }) {
  const { t } = useTranslation();

  return (
    <PublicCard>
      <View style={styles.head}>
        {lesson.subject ? <Tag label={lesson.subject} /> : null}
        <Text style={styles.week}>{t('lesson.week', { number: lesson.weekNumber })}</Text>
      </View>

      <Text style={styles.title}>{lesson.title}</Text>

      {lesson.teacherName ? <Fact icon="person-outline" text={lesson.teacherName} /> : null}
      {lesson.duration ? (
        <Fact
          icon="time-outline"
          text={t('public.lessons.minutes', { value: lesson.duration })}
          tint={brand.orange}
        />
      ) : null}
      {lesson.className ? <Fact icon="school-outline" text={lesson.className} /> : null}
    </PublicCard>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  week: { fontSize: fontSize.xs, color: brand.slate, fontWeight: fontWeight.semibold },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: brand.navyDeep,
    lineHeight: 23,
  },
});
