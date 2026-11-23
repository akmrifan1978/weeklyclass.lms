import React from 'react';

import { EventDashboard } from '@/features/events/EventDashboard';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminEventDashboard() {
  return (
    <PermissionGuard permission="VIEW_EVENT_DASHBOARD">
      <EventDashboard route="(admin)" />
    </PermissionGuard>
  );
}
