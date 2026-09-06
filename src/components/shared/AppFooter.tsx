import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { getSettings } from '@/services/settingsService';

/**
 * The organisation's own footer: social links, contact, and its name.
 *
 * Everything here already lived in Settings and was never shown anywhere, so a
 * platform that had filled in its WhatsApp and YouTube had no way for anyone to
 * reach them. It sits at the bottom of each dashboard, where a footer belongs
 * and where it cannot get in the way of the day's work.
 *
 * A link that has not been set is not rendered. An empty row of grey icons that
 * do nothing reads as broken; showing only what exists reads as finished.
 */

const NETWORKS: {
  key: 'whatsapp' | 'youtube' | 'facebook' | 'instagram' | 'x' | 'website';
  icon: React.ComponentProps<typeof Ionicons>['name'];
  tint: string;
  href: (value: string) => string;
}[] = [
  {
    key: 'whatsapp',
    icon: 'logo-whatsapp',
    tint: '#25D366',
    // wa.me takes digits only; anything else and the link dies silently.
    href: (v) => `https://wa.me/${v.replace(/[^0-9]/g, '')}`,
  },
  { key: 'youtube', icon: 'logo-youtube', tint: '#FF0000', href: (v) => v },
  { key: 'facebook', icon: 'logo-facebook', tint: '#1877F2', href: (v) => v },
  { key: 'instagram', icon: 'logo-instagram', tint: '#E1306C', href: (v) => v },
  { key: 'x', icon: 'logo-twitter', tint: '#111111', href: (v) => v },
  { key: 'website', icon: 'globe-outline', tint: brand.navy, href: (v) => v },
];

export function AppFooter() {
  const { t } = useTranslation();
  const { data } = useAsync(() => getSettings(), []);

  if (!data) return null;

  const links = NETWORKS.map((network) => ({
    ...network,
    value: data.social?.[network.key]?.trim(),
  })).filter((network) => Boolean(network.value));

  const email = data.supportEmail?.trim();
  const phone = data.contactPhone?.trim();

  // Nothing configured at all — render nothing rather than an empty shell.
  if (links.length === 0 && !email && !phone) return null;

  return (
    <View style={styles.footer}>
      <View style={styles.divider} />

      <Text style={styles.name}>{data.appName}</Text>
      {data.tagline ? <Text style={styles.tagline}>{data.tagline}</Text> : null}

      {links.length ? (
        <View style={styles.row}>
          {links.map((network) => (
            <Pressable
              key={network.key}
              onPress={() => void Linking.openURL(network.href(network.value as string))}
              accessibilityRole="link"
              accessibilityLabel={network.key}
              hitSlop={6}
              style={({ pressed }) => [
                styles.icon,
                { backgroundColor: `${network.tint}1A` },
                pressed ? styles.pressed : null,
              ]}
            >
              <Ionicons name={network.icon} size={18} color={network.tint} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {phone ? (
        <Pressable onPress={() => void Linking.openURL(`tel:${phone}`)}>
          <Text style={styles.contact}>{phone}</Text>
        </Pressable>
      ) : null}
      {email ? (
        <Pressable onPress={() => void Linking.openURL(`mailto:${email}`)}>
          <Text style={styles.contact}>{email}</Text>
        </Pressable>
      ) : null}

      <Text style={styles.copyright}>
        {t('footer.copyright', { year: new Date().getFullYear(), name: data.appName })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { alignItems: 'center', paddingTop: spacing.xxl, paddingBottom: spacing.xl },
  divider: {
    height: 1,
    alignSelf: 'stretch',
    backgroundColor: colors.divider,
    marginBottom: spacing.xl,
  },
  name: { fontSize: fontSize.md, fontWeight: fontWeight.bold, color: colors.text },
  tagline: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },
  row: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  icon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  contact: { fontSize: fontSize.xs, color: colors.primary, marginTop: spacing.md },
  copyright: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.lg },
});
