import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { Badge, Card, IconButton } from '@/components/ui';

/**
 * One row in an admin list: icon, title, up to two meta lines, optional badges
 * and edit/delete affordances. Using one row component keeps every management
 * screen looking and behaving the same.
 */
export function AdminRow({
  icon,
  iconTint = colors.primary,
  title,
  subtitle,
  meta,
  badges,
  onPress,
  onEdit,
  onDelete,
  extraActions,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  iconTint?: string;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  badges?: { label: string; tone?: string }[];
  onPress?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  extraActions?: React.ReactNode;
}) {
  const { t } = useTranslation();

  return (
    <Card onPress={onPress} accessibilityLabel={title}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: `${iconTint}1A` }]}>
          <Ionicons name={icon} size={20} color={iconTint} />
        </View>

        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
          {meta ? (
            <Text style={styles.meta} numberOfLines={1}>
              {meta}
            </Text>
          ) : null}
          {badges?.length ? (
            <View style={styles.badges}>
              {badges.map((badge) => (
                <Badge key={badge.label} label={badge.label} tone={badge.tone} />
              ))}
            </View>
          ) : null}
        </View>

        <View style={styles.actions}>
          {extraActions}
          {onEdit ? (
            <IconButton
              icon="create-outline"
              label={t('common.edit')}
              onPress={onEdit}
              size={36}
              color={colors.primary}
            />
          ) : null}
          {onDelete ? (
            <IconButton
              icon="trash-outline"
              label={t('common.delete')}
              onPress={onDelete}
              size={36}
              color={colors.danger}
              background={colors.dangerSoft}
            />
          ) : null}
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  icon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  title: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: colors.text },
  subtitle: { fontSize: fontSize.sm, color: colors.textSecondary, marginTop: 2 },
  meta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.sm },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
