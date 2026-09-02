import React from 'react';

import { ClassManager } from '@/features/org/ClassManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminClasses() {
  return (
    <PermissionGuard permission="VIEW_CLASSES">
      <ClassManager />
    </PermissionGuard>
  );
}
