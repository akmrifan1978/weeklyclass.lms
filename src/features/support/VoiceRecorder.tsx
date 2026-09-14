import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/contexts/ToastContext';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import * as storageService from '@/services/storageService';

/**
 * Records a short voice message and uploads it.
 *
 * Speaking a question is often the only practical way to ask one here: typing
 * Tamil or Arabic on a phone keyboard is slow, and a student who reads more
 * easily than they write should not be shut out of asking.
 *
 * The recording is capped and the cap is visible, but the cap is now generous
 * rather than tight. Two minutes was cutting people off mid-explanation — a
 * teacher answering properly needs longer than a student asking — and being
 * cut off is a worse failure than a large file.
 *
 * It is not removed altogether. The only thing standing between a recorder
 * left running by accident and a file that cannot be uploaded at all on a
 * weak connection is this number, so it stays; it is simply set where nobody
 * speaking normally will ever meet it.
 */

const MAX_SECONDS = 600;

type RecorderState = 'idle' | 'recording' | 'uploading';

export function VoiceRecorder({
  onRecorded,
  ownerId,
}: {
  /** Called with the uploaded audio URL and how long it runs. */
  onRecorded: (url: string, seconds: number) => void;
  ownerId: string;
}) {
  const { t } = useTranslation();
  const toast = useToast();

  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<{ stop: () => Promise<string | null> } | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | null>(null);

  // A recorder left running when the screen closes keeps the microphone open,
  // which is both a battery problem and a privacy one.
  useEffect(() => {
    return () => {
      if (ticker.current) clearInterval(ticker.current);
      void recorder.current?.stop().catch(() => undefined);
    };
  }, []);

  const startTicker = () => {
    setSeconds(0);
    ticker.current = setInterval(() => {
      setSeconds((n) => {
        if (n + 1 >= MAX_SECONDS) {
          // Stops itself at the cap rather than silently recording past it.
          void stop();
          return MAX_SECONDS;
        }
        return n + 1;
      });
    }, 1000);
  };

  const start = async () => {
    try {
      if (Platform.OS === 'web') {
        const media = await navigator.mediaDevices.getUserMedia({ audio: true });
        const chunks: BlobPart[] = [];
        const mediaRecorder = new MediaRecorder(media);
        mediaRecorder.ondataavailable = (event) => chunks.push(event.data);
        mediaRecorder.start();

        recorder.current = {
          stop: () =>
            new Promise((resolve) => {
              mediaRecorder.onstop = () => {
                media.getTracks().forEach((track) => track.stop());
                resolve(URL.createObjectURL(new Blob(chunks, { type: 'audio/webm' })));
              };
              mediaRecorder.stop();
            }),
        };
      } else {
        const audio = await import('expo-audio');
        const permission = await audio.requestRecordingPermissionsAsync();
        if (!permission.granted) {
          toast.error(t('qa.microphoneDenied'));
          return;
        }
        const instance = new audio.AudioRecorder(audio.RecordingPresets.HIGH_QUALITY);
        await instance.prepareToRecordAsync();
        instance.record();
        recorder.current = {
          stop: async () => {
            await instance.stop();
            return instance.uri ?? null;
          },
        };
      }

      setState('recording');
      startTicker();
    } catch (error) {
      toast.error(friendlyMessage(error, t));
      setState('idle');
    }
  };

  const stop = async () => {
    if (ticker.current) {
      clearInterval(ticker.current);
      ticker.current = null;
    }
    const uri = await recorder.current?.stop().catch(() => null);
    recorder.current = null;

    if (!uri) {
      setState('idle');
      return;
    }

    setState('uploading');
    try {
      const uploaded = await storageService.upload({
        uri,
        fileName: `question-${Date.now()}.${Platform.OS === 'web' ? 'webm' : 'm4a'}`,
        kind: 'material',
        ownerId,
        contentType: Platform.OS === 'web' ? 'audio/webm' : 'audio/m4a',
      });
      onRecorded(uploaded.url, seconds);
      toast.success(t('qa.voiceReady'));
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setState('idle');
      setSeconds(0);
    }
  };

  const label =
    state === 'recording'
      ? t('qa.stopRecording')
      : state === 'uploading'
        ? t('qa.uploadingVoice')
        : t('qa.recordVoice');

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={state === 'recording' ? stop : state === 'idle' ? start : undefined}
        disabled={state === 'uploading'}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: state === 'uploading' }}
        style={({ pressed }) => [
          styles.button,
          state === 'recording' ? styles.recording : null,
          pressed ? styles.pressed : null,
        ]}
      >
        <Ionicons
          name={state === 'recording' ? 'stop' : 'mic'}
          size={17}
          color={state === 'recording' ? colors.textInverse : colors.primary}
        />
        <Text style={[styles.label, state === 'recording' ? styles.labelActive : null]}>
          {label}
        </Text>
      </Pressable>

      {state === 'recording' ? (
        <Text style={styles.timer} accessibilityLiveRegion="polite">
          {format(seconds)} / {format(MAX_SECONDS)}
        </Text>
      ) : null}
    </View>
  );
}

function format(total: number): string {
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  recording: { backgroundColor: brand.red, borderColor: brand.red },
  pressed: { opacity: 0.7 },
  label: { fontSize: fontSize.sm, color: colors.primary, fontWeight: fontWeight.medium },
  labelActive: { color: colors.textInverse },
  timer: { fontSize: fontSize.xs, color: colors.textMuted, fontVariant: ['tabular-nums'] },
});
