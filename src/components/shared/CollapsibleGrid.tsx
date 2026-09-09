import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useResponsive } from '@/hooks/useResponsive';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { Grid, SectionHeader } from '@/components/ui';

/**
 * A grid of tiles that does not make a phone scroll past everything.
 *
 * The dashboard grew two of these — fourteen shortcuts and nine Islamic
 * sections — and stacked they ran to roughly a dozen rows on a phone before
 * anything else on the page. Every tile was worth having and the page as a
 * whole had become tiring, which is the usual shape of this problem: nothing to
 * delete, and too much at once.
 *
 * So the first few are shown and the rest are one tap away. The count is on the
 * button, because "Show all" without a number is a question rather than an
 * offer — somebody deciding whether to press it wants to know if it opens four
 * more or forty.
 *
 * ONLY WHERE IT HELPS. On a wide screen the same tiles occupy two or three rows
 * and there is nothing to gain by hiding them, so the whole mechanism steps
 * aside and the toggle is not drawn at all.
 */
export function CollapsibleGrid({
  title,
  icon,
  children,
  /** How many to show before the toggle. Two full rows on a phone. */
  initial = 6,
  minItemWidth = 100,
}: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  children: React.ReactNode;
  initial?: number;
  minItemWidth?: number;
}) {
  const { t } = useTranslation();
  const { isPhone } = useResponsive();
  const [expanded, setExpanded] = useState(false);

  const items = useMemo(
    () => React.Children.toArray(children).filter(Boolean),
    [children]
  );

  const collapses = isPhone && items.length > initial;
  const shown = collapses && !expanded ? items.slice(0, initial) : items;
  const hidden = items.length - initial;

  return (
    <>
      <SectionHeader title={title} icon={icon} />
      <Grid minItemWidth={minItemWidth} gap={spacing.md}>
        {shown}
      </Grid>

      {collapses ? (
        <Pressable
          onPress={() => setExpanded((open) => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
        >
          <Text style={styles.toggleText}>
            {expanded ? t('common.showLess') : t('common.showAllCount', { count: hidden })}
          </Text>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={15}
            color={colors.primary}
          />
        </Pressable>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  pressed: { opacity: 0.7 },
  toggleText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.primary,
  },
});
