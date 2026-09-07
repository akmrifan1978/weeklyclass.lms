import React, { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { Stack, usePathname, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

import '@/i18n';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { scopeForSegments, type ScopeLanguages } from '@/i18n/scopes';
import { applyLanguage } from '@/i18n';
import { ToastProvider } from '@/contexts/ToastContext';
import { initAnalytics } from '@/firebase/analytics';
import { initAppCheck } from '@/firebase/appCheck';
import { addNotificationResponseListener } from '@/services/pushService';
import { brand } from '@/constants/theme';
import { LoadingState } from '@/components/ui';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Routes each signed-in user into the section their role owns, and everyone
 * else back to the splash screen. This is convenience, not security — the real
 * boundary is Firestore Security Rules.
 */
function RoleGate({ children }: { children: React.ReactNode }) {
  const { user, initialising } = useAuth();
  const { ready: languageReady } = useLanguage();
  const segments = useSegments();
  const pathname = usePathname();
  const router = useRouter();

  const booting = initialising || !languageReady;

  useEffect(() => {
    if (!booting) SplashScreen.hideAsync().catch(() => undefined);
  }, [booting]);

  useEffect(() => {
    if (booting) return;

    const group = segments[0];
    const inPublicArea = group === undefined || group === '(auth)';

    /**
     * The one public screen a signed-in person is NOT bounced off.
     *
     * Everything else under `(auth)` is a way in — sign in, register, recover a
     * password — and somebody already signed in has no business on any of them.
     * The programme's mission is not a way in; it is something to read, and
     * bouncing a student who taps it back to their dashboard would make it
     * unreadable to precisely the people who joined because of it.
     *
     * Matched on the pathname rather than the segments: mid-navigation the
     * segment list is briefly empty, which read as "on a public screen" and
     * fired the redirect before the route had settled. The page appeared and
     * then threw the reader out again.
     */
    // The two public reading screens. Everything else under `(auth)` is a way
    // in, and somebody already signed in has no business on those.
    if (
      pathname === '/about' ||
      pathname.endsWith('/about') ||
      pathname === '/guest' ||
      pathname.endsWith('/guest')
    ) {
      return;
    }

    if (!user) {
      // Signed out but sitting in a protected area.
      if (!inPublicArea) router.replace('/');
      return;
    }

    const home = {
      admin: '/(admin)',
      teacher: '/(teacher)',
      student: '/(student)',
    }[user.role] as '/(admin)' | '/(teacher)' | '/(student)';

    const expectedGroup = `(${user.role})`;

    // Signed in and either on a public screen or inside somebody else's area.
    if (inPublicArea || (group?.startsWith('(') && group !== expectedGroup)) {
      router.replace(home);
    }
  }, [booting, user, segments, pathname, router]);

  if (booting) {
    return (
      <View style={{ flex: 1, backgroundColor: brand.navyDeep, justifyContent: 'center' }}>
        <LoadingState />
      </View>
    );
  }

  return <>{children}</>;
}

/**
 * Pulls the per-dashboard language choices off the profile once it loads, so a
 * person signing in on a new device finds their dashboards already in the
 * languages they chose. The device's own stored choices still win — see
 * mergeScopeLanguages.
 */
function ScopeLanguageSync() {
  const { user } = useAuth();
  const { adoptScopeLanguages, languageFor } = useLanguage();
  const segments = useSegments();
  const stored = user?.dashboardLanguages;

  useEffect(() => {
    adoptScopeLanguages(stored as ScopeLanguages | undefined);
  }, [stored, adoptScopeLanguages]);

  // Applying from the route covers every screen in a dashboard, not only the
  // ones that ask. Without this, walking from the Qur'an into Lessons left
  // Lessons in the Qur'an's language.
  //
  // Persisting is off on purpose: reading one section in Arabic must not change
  // what the rest of the app opens in next time.
  const scope = scopeForSegments(segments as string[]);
  const scopeLanguage = scope ? languageFor(scope) : null;

  useEffect(() => {
    if (scopeLanguage) void applyLanguage(scopeLanguage, { persist: false });
  }, [scopeLanguage]);

  return null;
}

function RootNavigator() {
  const router = useRouter();

  // Opening a push notification jumps straight to the relevant screen.
  useEffect(() => {
    return addNotificationResponseListener((data) => {
      const route = typeof data.route === 'string' ? data.route : null;
      if (route) router.push(route as never);
    });
  }, [router]);

  return (
    <RoleGate>
      <ScopeLanguageSync />
      {/* Above the navigator so it cannot be present on one screen and missing
          on the next. */}
      <OfflineBanner />
      <Stack screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(student)" />
        <Stack.Screen name="(teacher)" />
        <Stack.Screen name="(admin)" />
      </Stack>
    </RoleGate>
  );
}

export default function RootLayout() {
  useEffect(() => {
    void initAnalytics();
    void initAppCheck();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LanguageProvider>
          <AuthProvider>
            <ToastProvider>
              <StatusBar style="light" />
              <RootNavigator />
            </ToastProvider>
          </AuthProvider>
        </LanguageProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export const unstable_settings = {
  initialRouteName: 'index',
};

// Web needs an explicit document title before the router mounts a screen.
if (Platform.OS === 'web' && typeof document !== 'undefined') {
  document.title = 'WeeklyClass LMS';

  // The manifest is what tells a browser this can be installed, and it has to
  // be linked from the document rather than merely present in the deploy.
  if (!document.querySelector('link[rel="manifest"]')) {
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = '/manifest.json';
    document.head.appendChild(link);
  }

  // And a service worker is the other half of the browser's test.
  //
  // Waiting for `load` was wrong: this module is itself part of the bundle the
  // load event waits for, so by the time it runs that event has usually already
  // fired and the listener was never called. The worker never registered and
  // the browser never offered an install. Register now when the document is
  // already done, and on load only when it genuinely has not happened yet.
  //
  // Silent throughout — a failure here costs an install prompt and nothing
  // else, and the app works identically without one.
  if ('serviceWorker' in navigator) {
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }
}
