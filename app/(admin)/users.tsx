import React from 'react';
import { useTranslation } from 'react-i18next';

import { UserManager } from '@/features/users/UserManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminUsers() {
  const { t } = useTranslation();
  return (
    <PermissionGuard permission="MANAGE_USERS">
      <UserManager title={t('admin.manageUsers')} />
    </PermissionGuard>
  );
}
