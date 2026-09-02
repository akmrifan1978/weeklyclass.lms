import React from 'react';

import { CalendarManager } from '@/features/calendar/CalendarManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import { useTeacherScope } from '@/hooks/useTeacherScope';

export default function TeacherCalendar() {
  const { classIds } = useTeacherScope();
  return (
    <PermissionGuard permission="MANAGE_CALENDAR">
      <CalendarManager classScope={classIds} />
    </PermissionGuard>
  );
}
