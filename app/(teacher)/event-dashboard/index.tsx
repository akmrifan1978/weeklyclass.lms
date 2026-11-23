import React from 'react';

import { EventDashboard } from '@/features/events/EventDashboard';
import { PermissionGuard } from '@/components/shared/RoleGuard';

/**
 * The same dashboard, for the assistant.
 *
 * An assistant is a teacher account holding VIEW_EVENT_DASHBOARD and little
 * else, so the screen has to exist inside the teacher section too — the admin
 * section turns a non-admin away at the door whatever permissions they hold.
 */
export default function TeacherEventDashboard() {
  return (
    <PermissionGuard permission="VIEW_EVENT_DASHBOARD">
      <EventDashboard route="(teacher)" />
    </PermissionGuard>
  );
}
