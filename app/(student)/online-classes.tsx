import { useAuth } from '@/contexts/AuthContext';
import { OnlineClassesScreen } from '@/features/classes/OnlineClassesScreen';

export default function OnlineClasses() {
  const { user } = useAuth();
  // Students only see sessions for the class they are in.
  return <OnlineClassesScreen classId={user?.classId ?? null} />;
}
