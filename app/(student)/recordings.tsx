import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { matchesSearch } from '@/utils/format';
import { listVideosForStudent } from '@/services/videoService';
import { VideoRow } from '@/components/shared/ContentCards';
import {
  AppHeader,
  AsyncBoundary,
  Screen,
  SearchField,
  SkeletonList,
} from '@/components/ui';

export default function StudentRecordings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { language } = useLanguage();
  const router = useRouter();
  const [term, setTerm] = useState('');

  const load = useCallback(
    () => listVideosForStudent(user?.classId, 'recording', 40),
    [user?.classId]
  );

  const { data, loading, error, refreshing, refresh, reload } = useAsync(load, [user?.classId]);

  const visible = useMemo(
    () => (data ?? []).filter((video) => matchesSearch(term, video.title, video.speaker)),
    [data, term]
  );

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('video.recordings')} showBack />

      <Screen refreshing={refreshing} onRefresh={refresh}>
        <SearchField value={term} onChangeText={setTerm} />
        <View style={{ height: spacing.lg }} />

        <AsyncBoundary
          loading={loading}
          error={error}
          empty={visible.length === 0}
          onRetry={reload}
          skeleton={<SkeletonList count={5} />}
          emptyProps={{ icon: 'videocam-outline', title: t('video.noRecordings') }}
        >
          <View style={{ gap: spacing.md }}>
            {visible.map((video) => (
              <VideoRow
                key={video.id}
                video={video}
                locale={language}
                onPress={() => router.push(`/(student)/video/${video.id}`)}
              />
            ))}
          </View>
        </AsyncBoundary>
      </Screen>
    </View>
  );
}
