import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { colors } from '@/constants/theme';
import { EmptyState, LoadingState, NoAccessState, Screen } from '@/components/ui';
import type { Permission, UserRole } from '@/types';

/**
 * Client-side role gate for a whole section.
 *
 * This is a navigation convenience, not a security boundary — a determined user
 * can always call Firestore directly. Access is genuinely enforced by
 * `firebase/firestore.rules`; this just avoids showing people screens that
 * would fail to load.
 */
export function RoleGuard({
  role,
  children,
}: {
  role: UserRole;
  children: React.ReactNode;
}) {
  const { user, initialising } = useAuth();

  if (initialising) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  if (!user || user.role !== role) return <Mismatch />;

  return <>{children}</>;
}

/**
 * What a role mismatch looks like while the redirect runs — and if it doesn't.
 *
 * The redirect itself lives in app/_layout.tsx, and rendering nothing here is
 * right for the moment it takes: a flash of somebody else's dashboard is worse
 * than a blank instant. But nothing is only right for an instant. If the
 * redirect does not happen — a route in the wrong section, a role that changed
 * under the app, a navigation the gate did not expect — then "nothing" is what
 * the person keeps, with no title, no message and no way out, which is
 * indistinguishable from a broken app and cannot be diagnosed from a report.
 *
 * So: nothing for a second and a half, then an honest sentence and a button.
 */
function Mismatch() {
  const { t } = useTranslation();
  const router = useRouter();
  const [waited, setWaited] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setWaited(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  if (!waited) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  return (
    <Screen>
      <EmptyState
        icon="compass-outline"
        title={t('errors.wrongSection')}
        message={t('errors.wrongSectionHelp')}
        actionLabel={t('errors.takeMeBack')}
        onAction={() => router.replace('/')}
      />
    </Screen>
  );
}

/**
 * Wraps a screen that requires a specific permission. Renders a clear
 * "no access" state instead of an empty page when the permission is missing.
 */
export function PermissionGuard({
  permission,
  children,
}: {
  permission: Permission | Permission[];
  children: React.ReactNode;
}) {
  const { can } = useAuth();
  const list = Array.isArray(permission) ? permission : [permission];
  const allowed = list.some((item) => can(item));

  if (!allowed) {
    return (
      <Screen>
        <NoAccessState />
      </Screen>
    );
  }

  return <>{children}</>;
}

/** Renders children only when the permission is held. Use for buttons. */
export function IfPermitted({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission | Permission[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { can } = useAuth();
  const list = Array.isArray(permission) ? permission : [permission];
  return <>{list.some((item) => can(item)) ? children : fallback}</>;
}
