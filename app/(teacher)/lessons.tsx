import React from 'react';

import { LessonManager } from '@/features/lessons/LessonManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import { useTeacherScope } from '@/hooks/useTeacherScope';

export default function TeacherLessons() {
  const { classIds } = useTeacherScope();
  return (
    <PermissionGuard permission="VIEW_LESSONS">
      <LessonManager classScope={classIds} />
    </PermissionGuard>
  );
}
