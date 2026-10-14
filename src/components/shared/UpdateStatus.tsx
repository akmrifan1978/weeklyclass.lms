import React, { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, fontWeight, spacing } from '@/constants/theme';
import { Button } from '@/components/ui';

/**
 * Which version this device is running, and whether it is the current one.
 *
 * WHY A SCREEN NEEDS TO SAY THIS. The app updates itself: when it comes back to
 * the foreground it asks the server which bundle is current and reloads if that
 * differs from the one it started with. That works, and it is invisible — so
 * "has this phone got the new version?" had no answer anywhere, and the only
 * way to find out was to hunt for a change that ought to be there. With fifty
 * devices in a centre that is not a workable way to tell.
 *
 * So: the version this device is running, whether it matches the server, and a
 * button when it does not. The check is one request for index.html with
 * `no-store`, made when this screen opens — the page is tiny and the answer has
 * to be the server's rather than a copy of the question.
 *
 * Web only. A native build's version comes from the store, not from here.
 */

type State = 'checking' | 'current' | 'stale' | 'unknown';

/** The bundle this page is running, taken from the script tag that loaded it. */
function runningBuild(): string | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  return (
    Array.from(document.querySelectorAll('script[src]'))
      .map((el) => (el as HTMLScriptElement).src.match(/entry-([a-f0-9]+)\.js/)?.[1])
      .find(Boolean) ?? null
  );
}

export function UpdateStatus() {
  const { t } = useTranslation();
  const [state, setState] = useState<State>('checking');
  const [running, setRunning] = useState<string | null>(null);

  const check = useCallback(async () => {
    const mine = runningBuild();
    setRunning(mine);
    // No hashed bundle means the development server, where the question has no
    // meaning and the answer would be a reload loop.
    if (!mine) return setState('unknown');

    setState('checking');
    try {
      const html = await fetch('/index.html', { cache: 'no-store' }).then((r) => r.text());
      const deployed = html.match(/entry-([a-f0-9]+)\.js/)?.[1];
      if (!deployed) return setState('unknown');
      setState(deployed === mine ? 'current' : 'stale');
    } catch {
      // Offline, or the server is unreachable. Not stale, just unknown.
      setState('unknown');
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (Platform.OS !== 'web') return null;

  const tone =
    state === 'current' ? colors.success : state === 'stale' ? colors.warning : colors.textMuted;
  const icon =
    state === 'current'
      ? 'checkmark-circle-outline'
      : state === 'stale'
        ? 'arrow-down-circle-outline'
        : 'help-circle-outline';

  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={18} color={tone} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: tone }]}>
          {t(
            state === 'current'
              ? 'profile.versionCurrent'
              : state === 'stale'
                ? 'profile.versionStale'
                : state === 'checking'
                  ? 'profile.versionChecking'
                  : 'profile.versionUnknown'
          )}
        </Text>
        {running ? <Text style={styles.build}>{running.slice(0, 8)}</Text> : null}
      </View>
      {state === 'stale' ? (
        <Button
          label={t('profile.updateNow')}
          icon="refresh-outline"
          size="sm"
          onPress={() => window.location.reload()}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  build: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
});
