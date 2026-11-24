import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { EventAccounts } from '@/features/events/EventAccounts';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import { CrashBoundary } from '@/components/shared/CrashBoundary';

export default function TeacherEventAccounts() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <PermissionGuard permission="VIEW_EVENT_DASHBOARD">
      <CrashBoundary where="event accounts (assistant)">
        <EventAccounts eventId={String(id ?? '')} />
      </CrashBoundary>
    </PermissionGuard>
  );
}
