import React from 'react';

import { BranchManager } from '@/features/org/BranchManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminBranches() {
  return (
    <PermissionGuard permission="MANAGE_BRANCHES">
      <BranchManager />
    </PermissionGuard>
  );
}
