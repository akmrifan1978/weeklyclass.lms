import React from 'react';

import { ProfileScreen } from '@/components/shared/ProfileScreen';
import { GuestGate } from '@/components/shared/GuestGate';

function StudentProfileInner() {
  return <ProfileScreen />;
}

/**
 * A guest sees why this needs an account, and a way to get one, instead of
 * a screen whose data the database would refuse them.
 */
export default function StudentProfile() {
  return (
    <GuestGate messageKey="guestMode.profile" titleKey="guestMode.title" backButton={false}>
      <StudentProfileInner />
    </GuestGate>
  );
}
