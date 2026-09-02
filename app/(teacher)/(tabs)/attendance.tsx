import React from 'react';

import { AttendanceManager } from '@/features/attendance/AttendanceManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import { useTeacherScope } from '@/hooks/useTeacherScope';

export default function TeacherAttendance() {
  const { classIds } = useTeacherScope();
  return (
    <PermissionGuard permission="VIEW_ATTENDANCE">
      <AttendanceManager classScope={classIds} />
    </PermissionGuard>
  );
}
