import { SupportScreen } from '@/features/support/SupportScreen';
import { GuestGate } from '@/components/shared/GuestGate';

function SupportInner() {
  return <SupportScreen />;
}

/**
 * A guest sees why this needs an account, and a way to get one, instead of
 * a screen whose data the database would refuse them.
 */
export default function Support() {
  return (
    <GuestGate messageKey="guestMode.personal" titleKey="nav.support">
      <SupportInner />
    </GuestGate>
  );
}
