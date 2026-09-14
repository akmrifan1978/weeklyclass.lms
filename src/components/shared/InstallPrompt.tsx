import React, { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { brand, colors, fontSize, fontWeight, radius, shadow, spacing } from '@/constants/theme';
import { promptInstall, subscribeInstall } from '@/services/installService';

/**
 * "Add this to your phone", offered once the browser says it is possible.
 *
 * Installing turns the site into something with an icon on the home screen that
 * opens without browser chrome — which for a weekly class is the difference
 * between a link somebody has to find and an app they see every day.
 *
 * The browser decides when this is possible, not us: it fires
 * `beforeinstallprompt` only over HTTPS, with a manifest, with a service worker
 * registered, and only when the site is not already installed. So there is no
 * button until there is genuinely something to install — nothing here can offer
 * an install that then fails.
 *
 * Dismissal is remembered. Somebody who said no does not want to be asked on
 * every screen for the rest of the year.
 */

const DISMISSED_KEY = 'weeklyclass.installPrompt.dismissed';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function InstallPrompt() {
  const { t } = useTranslation();
  const [event, setEvent] = useState<InstallEvent | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(DISMISSED_KEY) === '1';
    } catch {
      // A browser refusing storage is not a reason to hide the prompt.
    }
    if (dismissed) return;

    // The browser's offer is captured once, early, by installService — it
    // fires before this banner exists, so listening here would miss it.
    return subscribeInstall((state) =>
      setEvent(state.oneTap && !state.installed ? ({} as InstallEvent) : null)
    );
  }, []);

  if (!event) return null;

  const remember = () => {
    try {
      window.localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Then they get asked again next time, which is the lesser harm.
    }
  };

  return (
    <View style={styles.bar}>
      <Ionicons name="phone-portrait-outline" size={18} color={colors.textInverse} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{t('install.title')}</Text>
        <Text style={styles.body} numberOfLines={2}>
          {t('install.body')}
        </Text>
      </View>

      <Pressable
        onPress={async () => {
          // Cleared first: the browser allows one prompt per offer, and leaving
          // the button on screen would invite a second tap that does nothing.
          setEvent(null);
          const outcome = await promptInstall();
          if (outcome === 'dismissed') remember();
        }}
        accessibilityRole="button"
        style={({ pressed }) => [styles.action, { opacity: pressed ? 0.85 : 1 }]}
      >
        <Text style={styles.actionText}>{t('install.action')}</Text>
      </Pressable>

      <Pressable
        onPress={() => {
          remember();
          setEvent(null);
        }}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
      >
        <Ionicons name="close" size={18} color={colors.textInverse} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: brand.navy,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
    ...shadow.md,
  },
  title: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.textInverse },
  body: { fontSize: fontSize.xs, color: 'rgba(255,255,255,0.78)', marginTop: 1 },
  action: {
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  actionText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: brand.navyDeep },
});
