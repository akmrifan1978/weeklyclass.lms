import { useEffect, useState } from 'react';

import { watchSettings } from '@/services/settingsService';
import { setCalendarSystem } from '@/utils/date';
import type { CalendarSystem } from '@/types';

/**
 * Keeps the app's date formatting in step with the admin's calendar setting.
 *
 * Mounted exactly once, in the root layout. The formatters themselves are plain
 * synchronous functions called from a hundred screens, so the setting reaches
 * them through a module variable rather than through a hundred props — and
 * something has to be responsible for putting it there.
 *
 * The state is not otherwise used; it exists to re-render the tree when the
 * setting changes, because a module variable changing is invisible to React and
 * every date already on screen would otherwise keep its old calendar until
 * something unrelated happened to re-render it.
 */
export function useCalendarSystem(): CalendarSystem {
  const [system, setSystem] = useState<CalendarSystem>('gregorian');

  useEffect(
    () =>
      watchSettings((settings) => {
        const next = settings.calendarSystem ?? 'gregorian';
        setCalendarSystem(next);
        setSystem(next);
      }),
    []
  );

  return system;
}
