import React from 'react';

import { ResultsManager } from '@/features/results/ResultsManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';
import { useTeacherScope } from '@/hooks/useTeacherScope';

export default function TeacherResults() {
  const { classIds } = useTeacherScope();
  return (
    <PermissionGuard permission="VIEW_RESULTS">
      <ResultsManager classScope={classIds} />
    </PermissionGuard>
  );
}
