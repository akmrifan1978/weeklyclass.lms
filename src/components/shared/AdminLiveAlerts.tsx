import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { collection, limit, onSnapshot, query, where } from 'firebase/firestore';

import { db } from '@/firebase/config';
import { COLLECTIONS } from '@/constants/app';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { watchAdminUnread } from '@/services/chatService';

/**
 * The instant half of "tell the admin": while the admin panel is open, a new
 * registration waiting for approval, or a new chat message, is announced the
 * moment it arrives.
 *
 * The other half — email, the admins' phones, WhatsApp where it is switched
 * on — is sent by the delivery job, which needs nobody's laptop to be on. See
 * scripts/lib/registration-alerts.js.
 *
 * WHAT IS ANNOUNCED IS ONLY WHAT IS NEW. The first answer from the database is
 * what was already waiting when the panel opened; that is on the dashboard
 * already and is taken as the starting point, not announced. A copy read from
 * the device's cache is never the starting point either, because the server's
 * answer that follows would make every registration in it look new.
 *
 * Draws nothing.
 */
export function AdminLiveAlerts() {
  const { user } = useAuth();
  const toast = useToast();
  const { t } = useTranslation();
  const pathname = usePathname();

  const isAdmin = user?.role === 'admin';

  // Held in refs so a new toast or translation function does not tear down and
  // re-open the listeners, which would re-read and re-announce.
  const say = useRef({ toast, t, pathname });
  say.current = { toast, t, pathname };

  useEffect(() => {
    if (!isAdmin) return;
    let known: Set<string> | null = null;

    return onSnapshot(
      query(collection(db, COLLECTIONS.users), where('status', '==', 'pending'), limit(25)),
      { includeMetadataChanges: false },
      (snap) => {
        const live = snap.docs.filter((d) => d.data().deleted !== true);
        if (known && !snap.metadata.fromCache) {
          for (const row of live) {
            if (known.has(row.id)) continue;
            const text = say.current.t('alerts.newRegistration', {
              name: String(row.data().fullName ?? ''),
            });
            say.current.toast.show(text);
            deviceAlert(say.current.t('alerts.newRegistrationTitle'), text, `registration:${row.id}`);
          }
        }
        if (!snap.metadata.fromCache || !known) {
          known = new Set(live.map((d) => d.id));
        }
      },
      () => undefined
    );
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin) return;
    let previous: number | null = null;

    return watchAdminUnread((total, latest) => {
      const reading = say.current.pathname.includes('/chat');
      if (previous !== null && total > previous && !reading) {
        const text = say.current.t('chat.newMessage', { name: latest?.userName ?? '' });
        say.current.toast.show(text);
        deviceAlert(say.current.t('chat.title'), text, `chat:${latest?.uid ?? ''}`);
      }
      previous = total;
    });
  }, [isAdmin]);

  return null;
}

/**
 * A notification on the device too, but only when the panel is open in a tab
 * the admin is not looking at — the toast covers the tab they are looking at.
 * Uses the service worker where there is one, because Android Chrome refuses
 * notifications raised straight from a page.
 */
function deviceAlert(title: string, body: string, tag: string) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.visibilityState !== 'hidden') return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

  const direct = () => {
    try {
      new Notification(title, { body, tag });
    } catch {
      // A browser that allows neither simply shows the toast when they return.
    }
  };

  if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
    navigator.serviceWorker.ready
      .then((registration) => registration.showNotification(title, { body, tag }))
      .catch(direct);
  } else {
    direct();
  }
}
