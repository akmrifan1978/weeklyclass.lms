import React from 'react';
import { Stack } from 'expo-router';

import { RoleGuard } from '@/components/shared/RoleGuard';
import { AdminShell } from '@/components/shared/AdminShell';

export default function AdminLayout() {
  return (
    <RoleGuard role="admin">
      <AdminShell>
        <Stack screenOptions={{ headerShown: false, animation: 'fade' }} />
      </AdminShell>
    </RoleGuard>
  );
}
