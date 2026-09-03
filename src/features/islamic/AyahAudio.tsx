import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';

/**
 * Plays the recitation of one ayah.
 *
 * `expo-audio` is loaded lazily rather than imported at the top. Audio is
 * optional and off by default, so a screen that never plays anything should not
 * pay for the module — and on web the import resolves differently, which is
 * easier to contain here than to unpick from a static import graph.
 */

type Player = {
  play: () => void;
  pause: () => void;
  remove: () => void;
};

export function AyahAudio({ url, size = 30 }: { url: string; size?: number }) {
  const { t } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [player, setPlayer] = useState<Player | null>(null);
  const [failed, setFailed] = useState(false);

  // Stop and release when this ayah scrolls away or the screen closes. Without
  // it, recitation carries on playing over whatever the person opened next.
  useEffect(() => {
    return () => {
      try {
        player?.pause();
        player?.remove();
      } catch {
        // Already gone.
      }
    };
  }, [player]);

  const toggle = async () => {
    if (playing) {
      player?.pause();
      setPlaying(false);
      return;
    }

    try {
      if (player) {
        player.play();
        setPlaying(true);
        return;
      }

      if (Platform.OS === 'web') {
        const audio = new (globalThis as unknown as { Audio: new (src: string) => HTMLAudioElement }).Audio(url);
        audio.addEventListener('ended', () => setPlaying(false));
        audio.addEventListener('error', () => {
          setFailed(true);
          setPlaying(false);
        });
        void audio.play();
        setPlayer({
          play: () => void audio.play(),
          pause: () => audio.pause(),
          remove: () => {
            audio.pause();
            audio.src = '';
          },
        });
        setPlaying(true);
        return;
      }

      const { createAudioPlayer } = await import('expo-audio');
      const instance = createAudioPlayer({ uri: url });
      instance.play();
      setPlayer({
        play: () => instance.play(),
        pause: () => instance.pause(),
        remove: () => instance.remove(),
      });
      setPlaying(true);
    } catch {
      setFailed(true);
      setPlaying(false);
    }
  };

  if (failed) {
    return <Text style={styles.failed}>{t('quran.audioUnavailable')}</Text>;
  }

  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="button"
      accessibilityLabel={t(playing ? 'quran.pauseRecitation' : 'quran.playRecitation')}
      accessibilityState={{ selected: playing }}
      hitSlop={8}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size },
        playing ? styles.buttonActive : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <Ionicons
        name={playing ? 'pause' : 'play'}
        size={size * 0.5}
        color={playing ? colors.textInverse : colors.primary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonActive: { backgroundColor: colors.primary },
  pressed: { opacity: 0.6 },
  failed: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: fontWeight.medium },
});
