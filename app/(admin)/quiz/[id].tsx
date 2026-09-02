import React from 'react';

import { QuizEditor } from '@/features/quiz/QuizEditor';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminQuizEditor() {
  return (
    <PermissionGuard permission={['CREATE_QUIZ', 'EDIT_QUIZ']}>
      <QuizEditor />
    </PermissionGuard>
  );
}
