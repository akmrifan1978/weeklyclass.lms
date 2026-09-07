import React, { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { brand, colors, radius } from '@/constants/theme';
import { ConfirmDialog } from '@/components/ui';

/**
 * Signing out, from the corner of the screen somebody starts on.
 *
 * It also lives at the foot of the admin navigation and inside the profile, but
 * both of those are somewhere to go and find. On a shared phone the person who
 * wants out wants out now, and a tap they have to hunt for is a session left
 * open on somebody else's device.
 *
 * Still behind a confirmation. The whole point is that it is easy to reach,
 * which is also what makes it easy to hit by accident.
 */
export function LogoutButton({ tint = colors.textInverse }: { tint?: string }) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setConfirming(true)}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={t('auth.logout')}
        style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Ionicons name="log-out-outline" size={20} color={tint} />
      </Pressable>

      <ConfirmDialog
        visible={confirming}
        title={t('auth.logout')}
        message={t('auth.logoutConfirm')}
        confirmLabel={t('auth.logout')}
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void logout();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: brand.red + '22',
  },
});
