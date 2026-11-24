import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { EventAccounts } from '@/features/events/EventAccounts';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import { CrashBoundary } from '@/components/shared/CrashBoundary';

export default function AdminEventAccounts() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <PermissionGuard permission="VIEW_EVENT_DASHBOARD">
      <CrashBoundary where="event accounts (admin)">
        <EventAccounts eventId={String(id ?? '')} />
      </CrashBoundary>
    </PermissionGuard>
  );
}
