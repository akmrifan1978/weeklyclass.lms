import { useCallback } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { useAsync } from '@/hooks/useAsync';
import { classesForTeacher } from '@/services/orgService';
import type { ClassRoom } from '@/types';

/**
 * The classes a teacher may act on.
 *
 * Everything in the teacher area is scoped through this so the UI offers only
 * what the security rules will actually allow. `classesForTeacher` reads
 * `classes` where `teacherIds` contains the uid — the same condition the rules
 * check on writes.
 */
export function useTeacherScope(): {
  classes: ClassRoom[];
  classIds: string[];
  loading: boolean;
  error: unknown;
  reload: () => Promise<void>;
} {
  const { user } = useAuth();

  const load = useCallback(async () => {
    if (!user || user.role !== 'teacher') return [] as ClassRoom[];
    return classesForTeacher(user.uid);
  }, [user?.uid, user?.role]);

  const { data, loading, error, reload } = useAsync(load, [user?.uid]);

  const classes = data ?? [];
  return {
    classes,
    classIds: classes.map((item) => item.id),
    loading,
    error,
    reload,
  };
}
