import React from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { useIslamicFeatures } from '@/hooks/useIslamicFeatures';
import { brand, spacing } from '@/constants/theme';
import { QuickAccessTile } from '@/components/shared/ContentCards';
import { Grid, SectionHeader, Spacer } from '@/components/ui';
import type { IslamicFeature } from '@/types';

/**
 * The Islamic sections, offered identically on every dashboard.
 *
 * One component rather than the same six tiles pasted into three screens. These
 * are for the person, not tools tied to a role — a teacher has the same reason
 * to check prayer times as a student, and an admin the same reason to read the
 * Qur'an — so nothing here is gated on a permission. What an admin controls is
 * whether a section exists at all, which is a platform setting, not a per-role
 * one. See useIslamicFeatures.
 */

interface Tile {
  feature: IslamicFeature;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  labelKey: string;
  /** Appended to the dashboard's own route prefix. */
  path: string;
  tint: string;
}

const TILES: Tile[] = [
  {
    feature: 'prayer',
    icon: 'time-outline',
    labelKey: 'nav.prayer',
    path: '/prayer',
    tint: brand.navy,
  },
  {
    feature: 'quran',
    icon: 'book',
    labelKey: 'nav.quran',
    path: '/quran',
    tint: brand.sand,
  },
  {
    feature: 'readingPlan',
    icon: 'bookmarks',
    labelKey: 'quran.dailyReading',
    path: '/quran/plan',
    tint: brand.orange,
  },
  {
    feature: 'tajweed',
    icon: 'mic-outline',
    labelKey: 'nav.tajweed',
    path: '/tajweed',
    tint: brand.slate,
  },
  {
    feature: 'zakat',
    icon: 'calculator-outline',
    labelKey: 'nav.zakat',
    path: '/zakat',
    tint: brand.orangeLight,
  },
  {
    feature: 'hadith',
    icon: 'library-outline',
    labelKey: 'nav.hadith',
    path: '/hadith',
    tint: brand.navy,
  },
  {
    feature: 'noor',
    icon: 'radio-outline',
    labelKey: 'noor.title',
    path: '/noor',
    tint: brand.orange,
  },
  {
    feature: 'dua',
    icon: 'sparkles-outline',
    labelKey: 'nav.duas',
    path: '/duas',
    tint: brand.slate,
  },
];

export function IslamicTiles({
  basePath,
}: {
  /** Route group this dashboard lives in, e.g. `/(student)`. */
  basePath: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { enabled } = useIslamicFeatures();

  const visible = TILES.filter((tile) => enabled(tile.feature));

  // An admin who switches everything off should get no heading either, rather
  // than a section title standing over an empty space.
  if (visible.length === 0) return null;

  return (
    <>
      <Spacer size={spacing.xxl} />
      <SectionHeader title={t('nav.islamic')} icon="moon-outline" />
      <Grid minItemWidth={105} gap={spacing.md}>
        {visible.map((tile) => (
          <QuickAccessTile
            key={tile.feature}
            icon={tile.icon}
            label={t(tile.labelKey)}
            tint={tile.tint}
            onPress={() => router.push(`${basePath}${tile.path}` as never)}
          />
        ))}
      </Grid>
    </>
  );
}
