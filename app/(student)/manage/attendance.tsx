import React from 'react';

import { AttendanceManager } from '@/features/attendance/AttendanceManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminAttendance() {
  return (
    <PermissionGuard permission="VIEW_ATTENDANCE">
      <AttendanceManager />
    </PermissionGuard>
  );
}
