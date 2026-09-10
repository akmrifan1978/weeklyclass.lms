import React from 'react';

import { FlyerManager } from '@/features/flyers/FlyerManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminFlyers() {
  return (
    <PermissionGuard permission="MANAGE_ANNOUNCEMENTS">
      <FlyerManager />
    </PermissionGuard>
  );
}
