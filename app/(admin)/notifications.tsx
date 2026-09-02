import React from 'react';

import { NotificationComposer } from '@/features/notifications/NotificationComposer';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminNotifications() {
  return (
    <PermissionGuard permission="SEND_NOTIFICATIONS">
      <NotificationComposer />
    </PermissionGuard>
  );
}
