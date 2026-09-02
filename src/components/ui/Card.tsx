import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  colors,
  fontSize,
  fontWeight,
  radius,
  shadow,
  spacing,
  statusColor,
  statusSoftColor,
} from '@/constants/theme';
import { humanise } from '@/utils/format';

export function Card({
  children,
  onPress,
  style,
  padded = true,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  accessibilityLabel?: string;
}) {
  const content = (
    <View style={[styles.card, padded ? styles.cardPadded : null, style]}>{children}</View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

/** Small coloured pill for statuses, roles and counts. */
export function Badge({
  label,
  tone,
  color,
  background,
}: {
  label: string;
  /** A status string like `active` / `pending`, mapped to the palette. */
  tone?: string;
  color?: string;
  background?: string;
}) {
  const fg = color ?? (tone ? (statusColor[tone] ?? colors.textSecondary) : colors.textSecondary);
  const bg =
    background ?? (tone ? (statusSoftColor[tone] ?? colors.surfaceMuted) : colors.surfaceMuted);

  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function StatusBadge({ status }: { status?: string }) {
  if (!status) return null;
  return <Badge label={humanise(status)} tone={status} />;
}

/** Dashboard metric tile. */
export function StatCard({
  label,
  value,
  icon,
  accent = colors.primary,
  onPress,
  style,
}: {
  label: string;
  value: number | string;
  icon: keyof typeof Ionicons.glyphMap;
  accent?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Card onPress={onPress} accessibilityLabel={`${label}: ${value}`} style={[styles.stat, style]}>
      <View style={[styles.statIcon, { backgroundColor: `${accent}1A` }]}>
        <Ionicons name={icon} size={20} color={accent} />
      </View>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel} numberOfLines={2}>
        {label}
      </Text>
    </Card>
  );
}

export function SectionHeader({
  title,
  actionLabel,
  onAction,
  icon,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionTitleRow}>
        {icon ? (
          <Ionicons name={icon} size={17} color={colors.primary} style={styles.sectionIcon} />
        ) : null}
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {actionLabel && onAction ? (
        <Pressable
          onPress={onAction}
          accessibilityRole="button"
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Label/value row used across profile and detail screens. */
export function DetailRow({
  label,
  value,
  icon,
}: {
  label: string;
  value?: string | number | null;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailLabelWrap}>
        {icon ? (
          <Ionicons name={icon} size={15} color={colors.textMuted} style={styles.detailIcon} />
        ) : null}
        <Text style={styles.detailLabel}>{label}</Text>
      </View>
      <Text style={styles.detailValue} selectable numberOfLines={3}>
        {value === null || value === undefined || value === '' ? '—' : String(value)}
      </Text>
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.divider,
    ...shadow.sm,
  },
  cardPadded: { padding: spacing.lg },
  badge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  stat: { flex: 1, minWidth: 140, padding: spacing.lg },
  statIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  statValue: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: 2,
  },
  statLabel: { fontSize: fontSize.sm, color: colors.textSecondary },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  sectionIcon: { marginRight: spacing.sm },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    flexShrink: 1,
  },
  sectionAction: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: spacing.md,
    gap: spacing.lg,
  },
  detailLabelWrap: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  detailIcon: { marginRight: spacing.xs },
  detailLabel: { fontSize: fontSize.sm, color: colors.textMuted },
  detailValue: {
    fontSize: fontSize.md,
    color: colors.text,
    fontWeight: fontWeight.medium,
    flexShrink: 1,
    textAlign: 'right',
  },
  divider: { height: 1, backgroundColor: colors.divider },
});
