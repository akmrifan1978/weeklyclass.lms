import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { useAuth } from '@/contexts/AuthContext';
import { brand } from '@/constants/theme';
import { LoadingState } from '@/components/ui';

/**
 * Guest Login.
 *
 * Starts a guest visit and goes straight into the app. It used to be a small
 * shop window of its own showing a few articles; a guest now sees the whole
 * student app instead, apart from what needs an account — see GuestGate.
 *
 * Somebody already signed in is not turned into a guest. They are sent home.
 */
export default function GuestScreen() {
  const router = useRouter();
  const { user, isGuest, initialising, enterGuest } = useAuth();
  const started = useRef(false);

  useEffect(() => {
    if (initialising || started.current) return;
    started.current = true;

    if (user && !isGuest) {
      router.replace('/');
      return;
    }
    void enterGuest().then(() => router.replace('/(student)'));
  }, [initialising, user, isGuest, enterGuest, router]);

  return (
    <View style={{ flex: 1, backgroundColor: brand.navyDeep, justifyContent: 'center' }}>
      <LoadingState />
    </View>
  );
}
