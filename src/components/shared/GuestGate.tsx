import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { colors, fontSize, radius, spacing } from '@/constants/theme';
import { AppHeader, Button, Card, Screen } from '@/components/ui';

/**
 * Guest mode, and the few places it stops.
 *
 * A guest browses the student app without an account. Almost everything is
 * open to them; the exceptions are the things that only make sense for a
 * particular person — their results, their notes, booking a place, taking an
 * assignment — and those are what this file is for.
 *
 * NOT A SECURITY BOUNDARY. A guest is signed out, and the database refuses
 * every one of those writes on its own. This only replaces a confusing error
 * with a sentence saying what an account would give them, and a way to get one.
 */

/** "This needs an account", with the two ways to get one and a way out. */
export function GuestSignInCard({ message }: { message: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { exitGuest } = useAuth();

  return (
    <Card style={styles.card}>
      <View style={styles.head}>
        <View style={styles.icon}>
          <Ionicons name="lock-closed-outline" size={18} color={colors.accent} />
        </View>
        <Text style={styles.message}>{message}</Text>
      </View>

      <View style={styles.buttons}>
        <Button
          label={t('auth.login')}
          icon="log-in-outline"
          size="sm"
          onPress={() => router.push('/(auth)/login')}
          style={{ flex: 1 }}
        />
        <Button
          label={t('auth.register')}
          icon="person-add-outline"
          size="sm"
          variant="outline"
          onPress={() => router.push('/(auth)/register')}
          style={{ flex: 1 }}
        />
      </View>

      {/* Leaving is always offered. Somebody who tapped Guest Login by mistake
          should not have to find a setting to get back to the front page. */}
      <Button
        label={t('guestMode.exit')}
        icon="exit-outline"
        size="sm"
        variant="ghost"
        onPress={() => {
          void exitGuest().then(() => router.replace('/'));
        }}
      />
    </Card>
  );
}

/**
 * Shows the screen to everybody with an account, and the sign-in card to a guest.
 *
 * The wrapped screen is not rendered at all for a guest — not merely hidden —
 * so its data loads never run and never go to the database to be refused.
 */
export function GuestGate({
  children,
  messageKey,
  titleKey = 'guestMode.title',
  backButton = true,
}: {
  children: React.ReactNode;
  messageKey: string;
  titleKey?: string;
  /** Off for tab roots, which have nowhere to go back to. */
  backButton?: boolean;
}) {
  const { t } = useTranslation();
  const { isGuest } = useAuth();

  if (!isGuest) return <>{children}</>;

  return (
    <View style={{ flex: 1 }}>
      <AppHeader title={t(titleKey)} showBack={backButton} />
      <Screen>
        <GuestSignInCard message={t(messageKey)} />
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  icon: {
    width: 34,
    height: 34,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  message: { flex: 1, fontSize: fontSize.sm, color: colors.text, lineHeight: 21 },
  buttons: { flexDirection: 'row', gap: spacing.sm },
});
