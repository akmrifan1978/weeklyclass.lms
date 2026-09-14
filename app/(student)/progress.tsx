import { MyProgressScreen } from '@/features/progress/MyProgressScreen';
import { GuestGate } from '@/components/shared/GuestGate';

function ProgressInner() {
  return <MyProgressScreen />;
}

/**
 * A guest sees why this needs an account, and a way to get one, instead of
 * a screen whose data the database would refuse them.
 */
export default function Progress() {
  return (
    <GuestGate messageKey="guestMode.personal" titleKey="nav.myProgress">
      <ProgressInner />
    </GuestGate>
  );
}
