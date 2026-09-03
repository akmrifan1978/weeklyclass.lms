import { useLocalSearchParams } from 'expo-router';

import { SurahScreen } from '@/features/islamic/SurahScreen';

export default function Surah() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <SurahScreen number={Number(id) || 1} />;
}
