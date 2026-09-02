import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage, isOffline } from '@/utils/errors';
import { Button } from './Button';

/**
 * Loading / empty / error states.
 *
 * Every list and detail screen renders one of these rather than a blank space,
 * so the app never silently shows nothing.
 */

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.centred} accessibilityLiveRegion="polite">
      <ActivityIndicator size="large" color={colors.accent} />
      <Text style={styles.loadingText}>{label ?? t('common.loading')}</Text>
    </View>
  );
}

/** Shimmering placeholder block. */
export function Skeleton({
  height = 16,
  width = '100%',
  radius: cornerRadius = radius.sm,
  style,
}: {
  height?: number;
  width?: number | `${number}%`;
  radius?: number;
  style?: object;
}) {
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.timing(pulse, {
          toValue: 0.4,
          duration: 700,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { height, width, borderRadius: cornerRadius, backgroundColor: colors.surfaceMuted, opacity: pulse },
        style,
      ]}
    />
  );
}

/** Card-shaped skeleton used while lists load. */
export function SkeletonCard() {
  return (
    <View style={styles.skeletonCard}>
      <Skeleton height={14} width="55%" />
      <Skeleton height={11} width="85%" style={{ marginTop: spacing.md }} />
      <Skeleton height={11} width="40%" style={{ marginTop: spacing.sm }} />
    </View>
  );
}

export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <View style={{ gap: spacing.md }}>
      {Array.from({ length: count }).map((_, index) => (
        <SkeletonCard key={index} />
      ))}
    </View>
  );
}

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  message,
  actionLabel,
  onAction,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.centred}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={30} color={colors.slate} />
      </View>
      <Text style={styles.emptyTitle} accessibilityRole="header">
        {title ?? t('empty.nothingHere')}
      </Text>
      <Text style={styles.emptyMessage}>{message ?? t('empty.checkBackSoon')}</Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="outline" style={styles.emptyAction} />
      ) : null}
    </View>
  );
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const offline = isOffline(error);

  return (
    <View style={styles.centred}>
      <View style={[styles.emptyIcon, styles.errorIcon]}>
        <Ionicons
          name={offline ? 'cloud-offline-outline' : 'alert-circle-outline'}
          size={30}
          color={colors.danger}
        />
      </View>
      <Text style={styles.emptyTitle} accessibilityRole="header">
        {offline ? t('empty.offlineTitle') : t('empty.somethingWrong')}
      </Text>
      <Text style={styles.emptyMessage}>
        {offline ? t('empty.offlineMessage') : friendlyMessage(error, t)}
      </Text>
      {onRetry ? (
        <Button
          label={t('common.retry')}
          onPress={onRetry}
          icon="refresh-outline"
          variant="outline"
          style={styles.emptyAction}
        />
      ) : null}
    </View>
  );
}

/** Shown when a teacher opens a section their permissions do not cover. */
export function NoAccessState({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon="lock-closed-outline"
      title={t('errors.permissionDenied')}
      message={message ?? t('empty.noAccess')}
    />
  );
}

/**
 * One component that picks the right state, so screens read as:
 *   <AsyncBoundary loading={...} error={...} empty={...}> ... </AsyncBoundary>
 */
export function AsyncBoundary({
  loading,
  error,
  empty,
  onRetry,
  emptyProps,
  skeleton,
  children,
}: {
  loading: boolean;
  error?: unknown;
  empty?: boolean;
  onRetry?: () => void;
  emptyProps?: React.ComponentProps<typeof EmptyState>;
  skeleton?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (loading) return <>{skeleton ?? <LoadingState />}</>;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (empty) return <EmptyState {...emptyProps} />;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  centred: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.huge,
    paddingHorizontal: spacing.xl,
  },
  loadingText: { marginTop: spacing.md, color: colors.textSecondary, fontSize: fontSize.sm },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    backgroundColor: colors.infoSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  errorIcon: { backgroundColor: colors.dangerSoft },
  emptyTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.sm,
    maxWidth: 340,
    lineHeight: 20,
  },
  emptyAction: { marginTop: spacing.xl },
  skeletonCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    padding: spacing.lg,
  },
});
