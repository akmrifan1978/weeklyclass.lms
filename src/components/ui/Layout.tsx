import React, { useEffect, useState } from 'react';
import {
  Image,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import {
  brand,
  colors,
  fontSize,
  fontWeight,
  layout,
  spacing,
} from '@/constants/theme';
import { initials } from '@/utils/format';
import { useResponsive } from '@/hooks/useResponsive';
import { watchSettings } from '@/services/settingsService';
import { FooterTicker } from '@/components/shared/FooterTicker';
import { useBranding } from '@/hooks/useBranding';
import { logoImageStyle } from '@/utils/branding';

/** Page container: safe area, background, and a max width on large screens. */
export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  style,
  contentStyle,
  edges = ['bottom'],
}: {
  children: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  edges?: ('top' | 'bottom' | 'left' | 'right')[];
}) {
  const { gutter } = useResponsive();

  const inner = (
    <View style={[styles.contentWidth, { paddingHorizontal: gutter }, contentStyle]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={[styles.screen, style]} edges={edges}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing ?? false}
                onRefresh={onRefresh}
                tintColor={colors.accent}
                colors={[colors.accent]}
              />
            ) : undefined
          }
        >
          {inner}
        </ScrollView>
      ) : (
        <View style={styles.flex}>{inner}</View>
      )}
      {/* Outside the scroll view, so it sits still at the bottom of the content
          area — which is the strip directly above the bottom menu. Rendering it
          here rather than in each layout is what makes "every page" true, and
          keeps it true for pages added later. It draws nothing when the admin
          has not switched it on. */}
      <FooterTicker />
    </SafeAreaView>
  );
}

/** Navy app bar with an optional back button and trailing actions. */
export function AppHeader({
  title,
  subtitle,
  showBack = false,
  onBack,
  right,
  compact = false,
}: {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
  compact?: boolean;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + (compact ? spacing.sm : spacing.md) }]}>
      <StatusBar barStyle="light-content" backgroundColor={brand.navyDeep} />
      <View style={styles.headerRow}>
        {showBack ? (
          <Pressable
            onPress={onBack ?? (() => router.back())}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Back"
            style={({ pressed }) => [styles.backButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Ionicons name="chevron-back" size={24} color={colors.textInverse} />
          </Pressable>
        ) : null}

        {/* The organisation's mark, on every screen that carries this header —
            which is every screen, for every role. It comes from settings, so an
            organisation that uploads a logo sees it everywhere without a
            release, and nothing is drawn at all until one is set: a placeholder
            in the corner of every page is worse than an empty corner. */}
        <HeaderLogo />

        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1} accessibilityRole="header">
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>

        {right ? <View style={styles.headerRight}>{right}</View> : null}
      </View>
    </View>
  );
}

/**
 * The logo in the corner.
 *
 * A live settings listener rather than a one-off read, so changing the logo
 * updates every open screen rather than waiting for a restart. Failures are
 * silent by design — a header that refuses to draw because a logo could not be
 * fetched would take the page title down with it.
 */
function HeaderLogo() {
  const { logoUrl: uri, logoShape } = useBranding();

  if (!uri) return null;
  return (
    <Image
      source={{ uri }}
      style={[styles.headerLogo, logoImageStyle(logoShape, 30)]}
      resizeMode="contain"
      // Decorative: the title beside it already names the screen, and the app
      // name is not what somebody navigating by screen reader is looking for.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/** Rounded avatar that falls back to initials when there is no photo. */
export function Avatar({
  name,
  uri,
  size = 44,
  background = brand.navy,
}: {
  name: string;
  uri?: string | null;
  size?: number;
  background?: string;
}) {
  if (uri) {
    return (
      <Image
        source={{ uri }}
        accessibilityLabel={name}
        style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceMuted }}
      />
    );
  }

  return (
    <View
      accessible
      accessibilityLabel={name}
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: background },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.38 }]}>{initials(name)}</Text>
    </View>
  );
}

/** Responsive grid — wraps children into rows without a FlatList. */
export function Grid({
  children,
  minItemWidth = 150,
  gap = spacing.md,
}: {
  children: React.ReactNode;
  minItemWidth?: number;
  gap?: number;
}) {
  return (
    <View style={[styles.grid, { gap }]}>
      {React.Children.map(children, (child) =>
        child ? <View style={{ minWidth: minItemWidth, flexGrow: 1, flexBasis: minItemWidth }}>{child}</View> : null
      )}
    </View>
  );
}

/** Vertical spacer, so screens do not sprinkle magic margins. */
export function Spacer({ size = spacing.lg }: { size?: number }) {
  return <View style={{ height: size }} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  scrollContent: { paddingBottom: spacing.huge, flexGrow: 1 },
  contentWidth: {
    width: '100%',
    maxWidth: layout.maxContentWidth,
    alignSelf: 'center',
    flex: Platform.OS === 'web' ? undefined : 1,
    paddingTop: spacing.lg,
  },
  header: {
    backgroundColor: brand.navyDeep,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  backButton: { marginLeft: -spacing.sm },
  headerLogo: {
    width: 30,
    height: 30,
    borderRadius: 8,
    marginRight: spacing.sm,
    backgroundColor: colors.surface,
  },
  headerText: { flex: 1 },
  headerTitle: {
    color: colors.textInverse,
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
  },
  headerSubtitle: {
    color: colors.sandLight,
    fontSize: fontSize.sm,
    marginTop: 2,
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.textInverse, fontWeight: fontWeight.bold },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
});
