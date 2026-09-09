import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PublicHeader } from './PublicHeader';
import { PublicHero } from './PublicHero';
import { FooterTicker } from '@/components/shared/FooterTicker';
import { useAsync } from '@/hooks/useAsync';
import { getSettings } from '@/services/settingsService';
import { colors, spacing } from '@/constants/theme';

/**
 * Every public page, laid out the same way.
 *
 * Bar, then the navy hero band, then cards on a light ground, inside a column
 * that stops widening at 720. A page of cards that runs the full width of a
 * desktop window is a page nobody can read a line of, and the phone layout is
 * the one almost everybody arrives on anyway.
 */
export function PublicPage({
  badge,
  title,
  subtitle,
  children,
  onRefresh,
  refreshing = false,
  showLogo = false,
}: {
  badge: string;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** The front page shows the mark in the hero; the rest do not. */
  showLogo?: boolean;
}) {
  // `settings/app` is world-readable precisely so the public pages can show the
  // organisation's own name and mark before anybody signs in.
  const { data: settings } = useAsync(() => getSettings(), []);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <PublicHeader settings={settings} />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
        }
      >
        <View style={styles.column}>
          <PublicHero
            badge={badge}
            title={title}
            subtitle={subtitle}
            logo={{ show: showLogo, url: settings?.logoUrl }}
          />

          <View style={styles.body}>{children}</View>

          {/* The organisation's own line, at the foot. It reads the setting
              itself and draws nothing at all when the ticker is switched off,
              so an empty strip never costs space here. */}
          <View style={styles.ticker}>
            <FooterTicker />
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: spacing.huge },
  column: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  body: { marginTop: spacing.lg, gap: spacing.md },
  ticker: { borderRadius: 12, overflow: 'hidden', marginTop: spacing.xl },
});
