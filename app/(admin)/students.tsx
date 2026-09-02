import React from 'react';
import { useTranslation } from 'react-i18next';

import { UserManager } from '@/features/users/UserManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminStudents() {
  const { t } = useTranslation();
  return (
    <PermissionGuard permission="VIEW_STUDENTS">
      <UserManager role="student" title={t('admin.manageStudents')} />
    </PermissionGuard>
  );
}
