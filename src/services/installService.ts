import { Platform } from 'react-native';

/**
 * Installing the web app, and what this device can do about it.
 *
 * WHY THIS IS A MODULE AND NOT A COMPONENT. Chrome and Edge offer a one-tap
 * install by firing `beforeinstallprompt` ONCE, early, and never again for that
 * page. A listener added when some screen happens to mount can miss it — and
 * then the install button quietly never works. So the listener is attached the
 * moment this file is imported, which the root layout does before anything
 * draws, and every button and banner reads the captured event from here.
 *
 * Safari on iPhone and iPad never fires that event at all. There, installing is
 * a manual Share-menu step, so the most useful thing to know is whether this is
 * Safari, or a browser that cannot install, such as WhatsApp's.
 */

export type InstallDevice = 'android' | 'ios' | 'desktop';

type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export interface InstallState {
  /** Only a web page can be installed; the native app already is one. */
  web: boolean;
  /** Already open as an installed app, so there is nothing to offer. */
  installed: boolean;
  device: InstallDevice;
  /** On iPhone or iPad but not in Safari, where Add to Home Screen lives. */
  iosNeedsSafari: boolean;
  /** Inside another app's browser — WhatsApp, Facebook, Instagram. */
  inAppBrowser: boolean;
  /** Present when the browser will install in one tap. */
  oneTap: boolean;
}

let deferred: InstallEvent | null = null;
let installedNow = false;
const listeners = new Set<(state: InstallState) => void>();

function agent(): string {
  return typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
}

function detectDevice(): InstallDevice {
  const ua = agent();
  // iPadOS reports itself as a Mac. A Mac with a touch screen is an iPad.
  const touchMac =
    /Macintosh/.test(ua) &&
    typeof navigator !== 'undefined' &&
    (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1;
  if (/iPhone|iPad|iPod/i.test(ua) || touchMac) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
    if (window.matchMedia?.('(display-mode: minimal-ui)').matches) return true;
  } catch {
    // An old browser without matchMedia simply is not installed.
  }
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function getInstallState(): InstallState {
  const web = Platform.OS === 'web' && typeof window !== 'undefined';
  const ua = agent();
  const device = detectDevice();
  return {
    web,
    installed: web ? installedNow || isStandalone() : true,
    device,
    iosNeedsSafari:
      device === 'ios' && /CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\//i.test(ua),
    inAppBrowser: /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)/i.test(ua),
    oneTap: Boolean(deferred),
  };
}

function emit() {
  const state = getInstallState();
  listeners.forEach((listener) => listener(state));
}

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Held rather than shown: the app decides when to offer it, and one offer
    // is clearer than the browser's own bar plus ours saying it differently.
    event.preventDefault();
    deferred = event as InstallEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installedNow = true;
    emit();
  });
  try {
    window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', emit);
  } catch {
    // Not every browser can report the change; a reload still gets it right.
  }
}

/** Current state now, and again every time it changes. */
export function subscribeInstall(listener: (state: InstallState) => void): () => void {
  listeners.add(listener);
  listener(getInstallState());
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Shows the browser's own install dialog, where it offers one.
 *
 * The browser allows each captured event to be used once, so it is cleared
 * before the dialog opens rather than after.
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const pending = deferred;
  if (!pending) return 'unavailable';
  deferred = null;
  emit();
  try {
    await pending.prompt();
    const choice = await pending.userChoice;
    if (choice.outcome === 'accepted') {
      installedNow = true;
      emit();
    }
    return choice.outcome;
  } catch {
    return 'unavailable';
  }
}

/** The page to send somebody who wants to install the app. */
export function installLink(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/install`;
  }
  return 'https://weeklyclass-lms.web.app/install';
}
