import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { watchSettings } from '@/services/settingsService';

/**
 * Ends a session that has been left unattended.
 *
 * The devices this runs on are shared — a family tablet, a phone handed round a
 * classroom — so a session left open is a real exposure rather than a
 * theoretical one. An admin sets the number of minutes; zero means never, which
 * is the default, because a timeout that interrupts a lesson is worse than no
 * timeout at all unless somebody asked for one.
 *
 * Two clocks, because there are two ways to walk away:
 *
 *   - Backgrounded. The app is not running, so no timer of ours fires. Instead
 *     the moment of leaving is recorded and the elapsed time is measured on the
 *     way back in. This is the case that matters most: the phone went in a
 *     pocket and came out an hour later in somebody else's hand.
 *   - Open but untouched. A poll compares the last interaction against the
 *     limit. Every touch anywhere in the app pushes that stamp forward, wired
 *     through a capture-phase responder in the provider so it observes gestures
 *     without ever stealing one.
 *
 * Deliberately not persisted across launches: a cold start has already lost the
 * Firebase session or restored it legitimately, and expiring on top of that
 * would only log people out for having closed the app.
 */
export function useSessionTimeout(options: {
  /** Whether anybody is signed in — no session, nothing to expire. */
  active: boolean;
  onTimeout: () => void;
}): { markActive: () => void } {
  const { active, onTimeout } = options;

  const lastActive = useRef(Date.now());
  const timeoutMs = useRef(0);
  // Held in a ref so the polling effect never has to be torn down and rebuilt
  // when the caller passes a new closure.
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  const markActive = () => {
    lastActive.current = Date.now();
  };

  // Live, so raising or clearing the limit takes effect in the open app rather
  // than at the next launch.
  useEffect(() => {
    return watchSettings((settings) => {
      const minutes = settings.sessionTimeoutMinutes ?? 0;
      timeoutMs.current = minutes > 0 ? minutes * 60_000 : 0;
    });
  }, []);

  useEffect(() => {
    if (!active) return;

    lastActive.current = Date.now();

    const expired = () => timeoutMs.current > 0 && Date.now() - lastActive.current > timeoutMs.current;

    const check = () => {
      if (expired()) onTimeoutRef.current();
    };

    // Half a minute. Fine enough that the session does not linger noticeably
    // past its limit, coarse enough to be invisible on a battery.
    const poll = setInterval(check, 30_000);

    const onAppStateChange = (next: AppStateStatus) => {
      if (next === 'active') check();
      else markActive();
    };

    const subscription = AppState.addEventListener('change', onAppStateChange);

    return () => {
      clearInterval(poll);
      subscription.remove();
    };
  }, [active]);

  return { markActive };
}
