import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Whether the device currently has a usable connection.
 *
 * Two sources, because neither is available everywhere: the browser's `online`
 * events on web, and expo-network's listener on native. Both are best-effort —
 * "connected to wifi" is not the same as "the internet works", and a captive
 * portal reports online while serving nothing.
 *
 * So this drives a banner, never a decision. Nothing is blocked on it. The
 * request is always attempted, and the offline cache answers if it fails; being
 * wrong about connectivity then costs nothing, whereas refusing to try because
 * a flag said offline would strand someone whose connection had just returned.
 */
export function useNetworkStatus(): { online: boolean } {
  // Optimistic until told otherwise: an app that flashes "offline" on every
  // cold start, before anything has been checked, teaches people to ignore it.
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      const update = () => !cancelled && setOnline(window.navigator.onLine);
      update();
      window.addEventListener('online', update);
      window.addEventListener('offline', update);
      return () => {
        cancelled = true;
        window.removeEventListener('online', update);
        window.removeEventListener('offline', update);
      };
    }

    let unsubscribe: (() => void) | undefined;
    void import('expo-network')
      .then((Network) => {
        if (cancelled) return;
        void Network.getNetworkStateAsync()
          .then((state) => {
            if (!cancelled) setOnline(state.isInternetReachable ?? state.isConnected ?? true);
          })
          .catch(() => undefined);

        const subscription = Network.addNetworkStateListener((state) => {
          if (!cancelled) setOnline(state.isInternetReachable ?? state.isConnected ?? true);
        });
        unsubscribe = () => subscription.remove();
      })
      .catch(() => {
        // Without the module the banner simply never shows, which is the safe
        // way to be wrong.
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return { online };
}
