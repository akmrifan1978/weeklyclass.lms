import React from 'react';

import { QuizManager } from '@/features/quiz/QuizManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminQuizzes() {
  return (
    <PermissionGuard permission={['CREATE_QUIZ', 'EDIT_QUIZ']}>
      <QuizManager />
    </PermissionGuard>
  );
}
