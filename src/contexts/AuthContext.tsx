import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { COLLECTIONS, STORAGE_KEYS } from '@/constants/app';
import { watchDoc } from '@/services/firestore';
import * as authService from '@/services/authService';
import * as pushService from '@/services/pushService';
import { setAnalyticsUser, logEvent, AnalyticsEvents } from '@/firebase/analytics';
import { useSessionTimeout } from '@/hooks/useSessionTimeout';
import { allPermissions } from '@/types/permissions';
import type { AppUser, Permission, PermissionMap } from '@/types';

/**
 * Session state.
 *
 * The profile is kept on a live Firestore listener rather than fetched once, so
 * that an admin revoking a permission or suspending an account takes effect in
 * the open app immediately — no logout required.
 */

interface AuthContextValue {
  /** null once loading finishes and nobody is signed in. */
  user: AppUser | null;
  /** True until the first auth state + profile resolution completes. */
  initialising: boolean;
  /** True while a login/logout call is in flight. */
  busy: boolean;
  permissions: PermissionMap;
  can: (permission: Permission) => boolean;
  canAny: (...permissions: Permission[]) => boolean;
  isAdmin: boolean;
  isTeacher: boolean;
  isStudent: boolean;
  login: (identifier: string, password: string) => Promise<AppUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Asks for push permission and stores the token on the profile. */
  enablePush: () => Promise<pushService.PushRegistration>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [initialising, setInitialising] = useState(true);
  const [busy, setBusy] = useState(false);
  const profileUnsubscribe = useRef<(() => void) | null>(null);

  const stopWatching = useCallback(() => {
    profileUnsubscribe.current?.();
    profileUnsubscribe.current = null;
  }, []);

  /** Keeps the profile in sync and signs the user out if access is revoked. */
  const watchProfile = useCallback(
    (uid: string) =>
      new Promise<void>((resolve) => {
        stopWatching();
        let settled = false;
        profileUnsubscribe.current = watchDoc<AppUser>(
          COLLECTIONS.users,
          uid,
          (profile) => {
            if (!profile || profile.status !== 'active' || profile.deleted) {
              setUser(null);
              stopWatching();
              void authService.logout(null);
            } else {
              setUser(profile);
              void AsyncStorage.setItem(
                STORAGE_KEYS.cachedProfile,
                JSON.stringify({ uid: profile.uid, role: profile.role })
              ).catch(() => undefined);
            }
            if (!settled) {
              settled = true;
              resolve();
            }
          },
          () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          }
        );
      }),
    [stopWatching]
  );

  useEffect(() => {
    const unsubscribe = authService.subscribeToAuth(async (firebaseUser) => {
      if (!firebaseUser) {
        stopWatching();
        setUser(null);
        setAnalyticsUser(null);
        setInitialising(false);
        return;
      }
      await watchProfile(firebaseUser.uid);
      setInitialising(false);
    });

    return () => {
      unsubscribe();
      stopWatching();
    };
  }, [stopWatching, watchProfile]);

  useEffect(() => {
    if (user) {
      setAnalyticsUser(user.uid, { role: user.role, country: user.country });
    }
  }, [user]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      setBusy(true);
      try {
        const { user: profile } = await authService.login(identifier, password);
        await watchProfile(profile.uid);
        logEvent(AnalyticsEvents.login, { role: profile.role });
        return profile;
      } finally {
        setBusy(false);
      }
    },
    [watchProfile]
  );

  const logout = useCallback(async () => {
    setBusy(true);
    try {
      logEvent(AnalyticsEvents.logout);
      await pushService.cancelAllLocal();
      await authService.logout(user);
      stopWatching();
      setUser(null);
    } finally {
      setBusy(false);
    }
  }, [stopWatching, user]);

  // Signed in and idle for too long ends the session. `logout` is already
  // safe to call when nothing is signed in, and the hook only runs while
  // somebody is.
  const { markActive } = useSessionTimeout({
    active: user !== null,
    onTimeout: () => {
      void logout();
    },
  });

  const refresh = useCallback(async () => {
    const firebaseUser = authService.currentFirebaseUser();
    if (!firebaseUser) return;
    const profile = await authService.fetchProfile(firebaseUser.uid);
    if (profile) setUser(profile);
  }, []);

  const enablePush = useCallback(async () => {
    const registration = await pushService.registerForPush();
    if (registration.token && user) {
      await pushService.saveToken(user.uid, registration.token).catch(() => undefined);
    }
    return registration;
  }, [user]);

  const permissions = useMemo<PermissionMap>(() => {
    if (!user) return {};
    return user.role === 'admin' ? allPermissions() : (user.permissions ?? {});
  }, [user]);

  const can = useCallback(
    (permission: Permission) => {
      if (!user || user.status !== 'active') return false;
      if (user.role === 'admin') return true;
      return user.permissions?.[permission] === true;
    },
    [user]
  );

  const canAny = useCallback(
    (...list: Permission[]) => list.some((permission) => can(permission)),
    [can]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      initialising,
      busy,
      permissions,
      can,
      canAny,
      isAdmin: user?.role === 'admin',
      isTeacher: user?.role === 'teacher',
      isStudent: user?.role === 'student',
      login,
      logout,
      refresh,
      enablePush,
    }),
    [user, initialising, busy, permissions, can, canAny, login, logout, refresh, enablePush]
  );

  return (
    <AuthContext.Provider value={value}>
      {/*
        Capture-phase, and it always returns false: this observes that a touch
        happened and declines to handle it, so every gesture underneath behaves
        exactly as it would without this wrapper. The alternative — asking each
        screen to report activity — would be forgotten by the first screen
        somebody adds next month.
      */}
      <View
        style={{ flex: 1 }}
        onStartShouldSetResponderCapture={() => {
          markActive();
          return false;
        }}
      >
        {children}
      </View>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}

/** Convenience for gating a screen section on a permission. */
export function usePermission(permission: Permission): boolean {
  return useAuth().can(permission);
}
