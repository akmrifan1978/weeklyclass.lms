import React from 'react';
import { Stack } from 'expo-router';

import { RoleGuard } from '@/components/shared/RoleGuard';

export default function TeacherLayout() {
  return (
    <RoleGuard role="teacher">
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="(tabs)" />
      </Stack>
    </RoleGuard>
  );
}
