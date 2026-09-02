import React from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, radius, spacing } from '@/constants/theme';
import { embedUrl } from '@/services/videoService';
import { Button } from '@/components/ui';

/**
 * Plays a video from any source without bundling a heavy player.
 *
 * - YouTube / Vimeo links become embeds (an iframe on web, a WebView on native).
 * - Anything else gets an "open in browser" action, which covers direct MP4s,
 *   Google Drive links and Firebase Storage URLs.
 *
 * Keeping playback URL-based is what allows video hosting to stay free — no
 * media is ever uploaded to Firebase Storage.
 */
export function VideoPlayer({ url, title }: { url: string; title?: string }) {
  const { t } = useTranslation();
  const embed = embedUrl(url);

  if (!embed) {
    return (
      <View style={styles.fallback}>
        <Ionicons name="play-circle-outline" size={44} color={colors.slate} />
        <Text style={styles.fallbackText} numberOfLines={2}>
          {title ?? t('video.watch')}
        </Text>
        <Button
          label={t('video.openExternally')}
          icon="open-outline"
          onPress={() => Linking.openURL(url).catch(() => undefined)}
          variant="primary"
          style={{ marginTop: spacing.md }}
        />
      </View>
    );
  }

  if (Platform.OS === 'web') {
    // react-native-web renders unknown lowercase elements as DOM nodes, so an
    // iframe here avoids pulling WebView into the web bundle.
    return (
      <View style={styles.frame}>
        {React.createElement('iframe', {
          src: embed,
          title: title ?? 'video',
          width: '100%',
          height: '100%',
          frameBorder: '0',
          allow: 'accelerometer; clipboard-write; encrypted-media; picture-in-picture',
          allowFullScreen: true,
          style: { border: 0, borderRadius: radius.lg },
        })}
      </View>
    );
  }

  return (
    <View style={styles.frame}>
      <WebView
        source={{ uri: embed }}
        style={styles.webview}
        allowsFullscreenVideo
        javaScriptEnabled
        domStorageEnabled
        mediaPlaybackRequiresUserAction={false}
        accessibilityLabel={title}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  webview: { flex: 1, backgroundColor: '#000' },
  fallback: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  fallbackText: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
});
