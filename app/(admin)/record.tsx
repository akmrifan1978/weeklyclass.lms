import React from 'react';

import { RecorderScreen } from '@/features/recording/RecorderScreen';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminRecord() {
  return (
    <PermissionGuard permission="UPLOAD_VIDEO">
      <RecorderScreen basePath="/(admin)" />
    </PermissionGuard>
  );
}
