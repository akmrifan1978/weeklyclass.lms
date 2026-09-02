import React from 'react';

import { ResultsManager } from '@/features/results/ResultsManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminResults() {
  return (
    <PermissionGuard permission="VIEW_RESULTS">
      <ResultsManager />
    </PermissionGuard>
  );
}
