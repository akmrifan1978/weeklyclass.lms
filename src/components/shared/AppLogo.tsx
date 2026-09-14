import React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';

import { useBranding } from '@/hooks/useBranding';
import { logoImageStyle } from '@/utils/branding';

/**
 * A logo, in the shape the admin chose.
 *
 * Every place a logo is drawn goes through this, so choosing "round" in
 * Settings changes all of them at once — the header, the cards, the video and
 * lesson pages — rather than whichever ones somebody remembered to update.
 *
 * `contain`, always: a shape is a frame, and a frame that crops the artwork to
 * fill itself would cut the edges off a wide logo.
 */
export function LogoImage({
  uri,
  size,
  style,
  accessibilityLabel,
}: {
  uri: string;
  /** The drawn size, which the round shape needs to know its radius. */
  size: number;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
}) {
  const { logoShape } = useBranding();

  return (
    <Image
      source={{ uri }}
      style={[style, logoImageStyle(logoShape, size)]}
      resizeMode="contain"
      accessibilityLabel={accessibilityLabel}
      accessibilityIgnoresInvertColors
    />
  );
}
