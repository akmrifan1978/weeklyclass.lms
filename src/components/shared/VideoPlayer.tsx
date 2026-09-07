import React from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, radius, spacing } from '@/constants/theme';
import { embedUrl } from '@/services/videoService';
import { Button } from '@/components/ui';

/**
 * Recognises a URL that is the video itself rather than a page about one.
 *
 * A lesson recorded in the app is delivered straight from Cloudinary, so it has
 * no embed page to put in a frame — it is a file, and a file wants a player.
 * Cloudinary's delivery URLs are matched by path because the format conversion
 * they carry leaves the extension off the end.
 */
function isDirectMedia(url: string): boolean {
  if (/\/video\/upload\//.test(url) && url.includes('res.cloudinary.com')) return true;
  return /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(url);
}

/**
 * Plays a video from any source without bundling a heavy player.
 *
 * - YouTube / Vimeo links become embeds (an iframe on web, a WebView on native).
 * - A direct media file is played in place — this is the path a lesson recorded
 *   in the app takes, and sending somebody out to a browser tab to watch their
 *   own class would be a strange way to end the recording flow.
 * - Anything else gets an "open in browser" action, which still covers Google
 *   Drive links and everything unrecognised.
 */
export function VideoPlayer({ url, title }: { url: string; title?: string }) {
  const { t } = useTranslation();
  const embed = embedUrl(url);
  const direct = !embed && isDirectMedia(url);

  if (direct && Platform.OS === 'web') {
    return (
      <View style={styles.frame}>
        {React.createElement('video', {
          src: url,
          title,
          controls: true,
          playsInline: true,
          preload: 'metadata',
          style: { width: '100%', height: '100%', background: '#000', borderRadius: radius.lg },
        })}
      </View>
    );
  }

  if (!embed && !direct) {
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
        source={{ uri: embed ?? url }}
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
