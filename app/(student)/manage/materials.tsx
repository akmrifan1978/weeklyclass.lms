import React from 'react';

import { MaterialManager } from '@/features/materials/MaterialManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminMaterials() {
  return (
    <PermissionGuard permission="UPLOAD_MATERIAL">
      <MaterialManager />
    </PermissionGuard>
  );
}
