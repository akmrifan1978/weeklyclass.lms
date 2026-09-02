import React from 'react';
import { View } from 'react-native';

import { useAuth } from '@/contexts/AuthContext';
import { colors } from '@/constants/theme';
import { LoadingState, NoAccessState, Screen } from '@/components/ui';
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

  // The redirect itself lives in app/_layout.tsx; rendering nothing here stops
  // a flash of the wrong dashboard while that redirect runs.
  if (!user || user.role !== role) return null;

  return <>{children}</>;
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
