import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import {
  installLink,
  promptInstall,
  subscribeInstall,
  getInstallState,
  type InstallDevice,
  type InstallState,
} from '@/services/installService';
import { Button, FormSheet } from '@/components/ui';

/**
 * Installing the app, for people who have never installed a web app.
 *
 * The guide opens on the device being used, so the first thing somebody reads
 * is the answer for the phone in their hand. The other devices are one tap away
 * for the person reading it on a computer to tell their mother how to do it.
 *
 * Where the browser can install in one tap, that is the big button, and the
 * steps are the fallback. On iPhone there is no such button in any browser, so
 * the steps are the whole story — written for somebody who has never opened the
 * Share menu.
 */

/** Install state, kept current. */
export function useInstall(): InstallState {
  const [state, setState] = useState<InstallState>(getInstallState);
  useEffect(() => subscribeInstall(setState), []);
  return state;
}

const DEVICE_ICON: Record<InstallDevice, keyof typeof Ionicons.glyphMap> = {
  android: 'logo-android',
  ios: 'logo-apple',
  desktop: 'desktop-outline',
};

const STEP_ICONS: Record<InstallDevice, (keyof typeof Ionicons.glyphMap)[]> = {
  android: ['ellipsis-vertical', 'add-circle-outline', 'checkmark-circle-outline'],
  ios: ['share-outline', 'add-circle-outline', 'checkmark-circle-outline'],
  desktop: ['download-outline', 'open-outline', 'checkmark-circle-outline'],
};

export function InstallGuide({ onInstalled }: { onInstalled?: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const state = useInstall();
  const [device, setDevice] = useState<InstallDevice>(state.device);

  useEffect(() => setDevice(state.device), [state.device]);

  if (!state.web) {
    return <Text style={styles.lead}>{t('install.nativeApp')}</Text>;
  }

  if (state.installed) {
    return (
      <View style={styles.done}>
        <Ionicons name="checkmark-circle" size={36} color={colors.success} />
        <Text style={styles.doneText}>{t('install.installed')}</Text>
      </View>
    );
  }

  const thisDevice = device === state.device;
  const link = installLink();

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t('install.linkCopied'));
    } catch {
      // A browser that refuses the clipboard still shows the link to copy by hand.
      toast.show(link);
    }
  };

  const share = async () => {
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
    if (nav.share) {
      await nav.share({ title: t('install.pageTitle'), url: link }).catch(() => undefined);
    } else {
      await copyLink();
    }
  };

  const labels: Record<InstallDevice, string> = {
    android: t('install.deviceAndroid'),
    ios: t('install.deviceIos'),
    desktop: t('install.deviceDesktop'),
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.lead}>{t('install.lead')}</Text>

      <View style={styles.devices}>
        {(['android', 'ios', 'desktop'] as InstallDevice[]).map((option) => {
          const on = option === device;
          return (
            <Pressable
              key={option}
              onPress={() => setDevice(option)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={labels[option]}
              style={[styles.device, on && styles.deviceOn]}
            >
              <Ionicons
                name={DEVICE_ICON[option]}
                size={18}
                color={on ? colors.textInverse : colors.textSecondary}
              />
              <Text style={[styles.deviceText, on && styles.deviceTextOn]} numberOfLines={1}>
                {labels[option]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {thisDevice ? (
        <Text style={styles.detected}>{t('install.detected', { device: labels[state.device] })}</Text>
      ) : null}

      {/* A browser inside WhatsApp or Facebook cannot install anything. Saying
          so first saves somebody following steps that cannot work there. */}
      {thisDevice && (state.inAppBrowser || (device === 'ios' && state.iosNeedsSafari)) ? (
        <View style={styles.warning}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.accentDark} />
          <View style={{ flex: 1 }}>
            <Text style={styles.warningText}>
              {t(device === 'ios' ? 'install.iosSafari' : 'install.inApp')}
            </Text>
            <Button
              label={t('install.copyLink')}
              icon="copy-outline"
              size="sm"
              variant="outline"
              onPress={() => void copyLink()}
              style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}
            />
          </View>
        </View>
      ) : null}

      {thisDevice && state.oneTap && device !== 'ios' ? (
        <View style={styles.oneTap}>
          <Button
            label={t('install.installNow')}
            icon="download-outline"
            size="lg"
            fullWidth
            onPress={async () => {
              const outcome = await promptInstall();
              if (outcome === 'accepted') onInstalled?.();
            }}
          />
          <Text style={styles.oneTapHint}>{t('install.oneTapHint')}</Text>
        </View>
      ) : null}

      <Text style={styles.stepsTitle}>
        {t(thisDevice && state.oneTap && device !== 'ios' ? 'install.stepsTitle' : 'install.stepsTitleOnly')}
      </Text>
      {[1, 2, 3].map((n) => (
        <View key={n} style={styles.step}>
          <View style={styles.stepNumber}>
            <Text style={styles.stepNumberText}>{n}</Text>
          </View>
          <Ionicons name={STEP_ICONS[device][n - 1]} size={22} color={colors.primary} />
          <Text style={styles.stepText}>{t(`install.${device}${n}`)}</Text>
        </View>
      ))}

      <View style={styles.shareRow}>
        <Button
          label={t('install.share')}
          icon="share-social-outline"
          size="sm"
          variant="ghost"
          onPress={() => void share()}
        />
        <Button
          label={t('install.copyLink')}
          icon="link-outline"
          size="sm"
          variant="ghost"
          onPress={() => void copyLink()}
        />
      </View>
    </View>
  );
}

/** The guide in a sheet, opened from an Install App button. */
export function InstallSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <FormSheet visible={visible} title={t('install.sheetTitle')} onClose={onClose}>
      <InstallGuide onInstalled={onClose} />
    </FormSheet>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  lead: { fontSize: fontSize.md, color: colors.text, lineHeight: 23 },
  devices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  deviceOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  deviceText: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: fontWeight.semibold },
  deviceTextOn: { color: colors.textInverse },
  detected: { fontSize: fontSize.xs, color: colors.textMuted },
  warning: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
  },
  warningText: { fontSize: fontSize.sm, color: colors.text, lineHeight: 20 },
  oneTap: { marginTop: spacing.sm, gap: spacing.xs },
  oneTapHint: { fontSize: fontSize.xs, color: colors.textMuted, textAlign: 'center' },
  stepsTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginTop: spacing.md,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary },
  stepText: { flex: 1, fontSize: fontSize.md, color: colors.text, lineHeight: 22 },
  shareRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.sm },
  done: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg },
  doneText: { fontSize: fontSize.md, color: colors.text, textAlign: 'center', lineHeight: 23 },
});
