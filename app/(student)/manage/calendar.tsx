import React from 'react';

import { CalendarManager } from '@/features/calendar/CalendarManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminCalendar() {
  return (
    <PermissionGuard permission="MANAGE_CALENDAR">
      <CalendarManager />
    </PermissionGuard>
  );
}
