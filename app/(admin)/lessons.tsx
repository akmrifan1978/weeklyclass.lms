import React from 'react';

import { LessonManager } from '@/features/lessons/LessonManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminLessons() {
  return (
    <PermissionGuard permission="VIEW_LESSONS">
      <LessonManager />
    </PermissionGuard>
  );
}
