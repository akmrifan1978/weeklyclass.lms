import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

/**
 * Speaking a name aloud, using the device's own Arabic voice.
 *
 * WHY SPEECH SYNTHESIS AND NOT RECORDINGS. Ninety-nine recordings would have to
 * come from somewhere, and every free set of them online belongs to whoever
 * recorded it. Shipping someone's recitation without their permission is not a
 * thing to do, and paying for a set was not on the table. The device already
 * has a voice, it costs nothing, and it works with no connection.
 *
 * WHY IT REFUSES TO SPEAK WITHOUT AN ARABIC VOICE, which is the important part.
 * Handed Arabic text with an English voice, a browser will happily read it as
 * nonsense or spell it out letter by letter. These are the names of Allah; a
 * mispronunciation is worse than silence. So this looks for a genuine Arabic
 * voice, and where the device has none it reports why and the button is not
 * offered at all.
 *
 * Web only for now. React Native has no speech synthesis without an added
 * dependency, so on a native build the reason is `platform` and the screen
 * says so rather than showing a button that does nothing.
 */

export type SpeechUnavailable = 'platform' | 'unsupported' | 'noArabicVoice';

export function useArabicSpeech() {
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [reason, setReason] = useState<SpeechUnavailable | null>(null);
  const [speakingId, setSpeakingId] = useState<number | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      setReason('platform');
      return;
    }
    if (!('speechSynthesis' in window)) {
      setReason('unsupported');
      return;
    }

    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      // Nothing yet: browsers populate this asynchronously and the
      // `voiceschanged` event below is what tells us it is ready.
      if (voices.length === 0) return;

      const arabic = voices.find((v) => v.lang?.toLowerCase().startsWith('ar'));
      setVoice(arabic ?? null);
      setReason(arabic ? null : 'noArabicVoice');
    };

    pick();
    window.speechSynthesis.addEventListener('voiceschanged', pick);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', pick);
  }, []);

  const stop = useCallback(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    utteranceRef.current = null;
    setSpeakingId(null);
  }, []);

  const speak = useCallback(
    (id: number, text: string) => {
      if (!voice) return;

      // One at a time. Tapping a second name while the first is speaking should
      // replace it, not layer two voices over each other.
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      // Slower than speech, because this is being repeated after rather than
      // listened to.
      utterance.rate = 0.8;
      utterance.onend = () => setSpeakingId(null);
      utterance.onerror = () => setSpeakingId(null);

      utteranceRef.current = utterance;
      setSpeakingId(id);
      window.speechSynthesis.speak(utterance);
    },
    [voice]
  );

  return { available: voice !== null, reason, speak, stop, speakingId };
}
