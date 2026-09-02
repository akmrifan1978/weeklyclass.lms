import React from 'react';

import { VideoManager } from '@/features/videos/VideoManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import { useTeacherScope } from '@/hooks/useTeacherScope';

export default function TeacherVideos() {
  const { classIds } = useTeacherScope();
  return (
    <PermissionGuard permission="UPLOAD_VIDEO">
      <VideoManager kind="video" classScope={classIds} />
    </PermissionGuard>
  );
}
