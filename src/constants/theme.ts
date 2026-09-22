import { Platform } from 'react-native';

/**
 * WeeklyClass LMS design system.
 *
 * Brand palette — used deliberately, not everywhere at once:
 *   deep navy    -> headers, navigation, dark surfaces
 *   orange       -> primary actions, highlights
 *   red          -> destructive / warning states ONLY
 *   sand & slate -> supporting accents, muted text, soft backgrounds
 */

export const brand = {
  orange: '#ED5B03',
  orangeDark: '#F17504',
  orangeLight: '#FA910A',
  navy: '#092F6B',
  navyDeep: '#041E4A',
  red: '#F12D00',
  sand: '#9C7C60',
  sandLight: '#E5C5A0',
  slate: '#6A7C9E',
} as const;

/**
 * Darkens a hex colour towards black by `amount` (0-1).
 *
 * Used where a brand colour has to carry a small shape against its own tinted
 * background — an icon in particular. The lighter brand tones read as washed out
 * at 22px, and darkening the glyph while leaving the tint alone keeps the colour
 * recognisable instead of replacing it with a different one.
 */
export function darken(hex: string, amount = 0.3): string {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const channel = (offset: number) =>
    Math.max(0, Math.round(parseInt(full.slice(offset, offset + 2), 16) * (1 - amount)));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(channel(0))}${toHex(channel(2))}${toHex(channel(4))}`;
}

export const colors = {
  // Brand
  primary: brand.navy,
  primaryDark: brand.navyDeep,
  primaryLight: '#12468F',

  accent: brand.orange,
  accentDark: brand.orangeDark,
  accentLight: brand.orangeLight,
  accentSoft: '#FFF1E5',

  danger: brand.red,
  dangerSoft: '#FDECE8',

  success: '#1B8A5A',
  successSoft: '#E6F4EE',
  warning: brand.orangeLight,
  warningSoft: '#FFF4E0',
  info: brand.slate,
  infoSoft: '#EEF1F7',

  sand: brand.sand,
  sandLight: brand.sandLight,
  slate: brand.slate,

  // Surfaces
  background: '#F5F7FA',
  backgroundAlt: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#F0F3F8',
  surfaceInverse: brand.navyDeep,
  overlay: 'rgba(4, 30, 74, 0.55)',

  // Text
  text: '#111A2E',
  textSecondary: '#4B5A75',
  textMuted: '#7A879F',
  textInverse: '#FFFFFF',
  textOnAccent: '#FFFFFF',

  // Lines
  border: '#DFE5EF',
  borderStrong: '#C6D0E0',
  divider: '#EDF1F7',

  transparent: 'transparent',
} as const;

export const gradients = {
  header: [brand.navyDeep, brand.navy] as const,
  accent: [brand.orange, brand.orangeLight] as const,
  hero: [brand.navyDeep, brand.navy, '#12468F'] as const,
};

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  pill: 999,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  xxxl: 30,
  display: 36,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
} as const;

/** Minimum tappable size — accessibility requirement, do not go below. */
export const TOUCH_TARGET = 44;

export const shadow = {
  none: {},
  sm: Platform.select({
    ios: {
      shadowColor: brand.navyDeep,
      shadowOpacity: 0.06,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
    },
    android: { elevation: 2 },
    default: { boxShadow: '0 2px 6px rgba(4,30,74,0.08)' },
  }) as object,
  md: Platform.select({
    ios: {
      shadowColor: brand.navyDeep,
      shadowOpacity: 0.1,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    android: { elevation: 4 },
    default: { boxShadow: '0 4px 14px rgba(4,30,74,0.1)' },
  }) as object,
  lg: Platform.select({
    ios: {
      shadowColor: brand.navyDeep,
      shadowOpacity: 0.14,
      shadowRadius: 22,
      shadowOffset: { width: 0, height: 8 },
    },
    android: { elevation: 8 },
    default: { boxShadow: '0 8px 26px rgba(4,30,74,0.14)' },
  }) as object,
};

/** Responsive breakpoints (width in dp/px). */
export const breakpoints = {
  phone: 0,
  tablet: 768,
  desktop: 1100,
  wide: 1440,
} as const;

export const layout = {
  /** Max content width on very wide screens so text stays readable. */
  maxContentWidth: 1280,
  sidebarWidth: 264,
  sidebarCollapsedWidth: 72,
  headerHeight: 64,
  tabBarHeight: 62,
} as const;

export const statusColor: Record<string, string> = {
  active: colors.success,
  published: colors.success,
  present: colors.success,
  sent: colors.success,
  inactive: colors.textMuted,
  draft: colors.textMuted,
  archived: colors.textMuted,
  cancelled: colors.textMuted,
  excused: colors.slate,
  pending: colors.warning,
  scheduled: colors.warning,
  late: colors.warning,
  in_progress: colors.warning,
  suspended: colors.danger,
  blocked: colors.danger,
  absent: colors.danger,
  closed: colors.danger,
  failed: colors.danger,
};

export const statusSoftColor: Record<string, string> = {
  active: colors.successSoft,
  published: colors.successSoft,
  present: colors.successSoft,
  sent: colors.successSoft,
  inactive: colors.surfaceMuted,
  draft: colors.surfaceMuted,
  archived: colors.surfaceMuted,
  cancelled: colors.surfaceMuted,
  excused: colors.infoSoft,
  pending: colors.warningSoft,
  scheduled: colors.warningSoft,
  late: colors.warningSoft,
  in_progress: colors.warningSoft,
  suspended: colors.dangerSoft,
  blocked: colors.dangerSoft,
  absent: colors.dangerSoft,
  closed: colors.dangerSoft,
  failed: colors.dangerSoft,
};

export const theme = {
  colors,
  brand,
  gradients,
  spacing,
  radius,
  fontSize,
  fontWeight,
  shadow,
  breakpoints,
  layout,
};

export type Theme = typeof theme;
