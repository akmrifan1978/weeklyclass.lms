import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { PublicPage } from '@/components/public/PublicPage';
import {
  CardAction,
  ChipRow,
  Fact,
  ListState,
  PublicCard,
  SearchBar,
  Tag,
} from '@/components/public/PublicControls';
import { useAsync } from '@/hooks/useAsync';
import { listPublicClassRooms } from '@/services/publicSiteService';
import type { AgeBand, ClassRoom } from '@/types';
import { brand, colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { tone } from '@/components/public/tone';

/**
 * The class groups on offer.
 *
 * These are the same documents the registration form has always read signed
 * out — `classes` is world-readable so somebody joining can be shown the group
 * they are about to join and the teachers who run it. Nothing is mirrored and
 * nothing new is exposed; the page simply shows them a little earlier.
 */
export default function PublicClasses() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [band, setBand] = useState<AgeBand | 'all'>('all');

  const load = useCallback(() => listPublicClassRooms(60), []);
  const { data, loading, refreshing, refresh } = useAsync(load, []);

  const bands = useMemo(() => {
    const found = new Set<AgeBand>();
    for (const room of data ?? []) if (room.ageBand) found.add(room.ageBand);
    return [
      { value: 'all' as const, label: t('common.all') },
      ...(['children', 'teenagers', 'adults'] as AgeBand[])
        .filter((value) => found.has(value))
        .map((value) => ({ value, label: t(`classGroup.age_${value}`) })),
    ];
  }, [data, t]);

  const rooms = useMemo(() => {
    let rows = data ?? [];
    if (band !== 'all') rows = rows.filter((room) => room.ageBand === band);

    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((room) =>
      [room.name, room.description, room.schedule, ...(room.teacherNames ?? [])]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle))
    );
  }, [data, band, query]);

  return (
    <PublicPage
      badge={t('public.classes.badge')}
      title={t('public.classes.title')}
      subtitle={t('public.classes.lead')}
      onRefresh={refresh}
      refreshing={refreshing}
    >
      <SearchBar value={query} onChange={setQuery} placeholder={t('public.classes.search')} />
      {bands.length > 1 ? <ChipRow options={bands} value={band} onChange={setBand} /> : null}

      <ListState
        loading={loading}
        empty={rooms.length === 0}
        icon="school-outline"
        title={t('public.classes.emptyTitle')}
        message={t('public.classes.emptyBody')}
      />

      {rooms.map((room) => (
        <ClassCard key={room.id} room={room} />
      ))}
    </PublicPage>
  );
}

function ClassCard({ room }: { room: ClassRoom }) {
  const { t } = useTranslation();
  const router = useRouter();
  const teachers = (room.teacherNames ?? []).filter(Boolean).join(', ');

  return (
    <PublicCard>
      <View style={styles.tags}>
        {room.ageBand ? <Tag label={t(`classGroup.age_${room.ageBand}`)} /> : null}
        {room.gender ? <Tag label={t(`classGroup.gender_${room.gender}`)} tone="muted" /> : null}
      </View>

      <Text style={styles.title}>{room.name}</Text>

      {room.description ? (
        <Text style={styles.blurb} numberOfLines={4}>
          {room.description}
        </Text>
      ) : null}

      {room.schedule ? <Fact icon="time-outline" text={room.schedule} tint={brand.orange} /> : null}
      {teachers ? <Fact icon="person-outline" text={teachers} /> : null}

      {/* Joining is a signed-in act. The card offers the way in rather than a
          booking form, because eligibility, the class size and whether
          registration is even open are all things this screen cannot see. */}
      <CardAction
        label={t('public.classes.join')}
        onPress={() => router.push('/(auth)/register')}
      />
    </PublicCard>
  );
}

const styles = StyleSheet.create({
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: tone.title,
    lineHeight: 23,
  },
  blurb: { fontSize: fontSize.sm, color: tone.body, lineHeight: 19 },
});
