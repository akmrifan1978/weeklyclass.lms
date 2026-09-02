import React from 'react';

import { PermissionsManager } from '@/features/permissions/PermissionsManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminPermissions() {
  return (
    <PermissionGuard permission="MANAGE_USERS">
      <PermissionsManager />
    </PermissionGuard>
  );
}
