import React, { useMemo } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { PublicPage } from '@/components/public/PublicPage';
import { ListState, PublicCard, SignInPrompt } from '@/components/public/PublicControls';
import { useAsync } from '@/hooks/useAsync';
import { getSettings } from '@/services/settingsService';
import { brand, colors, fontSize, fontWeight, radius, spacing, TOUCH_TARGET } from '@/constants/theme';

/**
 * How to reach the centre.
 *
 * Every line comes from `settings/app`, which is world-readable so the public
 * pages can show the organisation's own identity — so an admin changes an
 * address here by editing Settings, not by asking for a release.
 *
 * These are the CENTRE's channels. No member of staff's own address or number
 * appears on this page, or anywhere else on the public site: a student reaches
 * a teacher through the app, which is the rule the platform has always kept.
 */
export default function PublicContact() {
  const { t } = useTranslation();
  const { data: settings, loading, refreshing, refresh } = useAsync(() => getSettings(), []);

  const channels = useMemo(() => {
    if (!settings) return [];
    const social = settings.social ?? {};

    return [
      {
        key: 'email',
        icon: 'mail-outline' as const,
        label: t('settings.supportEmail'),
        value: settings.supportEmail,
        url: settings.supportEmail ? `mailto:${settings.supportEmail}` : null,
      },
      {
        key: 'phone',
        icon: 'call-outline' as const,
        label: t('settings.contactPhone'),
        value: settings.contactPhone,
        url: settings.contactPhone ? `tel:${settings.contactPhone.replace(/\s+/g, '')}` : null,
      },
      {
        key: 'whatsapp',
        icon: 'logo-whatsapp' as const,
        label: 'WhatsApp',
        value: social.whatsapp,
        url: social.whatsapp ?? null,
      },
      {
        key: 'website',
        icon: 'globe-outline' as const,
        label: t('public.contact.website'),
        value: social.website,
        url: social.website ?? null,
      },
      {
        key: 'youtube',
        icon: 'logo-youtube' as const,
        label: 'YouTube',
        value: social.youtube,
        url: social.youtube ?? null,
      },
      {
        key: 'facebook',
        icon: 'logo-facebook' as const,
        label: 'Facebook',
        value: social.facebook,
        url: social.facebook ?? null,
      },
      {
        key: 'instagram',
        icon: 'logo-instagram' as const,
        label: 'Instagram',
        value: social.instagram,
        url: social.instagram ?? null,
      },
    ].filter((channel) => Boolean(channel.value?.trim()));
  }, [settings, t]);

  return (
    <PublicPage
      badge={t('public.contact.badge')}
      title={t('public.contact.title')}
      subtitle={t('public.contact.lead')}
      onRefresh={refresh}
      refreshing={refreshing}
    >
      {settings?.venue?.trim() ? (
        <PublicCard>
          <View style={styles.venueRow}>
            <View style={styles.venueMark}>
              <Ionicons name="location" size={18} color={brand.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.venueLabel}>{t('settings.venueLabel')}</Text>
              <Text style={styles.venue}>{settings.venue}</Text>
            </View>
          </View>
        </PublicCard>
      ) : null}

      <ListState
        loading={loading}
        empty={channels.length === 0}
        icon="mail-outline"
        title={t('public.contact.emptyTitle')}
        message={t('public.contact.emptyBody')}
      />

      {channels.length > 0 ? (
        <PublicCard>
          {channels.map((channel, index) => (
            <Pressable
              key={channel.key}
              onPress={() => {
                if (channel.url) Linking.openURL(channel.url).catch(() => undefined);
              }}
              disabled={!channel.url}
              accessibilityRole="link"
              accessibilityLabel={`${channel.label}: ${channel.value}`}
              style={({ pressed }) => [
                styles.channel,
                index > 0 && styles.channelDivided,
                { opacity: pressed ? 0.65 : 1 },
              ]}
            >
              <Ionicons name={channel.icon} size={17} color={brand.navy} />
              <View style={{ flex: 1 }}>
                <Text style={styles.channelLabel}>{channel.label}</Text>
                <Text style={styles.channelValue} numberOfLines={1}>
                  {channel.value}
                </Text>
              </View>
              <Ionicons name="open-outline" size={15} color={colors.textMuted} />
            </Pressable>
          ))}
        </PublicCard>
      ) : null}

      {/* Support inside the app is a different thing from a public address: it
          is attached to an account, so a reply can reach the right person. */}
      <SignInPrompt message={t('public.contact.supportNote')} />
    </PublicPage>
  );
}

const styles = StyleSheet.create({
  venueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  venueMark: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  venueLabel: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  venue: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    color: brand.navyDeep,
    marginTop: 2,
    lineHeight: 21,
  },

  channel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: TOUCH_TARGET,
    paddingVertical: spacing.sm,
  },
  channelDivided: { borderTopWidth: 1, borderTopColor: colors.divider },
  channelLabel: { fontSize: fontSize.xs, color: colors.textMuted },
  channelValue: {
    fontSize: fontSize.sm,
    color: brand.navyDeep,
    fontWeight: fontWeight.semibold,
    marginTop: 1,
  },
});
