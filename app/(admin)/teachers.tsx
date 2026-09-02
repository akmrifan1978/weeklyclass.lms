import React from 'react';
import { useTranslation } from 'react-i18next';

import { UserManager } from '@/features/users/UserManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminTeachers() {
  const { t } = useTranslation();
  return (
    <PermissionGuard permission="VIEW_TEACHERS">
      <UserManager role="teacher" title={t('admin.manageTeachers')} />
    </PermissionGuard>
  );
}
