import { ChatScreen } from '@/features/chat/ChatScreen';
import { GuestGate } from '@/components/shared/GuestGate';

function ChatInner() {
  return <ChatScreen />;
}

/**
 * A guest has no account to chat from, so sees why and how to get one instead
 * of a conversation the database would refuse them.
 */
export default function Chat() {
  return (
    <GuestGate messageKey="guestMode.personal" titleKey="chat.title">
      <ChatInner />
    </GuestGate>
  );
}
