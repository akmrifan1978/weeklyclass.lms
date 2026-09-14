import React from 'react';

import { NotificationList } from '@/components/shared/NotificationList';
import { GuestGate } from '@/components/shared/GuestGate';

function StudentNotificationsInner() {
  return <NotificationList />;
}

/**
 * A guest sees why this needs an account, and a way to get one, instead of
 * a screen whose data the database would refuse them.
 */
export default function StudentNotifications() {
  return (
    <GuestGate messageKey="guestMode.personal" titleKey="guestMode.title" backButton={false}>
      <StudentNotificationsInner />
    </GuestGate>
  );
}
