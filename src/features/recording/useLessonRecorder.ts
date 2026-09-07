import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { UPLOAD_LIMITS } from '@/constants/app';
import { drawOverlay, type OverlayBranding } from './overlay';

/**
 * Recording a lesson in the browser.
 *
 * The camera is never recorded directly. Each frame is drawn onto a canvas, the
 * branding is painted over it, and the canvas is what MediaRecorder captures —
 * which is what puts the logo inside the file rather than beside it, and has a
 * second benefit that is almost worth it on its own: because the canvas is the
 * source, the camera underneath can be swapped mid-sentence without the
 * recording noticing.
 *
 * Microphone and camera are acquired as two separate streams for the same
 * reason. Switching from the rear camera to the front replaces the video stream
 * and must not interrupt the audio being recorded from the one before it.
 *
 * Web only. `MediaRecorder` and `canvas.captureStream` are browser APIs with no
 * React Native equivalent, so on a native build the screen offers the device's
 * own camera app instead — see RecorderScreen.
 */

export type RecorderPhase = 'starting' | 'ready' | 'recording' | 'paused' | 'recorded' | 'blocked';

/**
 * Why the camera is unavailable. Each of these needs a different sentence from
 * the person reading it — "allow it in your browser" is useless advice to
 * somebody whose laptop has no camera — so they are kept apart rather than
 * collapsed into one failure.
 */
export type RecorderProblem =
  | 'denied'
  | 'notFound'
  | 'inUse'
  | 'insecure'
  | 'unsupported'
  | 'failed';

export type RecorderQuality = 'sharp' | 'standard' | 'long';

/**
 * What each quality setting costs per minute.
 *
 * These exist because the upload ceiling is fixed and low, so the real choice
 * being made is not "how good should this look" but "how long am I allowed to
 * record" — and those are the same dial. The screen shows the minutes, not the
 * bitrates, because the minutes are what somebody is actually deciding about.
 */
export const QUALITY_PRESETS: Record<
  RecorderQuality,
  { height: number; videoBitsPerSecond: number; audioBitsPerSecond: number }
> = {
  sharp: { height: 720, videoBitsPerSecond: 1_800_000, audioBitsPerSecond: 96_000 },
  standard: { height: 480, videoBitsPerSecond: 900_000, audioBitsPerSecond: 64_000 },
  long: { height: 360, videoBitsPerSecond: 450_000, audioBitsPerSecond: 48_000 },
};

/** Roughly how many minutes of this quality fit under the upload ceiling. */
export function minutesAvailable(quality: RecorderQuality): number {
  const preset = QUALITY_PRESETS[quality];
  const bytesPerSecond = (preset.videoBitsPerSecond + preset.audioBitsPerSecond) / 8;
  return Math.floor(UPLOAD_LIMITS.videoBytes / bytesPerSecond / 60);
}

/**
 * Containers worth asking for, best first.
 *
 * MP4 leads because Safari both records and plays it, so a recording made on an
 * iPhone needs no conversion by anybody. Chrome usually lands on WebM, which is
 * fine — Cloudinary converts it on delivery.
 */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

/** Frames a second. Thirty is smooth for a speaker and half the bytes of sixty. */
const CAPTURE_FPS = 30;

/**
 * Stop just short of the ceiling rather than at it.
 *
 * A recording that runs over is rejected by Cloudinary after it has been fully
 * uploaded, so the recorder stops itself while there is still a file worth
 * keeping. Two percent of headroom covers the container overhead written when
 * the file is finalised, which is not counted while the chunks arrive.
 */
const BUDGET_HEADROOM = 0.98;

/**
 * How much has been recorded so far, in bytes.
 *
 * Measured and estimated, whichever is larger, and the estimate is not a
 * fallback for tidiness — it is load-bearing. Asked for a chunk a second,
 * Chrome's WebM writer delivers the bytes as they are produced, but its MP4
 * writer delivers almost nothing until the recording stops and then hands over
 * the whole file at once. Trusting the measurement alone would mean the size
 * guard reads 36 bytes through a forty-minute recording and never fires, which
 * is precisely the case it exists for.
 *
 * The estimate is elapsed time at the bitrate the encoder was asked for, so it
 * is close by construction. Taking the larger of the two is the safe direction
 * in both containers: it stops early rather than late.
 */
function bytesUsed(measured: number, seconds: number, bitsPerSecond: number): number {
  return Math.max(measured, Math.round((seconds * bitsPerSecond) / 8));
}

export interface RecordedTake {
  /** Object URL for local preview. Revoked when the take is discarded. */
  url: string;
  blob: Blob;
  mimeType: string;
  extension: string;
  seconds: number;
  bytes: number;
  /** When recording began — the lesson's date and time, captured for you. */
  startedAt: Date;
  /** True when the recorder ended it because the size ceiling was reached. */
  endedEarly: boolean;
}

interface Options {
  branding: OverlayBranding;
  /** Off shows the raw camera; the file then carries no mark. Default on. */
  brandingEnabled: boolean;
}

export function useLessonRecorder({ branding, brandingEnabled }: Options) {
  const supported =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    Boolean(navigator?.mediaDevices?.getUserMedia);

  const [phase, setPhase] = useState<RecorderPhase>('starting');
  const [problem, setProblem] = useState<RecorderProblem | null>(null);
  const [quality, setQualityState] = useState<RecorderQuality>('standard');
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>('');
  const [microphoneId, setMicrophoneId] = useState<string>('');
  const [seconds, setSeconds] = useState(0);
  const [bytes, setBytes] = useState(0);
  const [take, setTake] = useState<RecordedTake | null>(null);

  const videoElRef = useRef<HTMLVideoElement | null>(null);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const canvasStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const bytesRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const segmentStartRef = useRef(0);
  const startedAtRef = useRef<Date | null>(null);
  const endedEarlyRef = useRef(false);
  const brandingRef = useRef<OverlayBranding>(branding);
  const brandingOnRef = useRef(brandingEnabled);
  const takeUrlRef = useRef<string | null>(null);

  brandingRef.current = branding;
  brandingOnRef.current = brandingEnabled;

  const mimeType = useMemo(() => {
    if (!supported) return '';
    return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
  }, [supported]);

  // ---------------------------------------------------------------- drawing

  /**
   * Draws the camera frame to fill the canvas, cropping rather than squashing.
   *
   * The two can disagree: switching to a front camera mid-recording may bring a
   * different aspect ratio, and the canvas cannot be resized without ending the
   * track that is being recorded. Cropping keeps the picture honest; stretching
   * would not.
   */
  const paint = useCallback(() => {
    frameRef.current = requestAnimationFrame(paint);

    const video = videoElRef.current;
    const canvas = canvasElRef.current;
    if (!video || !canvas || video.readyState < 2 || !canvas.width) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight);
    const drawWidth = video.videoWidth * scale;
    const drawHeight = video.videoHeight * scale;
    ctx.drawImage(
      video,
      (canvas.width - drawWidth) / 2,
      (canvas.height - drawHeight) / 2,
      drawWidth,
      drawHeight
    );

    if (brandingOnRef.current) {
      drawOverlay(
        ctx,
        { width: canvas.width, height: canvas.height },
        brandingRef.current,
        new Date()
      );
    }
  }, []);

  // ------------------------------------------------------------------ setup

  const stopTracks = (stream: MediaStream | null) => {
    stream?.getTracks().forEach((track) => track.stop());
  };

  const classify = (error: unknown): RecorderProblem => {
    const name = (error as { name?: string })?.name ?? '';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
    if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'notFound';
    if (name === 'NotReadableError' || name === 'AbortError') return 'inUse';
    return 'failed';
  };

  /**
   * Acquires the camera at the requested quality and attaches it to the hidden
   * video element the canvas reads from.
   *
   * The previous video stream is stopped only after the new one is running, so
   * a switch that fails leaves the old camera live rather than a black screen.
   */
  const openCamera = useCallback(
    async (deviceId: string, height: number) => {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          width: { ideal: Math.round((height * 16) / 9) },
          height: { ideal: height },
          frameRate: { ideal: CAPTURE_FPS },
        },
        audio: false,
      });

      const previous = videoStreamRef.current;
      videoStreamRef.current = stream;

      const video = videoElRef.current;
      if (video) {
        video.srcObject = stream;
        video.muted = true;
        await video.play().catch(() => undefined);
      }
      stopTracks(previous);

      const settings = stream.getVideoTracks()[0]?.getSettings();
      setCameraId(settings?.deviceId ?? deviceId);
      return settings;
    },
    []
  );

  /** Canvas dimensions follow the camera, capped by the quality preset. */
  const sizeCanvas = useCallback((quality: RecorderQuality) => {
    const canvas = canvasElRef.current;
    const video = videoElRef.current;
    if (!canvas || !video || !video.videoWidth) return;

    const cap = QUALITY_PRESETS[quality].height;
    const targetHeight = Math.min(cap, video.videoHeight);
    const ratio = video.videoWidth / video.videoHeight;

    // Even numbers: several encoders reject odd dimensions outright.
    canvas.height = Math.max(2, Math.round(targetHeight / 2) * 2);
    canvas.width = Math.max(2, Math.round((targetHeight * ratio) / 2) * 2);
  }, []);

  const prepare = useCallback(async () => {
    if (!supported) {
      setProblem(typeof window !== 'undefined' && !window.isSecureContext ? 'insecure' : 'unsupported');
      setPhase('blocked');
      return;
    }
    if (!window.isSecureContext) {
      setProblem('insecure');
      setPhase('blocked');
      return;
    }

    setPhase('starting');
    setProblem(null);

    try {
      // Microphone first and on its own. Asked for together, a machine with no
      // camera fails the whole request and the person is told the microphone is
      // broken too, which it is not.
      audioStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      setMicrophoneId(audioStreamRef.current.getAudioTracks()[0]?.getSettings().deviceId ?? '');

      await openCamera('', QUALITY_PRESETS[quality].height);

      // Only now are device labels readable. Before permission, browsers return
      // an unnamed list, and a picker of blank entries is worse than none.
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((d) => d.kind === 'videoinput'));
      setMicrophones(devices.filter((d) => d.kind === 'audioinput'));

      sizeCanvas(quality);
      setPhase('ready');
    } catch (error) {
      setProblem(classify(error));
      setPhase('blocked');
    }
  }, [supported, quality, openCamera, sizeCanvas]);

  useEffect(() => {
    void prepare();
    // Deliberately once. Re-running this on every quality change would ask for
    // the camera again mid-session; quality is handled by its own setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!supported) return;
    frameRef.current = requestAnimationFrame(paint);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [paint, supported]);

  // Everything the browser is holding on to is given back when the screen goes
  // away: a camera light left on after navigating elsewhere is alarming, and
  // reasonably so.
  useEffect(
    () => () => {
      stopTracks(videoStreamRef.current);
      stopTracks(audioStreamRef.current);
      stopTracks(canvasStreamRef.current);
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    },
    []
  );

  // -------------------------------------------------------------- recording

  const budgetBytes = UPLOAD_LIMITS.videoBytes * BUDGET_HEADROOM;
  const bitsPerSecond =
    QUALITY_PRESETS[quality].videoBitsPerSecond + QUALITY_PRESETS[quality].audioBitsPerSecond;
  const used = bytesUsed(bytes, seconds, bitsPerSecond);

  const start = useCallback(() => {
    const canvas = canvasElRef.current;
    const audio = audioStreamRef.current;
    if (!canvas || !audio || !mimeType) return;

    const canvasStream = canvas.captureStream(CAPTURE_FPS);
    canvasStreamRef.current = canvasStream;

    const videoTrack = canvasStream.getVideoTracks()[0];
    const audioTrack = audio.getAudioTracks()[0];
    if (!videoTrack || !audioTrack) return;

    const recorder = new MediaRecorder(new MediaStream([videoTrack, audioTrack]), {
      mimeType,
      videoBitsPerSecond: QUALITY_PRESETS[quality].videoBitsPerSecond,
      audioBitsPerSecond: QUALITY_PRESETS[quality].audioBitsPerSecond,
    });

    chunksRef.current = [];
    bytesRef.current = 0;
    elapsedRef.current = 0;
    endedEarlyRef.current = false;
    segmentStartRef.current = Date.now();
    startedAtRef.current = new Date();
    setBytes(0);
    setSeconds(0);

    recorder.ondataavailable = (event) => {
      if (!event.data.size) return;
      chunksRef.current.push(event.data);
      bytesRef.current += event.data.size;
      setBytes(bytesRef.current);

      // Stopped here rather than warned about. Past the ceiling the file cannot
      // be uploaded at all, so continuing would only add minutes that are
      // certain to be thrown away.
      if (bytesRef.current >= budgetBytes && recorder.state !== 'inactive') {
        endedEarlyRef.current = true;
        recorder.stop();
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
      const url = URL.createObjectURL(blob);
      takeUrlRef.current = url;

      canvasStreamRef.current?.getTracks().forEach((track) => track.stop());
      canvasStreamRef.current = null;

      setTake({
        url,
        blob,
        mimeType,
        extension: mimeType.includes('mp4') ? 'mp4' : 'webm',
        seconds: Math.round(elapsedRef.current / 1000),
        bytes: blob.size,
        startedAt: startedAtRef.current ?? new Date(),
        endedEarly: endedEarlyRef.current,
      });
      setPhase('recorded');
    };

    // A chunk a second, which is what makes the running size — and therefore the
    // time remaining — a measurement rather than an estimate.
    recorder.start(1000);
    recorderRef.current = recorder;
    setPhase('recording');
  }, [mimeType, quality, budgetBytes]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== 'recording') return;
    recorder.pause();
    elapsedRef.current += Date.now() - segmentStartRef.current;
    setPhase('paused');
  }, []);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== 'paused') return;
    segmentStartRef.current = Date.now();
    recorder.resume();
    setPhase('recording');
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    if (recorder.state === 'recording') elapsedRef.current += Date.now() - segmentStartRef.current;
    recorder.stop();
  }, []);

  /** Throws the take away and returns to the camera, ready to go again. */
  const discard = useCallback(() => {
    if (takeUrlRef.current) URL.revokeObjectURL(takeUrlRef.current);
    takeUrlRef.current = null;
    chunksRef.current = [];
    setTake(null);
    setBytes(0);
    setSeconds(0);
    setPhase('ready');
  }, []);

  // The clock, and with it the size guard. Driven by wall time rather than by
  // counting ticks, so a tab throttled in the background still reports the
  // truth when it comes back.
  useEffect(() => {
    if (phase !== 'recording') return;
    const id = setInterval(() => {
      const elapsed = Math.round(
        (elapsedRef.current + (Date.now() - segmentStartRef.current)) / 1000
      );
      setSeconds(elapsed);

      if (bytesUsed(bytesRef.current, elapsed, bitsPerSecond) >= budgetBytes) {
        endedEarlyRef.current = true;
        stop();
      }
    }, 250);
    return () => clearInterval(id);
  }, [phase, bitsPerSecond, budgetBytes, stop]);

  // ----------------------------------------------------------------- inputs

  const switchCamera = useCallback(
    async (deviceId: string) => {
      try {
        await openCamera(deviceId, QUALITY_PRESETS[quality].height);
        // Only when idle: resizing the canvas mid-recording would end the very
        // track being recorded.
        if (phase === 'ready') sizeCanvas(quality);
      } catch (error) {
        setProblem(classify(error));
      }
    },
    [openCamera, quality, phase, sizeCanvas]
  );

  /** Next camera in the list — the front/rear toggle on a phone. */
  const flipCamera = useCallback(() => {
    if (cameras.length < 2) return;
    const index = cameras.findIndex((device) => device.deviceId === cameraId);
    const next = cameras[(index + 1) % cameras.length];
    if (next) void switchCamera(next.deviceId);
  }, [cameras, cameraId, switchCamera]);

  const switchMicrophone = useCallback(async (deviceId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId }, echoCancellation: true, noiseSuppression: true },
      });
      stopTracks(audioStreamRef.current);
      audioStreamRef.current = stream;
      setMicrophoneId(deviceId);
    } catch (error) {
      setProblem(classify(error));
    }
  }, []);

  const setQuality = useCallback(
    async (next: RecorderQuality) => {
      setQualityState(next);
      try {
        await openCamera(cameraId, QUALITY_PRESETS[next].height);
        sizeCanvas(next);
      } catch {
        // The camera kept the resolution it had; the canvas cap still applies,
        // so the recording is smaller than asked for rather than broken.
        sizeCanvas(next);
      }
    },
    [cameraId, openCamera, sizeCanvas]
  );

  // ------------------------------------------------------------- thumbnails

  /**
   * A still from the take, for the card students see.
   *
   * Read from the recorded blob rather than the live canvas so it is a frame of
   * what was actually kept, watermark included, at a moment the person choosing
   * it can see.
   */
  const captureThumbnail = useCallback(
    (atSecond: number): Promise<string | null> =>
      new Promise((resolve) => {
        if (!take) {
          resolve(null);
          return;
        }
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.src = take.url;

        const fail = () => resolve(null);
        video.onerror = fail;
        video.onloadeddata = () => {
          video.currentTime = Math.min(Math.max(0, atSecond), Math.max(0, take.seconds - 0.1));
        };
        video.onseeked = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return fail();
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
          } catch {
            fail();
          }
        };
      }),
    [take]
  );

  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    videoElRef.current = element;
    const stream = videoStreamRef.current;
    if (element && stream) {
      element.srcObject = stream;
      void element.play().catch(() => undefined);
    }
  }, []);

  const attachCanvas = useCallback(
    (element: HTMLCanvasElement | null) => {
      canvasElRef.current = element;
      if (element) sizeCanvas(quality);
    },
    [sizeCanvas, quality]
  );

  const secondsRemaining = Math.max(
    0,
    Math.round((budgetBytes - used) / (bitsPerSecond / 8))
  );

  return {
    supported,
    phase,
    problem,
    retry: prepare,

    attachVideo,
    attachCanvas,

    cameras,
    microphones,
    cameraId,
    microphoneId,
    switchCamera,
    switchMicrophone,
    flipCamera,
    canFlip: cameras.length > 1,

    quality,
    setQuality,

    seconds,
    /** What the recording weighs so far — see `bytesUsed` on why it is a max. */
    bytes: used,
    secondsRemaining,

    start,
    pause,
    resume,
    stop,
    discard,

    take,
    captureThumbnail,
  };
}
