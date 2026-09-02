import { useWindowDimensions } from 'react-native';

import { breakpoints } from '@/constants/theme';

export interface Responsive {
  width: number;
  height: number;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /** Desktop admin gets a persistent sidebar; everything else gets tabs. */
  showSidebar: boolean;
  /** Sensible column count for card grids at this width. */
  columns: number;
  /** Horizontal padding that grows with the viewport. */
  gutter: number;
}

export function useResponsive(): Responsive {
  const { width, height } = useWindowDimensions();

  const isDesktop = width >= breakpoints.desktop;
  const isTablet = width >= breakpoints.tablet && !isDesktop;
  const isPhone = !isTablet && !isDesktop;

  return {
    width,
    height,
    isPhone,
    isTablet,
    isDesktop,
    showSidebar: isDesktop,
    columns: isDesktop ? 4 : isTablet ? 3 : 2,
    gutter: isDesktop ? 32 : isTablet ? 24 : 16,
  };
}
