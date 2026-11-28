import React from 'react';

import { PromoCodeManager } from '@/features/events/PromoCodeManager';
import { CrashBoundary } from '@/components/shared/CrashBoundary';

/**
 * Admin only, with no PermissionGuard above it.
 *
 * The whole section is already behind `RoleGuard role="admin"`, and the
 * security rules let admins alone write a code — so a permission check here
 * would be a third gate guarding the same door, and one more thing to keep in
 * step with the other two.
 */
export default function AdminPromoCodes() {
  return (
    <CrashBoundary where="promo codes">
      <PromoCodeManager />
    </CrashBoundary>
  );
}
