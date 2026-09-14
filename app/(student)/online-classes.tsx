import { useAuth } from '@/contexts/AuthContext';
import { OnlineClassesScreen } from '@/features/classes/OnlineClassesScreen';
import { GuestGate } from '@/components/shared/GuestGate';

function OnlineClassesInner() {
  const { user } = useAuth();
  // Students only see sessions for the class they are in.
  return <OnlineClassesScreen classId={user?.classId ?? null} />;
}

/**
 * A guest sees why this needs an account, and a way to get one, instead of
 * a screen whose data the database would refuse them.
 */
export default function OnlineClasses() {
  return (
    <GuestGate messageKey="guestMode.onlineClasses" titleKey="nav.onlineClasses">
      <OnlineClassesInner />
    </GuestGate>
  );
}
