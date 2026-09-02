import React, { useCallback, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { formatDate } from '@/utils/date';
import { groupByDate, listPast, listUpcoming } from '@/services/calendarService';
import { EventRow } from '@/components/shared/ContentCards';
import {
  AppHeader,
  AsyncBoundary,
  ChipGroup,
  IconButton,
  Screen,
  SkeletonList,
} from '@/components/ui';

type Mode = 'upcoming' | 'past';

export default function StudentCalendar() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { language } = useLanguage();
  const [mode, setMode] = useState<Mode>('upcoming');

  const load = useCallback(async () => {
    const options = { classId: user?.classId ?? undefined, pageSize: 40 };
    const page = mode === 'upcoming' ? await listUpcoming(options) : await listPast(options);
    return page.items;
  }, [mode, user?.classId]);

  const { data, loading, refreshing, error, refresh, reload } = useAsync(load, [
    mode,
    user?.classId,
  ]);

  const grouped = groupByDate(data ?? []);
  const dates = Object.keys(grouped).sort((a, b) =>
    mode === 'upcoming' ? a.localeCompare(b) : b.localeCompare(a)
  );

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('calendar.title')} />
      <Screen refreshing={refreshing} onRefresh={refresh}>
        <ChipGroup<Mode>
          options={[
            { value: 'upcoming', label: t('calendar.upcoming') },
            { value: 'past', label: t('calendar.past') },
          ]}
          value={mode}
          onChange={setMode}
          style={{ marginBottom: spacing.lg }}
        />

        <AsyncBoundary
          loading={loading}
          error={error}
          empty={dates.length === 0}
          onRetry={reload}
          skeleton={<SkeletonList count={4} />}
          emptyProps={{ icon: 'calendar-outline', title: t('calendar.noEvents') }}
        >
          <View style={{ gap: spacing.xl }}>
            {dates.map((date) => (
              <View key={date} style={{ gap: spacing.md }}>
                <Text style={styles.dateHeading} accessibilityRole="header">
                  {formatDate(date, language)}
                </Text>
                {grouped[date]?.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    locale={language}
                    trailing={
                      event.meetingUrl ? (
                        <IconButton
                          icon="videocam"
                          label={t('calendar.joinOnline')}
                          background={colors.accentSoft}
                          color={colors.accent}
                          onPress={() =>
                            Linking.openURL(event.meetingUrl!).catch(() => undefined)
                          }
                        />
                      ) : event.status === 'cancelled' ? (
                        <Ionicons name="close-circle" size={20} color={colors.danger} />
                      ) : undefined
                    }
                  />
                ))}
              </View>
            ))}
          </View>
        </AsyncBoundary>
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  dateHeading: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
});
