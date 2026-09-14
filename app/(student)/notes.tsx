import { NotesScreen } from '@/features/notes/NotesScreen';
import { GuestGate } from '@/components/shared/GuestGate';

function NotesInner() {
  return <NotesScreen />;
}

/**
 * A guest sees why this needs an account, and a way to get one, instead of
 * a screen whose data the database would refuse them.
 */
export default function Notes() {
  return (
    <GuestGate messageKey="guestMode.personal" titleKey="nav.notes">
      <NotesInner />
    </GuestGate>
  );
}
