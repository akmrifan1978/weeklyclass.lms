import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PublicPage } from '@/components/public/PublicPage';
import { InstallGuide } from '@/components/shared/InstallApp';
import { colors, radius, spacing } from '@/constants/theme';

/**
 * A page of its own for installing the app: weeklyclass-lms.web.app/install.
 *
 * So a teacher can send one link in a WhatsApp group and every family lands on
 * the right instructions for the phone they opened it on, without having to
 * find a button on the front page first.
 *
 * Public, like the rest of the website: nobody needs an account to install.
 */
export default function PublicInstall() {
  const { t } = useTranslation();

  return (
    <PublicPage badge={t('install.open')} title={t('install.pageTitle')} subtitle={t('install.pageLead')}>
      <View style={styles.card}>
        <InstallGuide />
      </View>
    </PublicPage>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
});
