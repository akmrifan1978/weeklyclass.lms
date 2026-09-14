import React from 'react';

import { AnnouncementManager } from '@/features/announcements/AnnouncementManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminAnnouncements() {
  return (
    <PermissionGuard permission="MANAGE_ANNOUNCEMENTS">
      <AnnouncementManager />
    </PermissionGuard>
  );
}
