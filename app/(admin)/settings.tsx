import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { DEFAULT_SETTINGS, ISLAMIC_FEATURES } from '@/constants/app';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { useAsync } from '@/hooks/useAsync';
import { friendlyMessage } from '@/utils/errors';
import { getSettings, updateSettings } from '@/services/settingsService';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import { ImageField } from '@/components/shared/ImageField';
import type { AppSettings, IslamicFeature, LanguageCode } from '@/types';
import {
  AsyncBoundary,
  Button,
  Card,
  Divider,
  Screen,
  SectionHeader,
  Select,
  SkeletonList,
  Spacer,
  TextField,
  ToggleRow,
} from '@/components/ui';

/**
 * Platform settings.
 *
 * The values here drive the splash screen, registration flow and contact
 * details, so admins can rebrand and open/close signups without a release.
 */
/** Toggle labels reuse the same keys the dashboards use for the tiles. */
const ISLAMIC_FEATURE_LABELS: Record<IslamicFeature, string> = {
  prayer: 'nav.prayer',
  quran: 'nav.quran',
  readingPlan: 'quran.dailyReading',
  tajweed: 'nav.tajweed',
  zakat: 'nav.zakat',
  hadith: 'nav.hadith',
};

function SettingsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();

  const [form, setForm] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(() => getSettings(true), []);
  const { data, loading, error, reload } = useAsync(load, []);

  useEffect(() => {
    if (data) {
      setForm(data);
      setDirty(false);
    }
  }, [data]);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  };

  const setSocial = (key: keyof AppSettings['social'], value: string) => {
    setForm((previous) => ({ ...previous, social: { ...previous.social, [key]: value } }));
    setDirty(true);
  };

  const handleSave = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await updateSettings(form, user);
      toast.success(t('settings.settingsSaved'));
      setDirty(false);
    } catch (err) {
      toast.error(friendlyMessage(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['bottom']}>
      <Text style={styles.title} accessibilityRole="header">
        {t('settings.title')}
      </Text>

      <Spacer />

      <AsyncBoundary loading={loading} error={error} onRetry={reload} skeleton={<SkeletonList count={4} />}>
        <SectionHeader title={t('settings.appIdentity')} icon="pricetag-outline" />
        <Card>
          <TextField
            label={t('settings.appName')}
            value={form.appName}
            onChangeText={(v) => set('appName', v)}
            icon="book-outline"
          />
          <TextField
            label={t('settings.tagline')}
            value={form.tagline}
            onChangeText={(v) => set('tagline', v)}
            multiline
          />
        </Card>

        <Spacer />

        <SectionHeader title={t('settings.branding')} icon="images-outline" />
        <Card>
          <Text style={styles.brandingNote}>{t('settings.brandingNote')}</Text>

          <ImageField
            label={t('settings.logo')}
            value={form.logoUrl ?? ''}
            onChange={(url) => set('logoUrl', url || null)}
            aspectRatio={1}
          />
          <ImageField
            label={t('settings.banner')}
            value={form.bannerUrl ?? ''}
            onChange={(url) => set('bannerUrl', url || null)}
            aspectRatio={3}
          />
          <ImageField
            label={t('settings.defaultThumbnail')}
            value={form.thumbnailUrl ?? ''}
            onChange={(url) => set('thumbnailUrl', url || null)}
            hint={t('settings.defaultThumbnailHint')}
            aspectRatio={16 / 9}
          />
          <ImageField
            label={t('settings.favicon')}
            value={form.faviconUrl ?? ''}
            onChange={(url) => set('faviconUrl', url || null)}
            aspectRatio={1}
          />
        </Card>

        <Spacer />

        <SectionHeader title={t('settings.colours')} icon="color-palette-outline" />
        <Card>
          <View style={styles.colorRow}>
            <View style={[styles.swatch, { backgroundColor: form.primaryColor }]} />
            <TextField
              label={t('settings.primaryColor')}
              value={form.primaryColor}
              onChangeText={(v) => set('primaryColor', v)}
              autoCapitalize="none"
              containerStyle={{ flex: 1, marginBottom: 0 }}
            />
          </View>
          <Spacer size={spacing.md} />
          <View style={styles.colorRow}>
            <View style={[styles.swatch, { backgroundColor: form.secondaryColor }]} />
            <TextField
              label={t('settings.secondaryColor')}
              value={form.secondaryColor}
              onChangeText={(v) => set('secondaryColor', v)}
              autoCapitalize="none"
              containerStyle={{ flex: 1, marginBottom: 0 }}
            />
          </View>
        </Card>

        <Spacer />

        <SectionHeader title={t('settings.contact')} icon="call-outline" />
        <Card>
          <TextField
            label={t('settings.supportEmail')}
            value={form.supportEmail}
            onChangeText={(v) => set('supportEmail', v)}
            icon="mail-outline"
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextField
            label={t('settings.contactPhone')}
            value={form.contactPhone}
            onChangeText={(v) => set('contactPhone', v)}
            icon="call-outline"
            keyboardType="phone-pad"
            containerStyle={{ marginBottom: 0 }}
          />
        </Card>

        <Spacer />

        <SectionHeader title={t('settings.socialLinks')} icon="share-social-outline" />
        <Card>
          <TextField
            label="Website"
            value={form.social.website ?? ''}
            onChangeText={(v) => setSocial('website', v)}
            icon="globe-outline"
            autoCapitalize="none"
          />
          <TextField
            label="YouTube"
            value={form.social.youtube ?? ''}
            onChangeText={(v) => setSocial('youtube', v)}
            icon="logo-youtube"
            autoCapitalize="none"
          />
          <TextField
            label="Facebook"
            value={form.social.facebook ?? ''}
            onChangeText={(v) => setSocial('facebook', v)}
            icon="logo-facebook"
            autoCapitalize="none"
          />
          <TextField
            label="Instagram"
            value={form.social.instagram ?? ''}
            onChangeText={(v) => setSocial('instagram', v)}
            icon="logo-instagram"
            autoCapitalize="none"
          />
          <TextField
            label="WhatsApp"
            value={form.social.whatsapp ?? ''}
            onChangeText={(v) => setSocial('whatsapp', v)}
            icon="logo-whatsapp"
            autoCapitalize="none"
            containerStyle={{ marginBottom: 0 }}
          />
        </Card>

        <Spacer />

        <SectionHeader title={t('settings.localisation')} icon="language-outline" />
        <Card>
          <Select<LanguageCode>
            label={t('settings.defaultLanguage')}
            value={form.defaultLanguage}
            options={[
              { value: 'en', label: 'English' },
              { value: 'ta', label: 'தமிழ்' },
              { value: 'si', label: 'සිංහල' },
              { value: 'ar', label: 'العربية' },
            ]}
            onChange={(v) => set('defaultLanguage', v)}
            containerStyle={{ marginBottom: 0 }}
          />
        </Card>

        <Spacer />

        <SectionHeader title={t('settings.registration')} icon="person-add-outline" />
        <Card>
          <ToggleRow
            label={t('settings.registrationEnabled')}
            value={form.registrationEnabled}
            onValueChange={(v) => set('registrationEnabled', v)}
          />
          <Divider />
          <ToggleRow
            label={t('settings.requireApproval')}
            description={t('auth.registrationPendingApproval')}
            value={form.requireApproval}
            onValueChange={(v) => set('requireApproval', v)}
          />
        </Card>

        <Spacer />

        {/*
          One switch per section, platform-wide. These are offered to students,
          teachers and admins alike — they are for the person, not tools tied to
          a role — so there is nothing per-role to configure here.
        */}
        <SectionHeader title={t('settings.islamicSections')} icon="moon-outline" />
        <Card>
          <Text style={styles.sectionHint}>{t('settings.islamicSectionsHint')}</Text>
          {ISLAMIC_FEATURES.map((feature, index) => (
            <React.Fragment key={feature}>
              {index > 0 ? <Divider /> : null}
              <ToggleRow
                label={t(ISLAMIC_FEATURE_LABELS[feature])}
                value={form.islamicFeatures?.[feature] !== false}
                onValueChange={(value) =>
                  set('islamicFeatures', {
                    ...(form.islamicFeatures ?? {}),
                    [feature]: value,
                  })
                }
              />
            </React.Fragment>
          ))}
        </Card>

        <Spacer />

        <Button
          label={t('common.save')}
          icon="save-outline"
          fullWidth
          size="lg"
          loading={busy}
          disabled={!dirty}
          onPress={handleSave}
        />

        <Spacer size={spacing.xxxl} />
      </AsyncBoundary>
    </Screen>
  );
}

export default function AdminSettings() {
  return (
    <PermissionGuard permission="MANAGE_SETTINGS">
      <SettingsScreen />
    </PermissionGuard>
  );
}

const styles = StyleSheet.create({
  sectionHint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    paddingTop: spacing.sm,
  },
  brandingNote: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  colorRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
