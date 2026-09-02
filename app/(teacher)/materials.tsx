import React from 'react';

import { MaterialManager } from '@/features/materials/MaterialManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import { useTeacherScope } from '@/hooks/useTeacherScope';

export default function TeacherMaterials() {
  const { classIds } = useTeacherScope();
  return (
    <PermissionGuard permission="UPLOAD_MATERIAL">
      <MaterialManager classScope={classIds} />
    </PermissionGuard>
  );
}
