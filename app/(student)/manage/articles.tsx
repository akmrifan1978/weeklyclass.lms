import React from 'react';

import { ArticleManager } from '@/features/articles/ArticleManager';
import { PermissionGuard } from '@/components/shared/RoleGuard';

export default function AdminArticles() {
  return (
    <PermissionGuard permission="MANAGE_ARTICLES">
      <ArticleManager />
    </PermissionGuard>
  );
}
