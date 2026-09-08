import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Plays a run of ayahs one after another.
 *
 * Continuous recitation is the difference between a page you can read and a
 * page you can follow, and it is why the reciter is named at the top of the
 * mushaf: you are listening to one person's reading, not to "the audio".
 *
 * `expo-audio` is imported lazily, as it is in AyahAudio — a screen that never
 * presses play should not pay for the module, and on web the import resolves
 * differently, which is easier to contain here than to unpick from a static
 * import graph.
 *
 * A fresh player per ayah rather than one player re-pointed at each file. Both
 * backends are steadier that way than they are with a source swapped mid-flight,
 * and setup for a few seconds of audio costs nothing worth saving.
 */

export interface RecitationTrack {
  /** Identifies the verse being recited, so the reader can follow along. */
  key: string;
  url: string;
}

interface Handle {
  stop: () => void;
}

export function useRecitation() {
  const [current, setCurrent] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const handle = useRef<Handle | null>(null);
  const queue = useRef<RecitationTrack[]>([]);
  // Guards every callback that can arrive after the screen has gone: a finished
  // ayah must not start the next one into an unmounted component.
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      handle.current?.stop();
      handle.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    handle.current?.stop();
    handle.current = null;
    queue.current = [];
    setCurrent(null);
  }, []);

  // Held in a ref because each ayah's "finished" callback has to reach the step
  // that follows it, and that step is defined in terms of itself.
  const step = useRef<() => void>(() => {});

  const open = useCallback(async (url: string) => {
    try {
      if (Platform.OS === 'web') {
        const audio = new (globalThis as unknown as {
          Audio: new (src: string) => HTMLAudioElement;
        }).Audio(url);
        const onEnded = () => {
          if (alive.current) step.current();
        };
        const onError = () => {
          if (!alive.current) return;
          setFailed(true);
          stop();
        };
        audio.addEventListener('ended', onEnded);
        audio.addEventListener('error', onError);
        handle.current = {
          stop: () => {
            audio.removeEventListener('ended', onEnded);
            audio.removeEventListener('error', onError);
            audio.pause();
            audio.src = '';
          },
        };
        await audio.play();
        return;
      }

      const { createAudioPlayer } = await import('expo-audio');
      const player = createAudioPlayer({ uri: url });
      const subscription = player.addListener(
        'playbackStatusUpdate',
        (status: { didJustFinish?: boolean }) => {
          if (status.didJustFinish && alive.current) step.current();
        }
      );
      handle.current = {
        stop: () => {
          subscription?.remove?.();
          player.pause();
          player.remove();
        },
      };
      player.play();
    } catch {
      if (!alive.current) return;
      setFailed(true);
      stop();
    }
  }, [stop]);

  step.current = () => {
    // The ayah that just ended is released before the next is opened, so a long
    // surah does not accumulate one dead player per verse.
    handle.current?.stop();
    handle.current = null;

    const next = queue.current.shift();
    if (!next) {
      setCurrent(null);
      return;
    }
    setCurrent(next.key);
    void open(next.url);
  };

  /** Starts at the first track and continues to the end of the list. */
  const play = useCallback((tracks: RecitationTrack[]) => {
    setFailed(false);
    queue.current = [...tracks];
    step.current();
  }, []);

  return { current, playing: current !== null, failed, play, stop };
}
