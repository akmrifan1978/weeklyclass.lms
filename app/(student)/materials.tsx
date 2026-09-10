import React, { useCallback, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { spacing } from '@/constants/theme';
import { useLive } from '@/hooks/useLive';
import { matchesSearch } from '@/utils/format';
import { watchMaterialsForStudent } from '@/services/contentService';
import { logEvent, AnalyticsEvents } from '@/firebase/analytics';
import { MaterialRow } from '@/components/shared/ContentCards';
import {
  AppHeader,
  AsyncBoundary,
  ChipGroup,
  Screen,
  SearchField,
  SkeletonList,
} from '@/components/ui';
import type { Material, MaterialType } from '@/types';

type Filter = MaterialType | 'all';

export default function StudentMaterials() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  // Live, so a file a teacher uploads mid-week appears without the student
  // pulling to refresh — which is the whole point of putting it there.
  const subscribe = useCallback(
    (onNext: (items: Material[]) => void, onError: (error: unknown) => void) =>
      watchMaterialsForStudent(user?.classId, onNext, onError, 60),
    [user?.classId]
  );

  const { data, loading, error, refreshing, refresh, reload } = useLive(subscribe, [user?.classId]);

  const visible = useMemo(() => {
    const items = data ?? [];
    return items.filter(
      (material) =>
        (filter === 'all' || material.type === filter) &&
        matchesSearch(term, material.title, material.description)
    );
  }, [data, filter, term]);

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t('material.title')} showBack />

      <Screen refreshing={refreshing} onRefresh={refresh}>
        <SearchField value={term} onChangeText={setTerm} />

        <ChipGroup<Filter>
          options={[
            { value: 'all', label: t('common.all') },
            { value: 'pdf', label: t('material.typePdf') },
            { value: 'audio', label: t('material.typeAudio') },
            { value: 'image', label: t('material.typeImage') },
            { value: 'document', label: t('material.typeDocument') },
            { value: 'link', label: t('material.typeLink') },
          ]}
          value={filter}
          onChange={setFilter}
          style={{ marginTop: spacing.md, marginBottom: spacing.lg }}
        />

        <AsyncBoundary
          loading={loading}
          error={error}
          empty={visible.length === 0}
          onRetry={reload}
          skeleton={<SkeletonList count={5} />}
          emptyProps={{
            icon: 'folder-open-outline',
            title: t('material.noMaterials'),
            message: user?.classId ? t('empty.checkBackSoon') : t('empty.notAssignedClass'),
          }}
        >
          <View style={{ gap: spacing.md }}>
            {visible.map((material) => (
              <MaterialRow
                key={material.id}
                material={material}
                onPress={() => {
                  logEvent(AnalyticsEvents.materialDownloaded, { materialId: material.id });
                  Linking.openURL(material.url).catch(() => undefined);
                }}
              />
            ))}
          </View>
        </AsyncBoundary>
      </Screen>
    </View>
  );
}
