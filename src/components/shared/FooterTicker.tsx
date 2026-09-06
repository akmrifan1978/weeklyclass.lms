import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { watchSettings } from '@/services/settingsService';

/**
 * The scrolling line above the bottom menu.
 *
 * Its whole value is that it needs no release. An admin types an announcement,
 * a term date, a closure, and it is on every phone the next time the app opens
 * — which is why the text comes from a live settings listener rather than being
 * read once at launch.
 *
 * The text is one long string holding every language at once, separated by the
 * admin however they like. That is deliberate: this line is read by a mixed
 * room, and picking one language for it would be picking who the announcement
 * is for.
 */
export function FooterTicker() {
  const [text, setText] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);
  const [textWidth, setTextWidth] = useState(0);

  const offset = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    return watchSettings((settings) => {
      setEnabled(settings.tickerEnabled === true);
      setText(settings.tickerText?.trim() ?? '');
    });
  }, []);

  useEffect(() => {
    if (!enabled || !text || trackWidth === 0 || textWidth === 0) return;

    // Speed, not duration: a two-word notice and a three-language paragraph
    // should travel at the same readable pace rather than taking the same time.
    const distance = trackWidth + textWidth;
    const duration = (distance / 45) * 1000;

    offset.setValue(trackWidth);
    const animation = Animated.loop(
      Animated.timing(offset, {
        toValue: -textWidth,
        duration,
        easing: Easing.linear,
        // The transform is the only thing changing, so this runs off the JS
        // thread and keeps scrolling while the app is busy elsewhere.
        useNativeDriver: true,
      })
    );
    animation.start();

    return () => animation.stop();
  }, [enabled, text, trackWidth, textWidth, offset]);

  if (!enabled || !text) return null;

  return (
    <View
      style={styles.track}
      onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      // One announcement read aloud once, rather than a marquee a screen reader
      // would chase across the screen.
      accessible
      accessibilityRole="text"
      accessibilityLabel={text}
    >
      {/* Absolutely positioned so the text is measured at its natural width.
          A child in normal flow is bounded by the track, and a one-line Text
          bounded by the track is a truncated Text — there would be nothing
          overflowing to scroll. */}
      <Animated.View
        style={[styles.runner, { transform: [{ translateX: offset }] }]}
      >
        <Text
          style={styles.text}
          numberOfLines={1}
          ellipsizeMode="clip"
          onLayout={(event) => setTextWidth(event.nativeEvent.layout.width)}
          // Already announced by the wrapper above; announcing it twice is
          // worse than not announcing it at all.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {text}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 26,
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
  },
  runner: { position: 'absolute', top: 0, bottom: 0, left: 0, justifyContent: 'center' },
  text: {
    color: colors.textInverse,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
});
