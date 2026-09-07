import React from 'react';

import { VideoManager } from '@/features/videos/VideoManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import { useTeacherScope } from '@/hooks/useTeacherScope';

export default function TeacherRecordings() {
  const { classIds } = useTeacherScope();
  return (
    <PermissionGuard permission="UPLOAD_VIDEO">
      <VideoManager kind="recording" classScope={classIds} />
    </PermissionGuard>
  );
}
