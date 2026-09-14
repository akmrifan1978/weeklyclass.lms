import { QaScreen } from '@/features/support/QaScreen';
import { GuestGate } from '@/components/shared/GuestGate';

function QaInner() {
  return <QaScreen />;
}

/**
 * A guest sees why this needs an account, and a way to get one, instead of
 * a screen whose data the database would refuse them.
 */
export default function Qa() {
  return (
    <GuestGate messageKey="guestMode.qa" titleKey="nav.qa">
      <QaInner />
    </GuestGate>
  );
}
