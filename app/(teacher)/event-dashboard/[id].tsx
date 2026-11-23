import React from 'react';
import { useLocalSearchParams } from 'expo-router';

import { EventAccounts } from '@/features/events/EventAccounts';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function TeacherEventAccounts() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return (
    <PermissionGuard permission="VIEW_EVENT_DASHBOARD">
      <EventAccounts eventId={String(id ?? '')} />
    </PermissionGuard>
  );
}
