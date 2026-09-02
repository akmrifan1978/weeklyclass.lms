import React from 'react';
import {
  ActivityIndicator,
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
  TOUCH_TARGET,
} from '@/constants/theme';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  testID?: string;
}

const VARIANT: Record<
  ButtonVariant,
  { background: string; text: string; border?: string; elevated?: boolean }
> = {
  // Orange is the call to action; navy is the app chrome. Keeping them in these
  // roles is what stops the palette becoming noise.
  primary: { background: colors.accent, text: colors.textOnAccent, elevated: true },
  secondary: { background: colors.primary, text: colors.textInverse, elevated: true },
  outline: { background: colors.transparent, text: colors.primary, border: colors.borderStrong },
  ghost: { background: colors.transparent, text: colors.primary },
  danger: { background: colors.danger, text: colors.textInverse, elevated: true },
};

const SIZE: Record<ButtonSize, { height: number; paddingH: number; font: number; icon: number }> = {
  sm: { height: 36, paddingH: spacing.md, font: fontSize.sm, icon: 15 },
  md: { height: TOUCH_TARGET, paddingH: spacing.lg, font: fontSize.md, icon: 18 },
  lg: { height: 52, paddingH: spacing.xl, font: fontSize.lg, icon: 20 },
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  iconPosition = 'left',
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const tone = VARIANT[variant];
  const metrics = SIZE[size];
  const inert = disabled || loading;

  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        {
          height: metrics.height,
          paddingHorizontal: metrics.paddingH,
          backgroundColor: tone.background,
          borderColor: tone.border ?? colors.transparent,
          borderWidth: tone.border ? 1 : 0,
          opacity: inert ? 0.55 : pressed ? 0.86 : 1,
        },
        tone.elevated && !inert ? shadow.sm : null,
        fullWidth ? styles.fullWidth : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={tone.text} />
      ) : (
        <View style={styles.content}>
          {icon && iconPosition === 'left' ? (
            <Ionicons name={icon} size={metrics.icon} color={tone.text} style={styles.iconLeft} />
          ) : null}
          <Text
            numberOfLines={1}
            style={[styles.label, { color: tone.text, fontSize: metrics.font }]}
          >
            {label}
          </Text>
          {icon && iconPosition === 'right' ? (
            <Ionicons name={icon} size={metrics.icon} color={tone.text} style={styles.iconRight} />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

/** Circular icon-only button. Always give it an accessibilityLabel. */
export function IconButton({
  icon,
  onPress,
  label,
  size = 40,
  color = colors.primary,
  background = colors.surfaceMuted,
  disabled = false,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  label: string;
  size?: number;
  color?: string;
  background?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      // Expands the touch area to 44dp without changing the visual size.
      hitSlop={Math.max(0, (TOUCH_TARGET - size) / 2)}
      style={({ pressed }) => [
        styles.iconButton,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: background,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={size * 0.5} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  fullWidth: { alignSelf: 'stretch', width: '100%' },
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  label: { fontWeight: fontWeight.semibold, textAlign: 'center' },
  iconLeft: { marginRight: spacing.sm },
  iconRight: { marginLeft: spacing.sm },
  iconButton: { alignItems: 'center', justifyContent: 'center' },
});
