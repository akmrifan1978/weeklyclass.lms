import React from 'react';

import { VideoManager } from '@/features/videos/VideoManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminVideos() {
  return (
    <PermissionGuard permission="UPLOAD_VIDEO">
      <VideoManager kind="video" />
    </PermissionGuard>
  );
}
