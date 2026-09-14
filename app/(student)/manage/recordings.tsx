import React from 'react';

import { VideoManager } from '@/features/videos/VideoManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

/**
 * Recorded lessons, as opposed to the general video library next door.
 *
 * Same manager, different `kind`. This is where a recording made on the Record
 * screen is edited, retitled, given a class, published, or left as a draft —
 * without it, anything saved as a draft would be written and then unreachable.
 */
export default function AdminRecordings() {
  return (
    <PermissionGuard permission="UPLOAD_VIDEO">
      <VideoManager kind="recording" />
    </PermissionGuard>
  );
}
