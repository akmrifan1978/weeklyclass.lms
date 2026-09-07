import React from 'react';

import { RecorderScreen } from '@/features/recording/RecorderScreen';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function TeacherRecord() {
  return (
    <PermissionGuard permission="UPLOAD_VIDEO">
      <RecorderScreen basePath="/(teacher)" />
    </PermissionGuard>
  );
}
