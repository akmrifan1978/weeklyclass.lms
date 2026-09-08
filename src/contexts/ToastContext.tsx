import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Animated, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fontSize, fontWeight, radius, shadow, spacing } from '@/constants/theme';

type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastContextValue {
  show: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

const KIND_STYLE: Record<ToastKind, { background: string; text: string }> = {
  success: { background: colors.success, text: colors.textInverse },
  error: { background: colors.danger, text: colors.textInverse },
  info: { background: colors.primary, text: colors.textInverse },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const show = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ id: Date.now(), message, kind });

      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: Platform.OS !== 'web',
      }).start();

      timer.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: Platform.OS !== 'web',
        }).start(() => setToast(null));
      }, 3200);
    },
    [opacity]
  );

  /** Clears the message early. Android routes its back gesture here. */
  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    opacity.setValue(0);
    setToast(null);
  }, [opacity]);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (message: string) => show(message, 'success'),
      error: (message: string) => show(message, 'error'),
    }),
    [show]
  );

  const bubble = toast ? (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
      style={[
        styles.container,
        { opacity, top: insets.top + spacing.md },
        { backgroundColor: KIND_STYLE[toast.kind].background },
      ]}
    >
      <Text style={[styles.text, { color: KIND_STYLE[toast.kind].text }]}>{toast.message}</Text>
    </Animated.View>
  ) : null;

  return (
    <ToastContext.Provider value={value}>
      {children}

      {/*
        GETTING THE MESSAGE ON TOP, WITHOUT BLOCKING WHAT IS UNDERNEATH.

        The toast used to render as an ordinary absolutely-positioned sibling
        of the app, which meant it was invisible exactly when it mattered.
        Almost every action that reports something — saving a lesson, replying
        to a message — happens inside a FormSheet or a ConfirmDialog, and those
        are Modals. Measured on the deployed site with a sheet open: the toast
        as it was styled was covered, and still covered at z-index 9999.

        The two platforms need different answers, and trying to use one cost a
        measurement to find out:

        WEB — a very high stacking order, in the ordinary tree. Verified above
        a sheet's Modal layer. It must NOT be a Modal here: react-native-web
        gives a Modal's wrapper `pointer-events: auto`, which cannot be turned
        off from inside, so a Modal toast swallowed every click on the whole
        screen for the three seconds it was up. Fields could still be focused
        programmatically, which is exactly the kind of half-working that hides
        a bug like this.

        NATIVE — a Modal, because no z-index reaches past one. It is mounted
        only while there is something to say, rather than kept mounted with
        `visible` toggling: a Modal creates its layer when the COMPONENT
        mounts, and this provider wraps the app, so a permanently-mounted one
        is always the older layer and every later sheet paints over it.
      */}
      {Platform.OS === 'web' ? (
        bubble
      ) : toast ? (
        <Modal visible transparent animationType="none" onRequestClose={dismiss}>
          <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
            {bubble}
          </View>
        </Modal>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}

const styles = StyleSheet.create({
  container: {
    /**
     * At the top, not the bottom, and that is a consequence of the fix above.
     *
     * Once the message could actually be seen over a sheet, it turned out to
     * land exactly on the sheet's Cancel and Save buttons and swallow them for
     * the three seconds it was up — measured: the Cancel button was
     * unreachable while a toast showed. The bottom of the screen is where
     * every action bar lives, and where the keyboard arrives on a phone. The
     * top is clear of both.
     */
    position: 'absolute',
    // High enough to clear react-native-web's modal layer, which sits well
    // above anything in the ordinary tree. Ignored on native, where the Modal
    // above does the same job.
    zIndex: 2147483647,
    left: spacing.lg,
    right: spacing.lg,
    maxWidth: 520,
    alignSelf: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    ...shadow.lg,
  },
  text: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
  },
});
