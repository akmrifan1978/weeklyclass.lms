import React from 'react';

import { EventDashboard } from '@/features/events/EventDashboard';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import { CrashBoundary } from '@/components/shared/CrashBoundary';

export default function AdminEventDashboard() {
  return (
    <PermissionGuard permission="VIEW_EVENT_DASHBOARD">
      {/* Named, so a crash here says which screen failed rather than leaving
          a blank page nobody can report usefully. */}
      <CrashBoundary where="events dashboard (admin)">
        <EventDashboard route="(admin)" />
      </CrashBoundary>
    </PermissionGuard>
  );
}
