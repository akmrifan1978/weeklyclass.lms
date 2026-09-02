import React from 'react';

import { QuizManager } from '@/features/quiz/QuizManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import { useTeacherScope } from '@/hooks/useTeacherScope';

export default function TeacherQuizzes() {
  const { classIds } = useTeacherScope();
  return (
    <PermissionGuard permission={['CREATE_QUIZ', 'EDIT_QUIZ']}>
      <QuizManager classScope={classIds} />
    </PermissionGuard>
  );
}
