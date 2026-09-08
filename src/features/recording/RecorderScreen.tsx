import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { LANGUAGES } from '@/constants/app';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { formatCountdown, toISODate } from '@/utils/date';
import { formatBytes } from '@/utils/format';
import { friendlyMessage } from '@/utils/errors';
import { getSettings } from '@/services/settingsService';
import { listClasses } from '@/services/orgService';
import * as storage from '@/services/storageService';
import { saveVideo } from '@/services/videoService';
import type { ContentStatus, LanguageCode } from '@/types';
import { ImageField } from '@/components/shared/ImageField';
import {
  AppHeader,
  Button,
  Card,
  DateField,
  IconButton,
  Screen,
  SectionHeader,
  Select,
  Spacer,
  TextField,
  ToggleRow,
  type Option,
} from '@/components/ui';

import { loadBrandingImage, type OverlayBranding } from './overlay';
import {
  minutesAvailable,
  useLessonRecorder,
  type RecorderProblem,
  type RecorderQuality,
} from './useLessonRecorder';

/**
 * Record a lesson, describe it, publish it.
 *
 * One screen and two stages, deliberately. A recording is made in a room with
 * people waiting in it, so the camera comes up immediately and everything that
 * can be asked afterwards is asked afterwards — the title, the subject, the
 * class. Nothing stands between opening this screen and being able to press
 * record except the browser's own permission prompt.
 *
 * The date and time are never asked for at all. They are what the clock said
 * when recording started, which is a fact the app already has and a person
 * would only get wrong.
 */
export function RecorderScreen({ basePath }: { basePath: '/(admin)' | '/(teacher)' }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { language } = useLanguage();
  const toast = useToast();
  const router = useRouter();

  const [brandingEnabled, setBrandingEnabled] = useState(true);
  const [branding, setBranding] = useState<OverlayBranding>({ logo: null, banner: null, name: '' });

  const { data: settings } = useAsync(() => getSettings().catch(() => null), []);
  const { data: classes } = useAsync(
    () => listClasses({ pageSize: 100 }).then((page) => page.items).catch(() => []),
    []
  );

  // Branding images are fetched and decoded once, up front. Doing it when
  // recording starts would drop the logo from the first second of every video.
  useEffect(() => {
    if (!settings) return;
    let cancelled = false;
    void Promise.all([
      loadBrandingImage(settings.logoUrl),
      loadBrandingImage(settings.bannerUrl),
    ]).then(([logo, banner]) => {
      if (cancelled) return;
      setBranding({ logo, banner, name: settings.appName, venue: settings.venue });
    });
    return () => {
      cancelled = true;
    };
  }, [settings]);

  const recorder = useLessonRecorder({ branding, brandingEnabled });

  /** A take from the device's own camera app, on native. */
  const [deviceTake, setDeviceTake] = useState<{
    uri: string;
    mimeType: string;
    extension: string;
    bytes: number;
    seconds: number;
    startedAt: Date;
  } | null>(null);

  const take = recorder.take;
  const [describing, setDescribing] = useState(false);

  const forUpload: TakeForUpload | null = take
    ? {
        uri: take.url,
        blob: take.blob,
        mimeType: take.mimeType,
        extension: take.extension,
        bytes: take.bytes,
        seconds: take.seconds,
        startedAt: take.startedAt,
      }
    : deviceTake
      ? { ...deviceTake, blob: null }
      : null;

  if (!user) return null;

  return (
    <View style={{ flex: 1 }}>
      <AppHeader
        title={t('record.title')}
        subtitle={describing ? t('record.detailsTitle') : t('record.lead')}
        showBack
      />

      <Screen>
        {describing && forUpload ? (
          <DetailsStage
            take={forUpload}
            captureFrame={take ? recorder.captureThumbnail : null}
            defaultSpeaker={user.fullName}
            defaultLanguage={language}
            classes={classes ?? []}
            logoUrl={settings?.logoUrl ?? null}
            bannerUrl={settings?.bannerUrl ?? null}
            fallbackThumbnail={settings?.thumbnailUrl ?? null}
            onBack={() => setDescribing(false)}
            onSaved={(status) => {
              toast.success(t(status === 'published' ? 'record.published' : 'record.drafted'));
              router.replace(`${basePath}/recordings`);
            }}
          />
        ) : Platform.OS === 'web' ? (
          <WebCaptureStage
            recorder={recorder}
            brandingEnabled={brandingEnabled}
            onBrandingChange={setBrandingEnabled}
            onAccept={() => setDescribing(true)}
          />
        ) : (
          <DeviceCameraStage
            onCaptured={(captured) => {
              setDeviceTake(captured);
              setDescribing(true);
            }}
          />
        )}
      </Screen>
    </View>
  );
}

// ---------------------------------------------------------------- web stage

type Recorder = ReturnType<typeof useLessonRecorder>;

function WebCaptureStage({
  recorder,
  brandingEnabled,
  onBrandingChange,
  onAccept,
}: {
  recorder: Recorder;
  brandingEnabled: boolean;
  onBrandingChange: (value: boolean) => void;
  onAccept: () => void;
}) {
  const { t } = useTranslation();
  const [showDevices, setShowDevices] = useState(false);

  const live = recorder.phase === 'recording' || recorder.phase === 'paused';

  if (recorder.phase === 'blocked') {
    return <Blocked problem={recorder.problem} onRetry={recorder.retry} />;
  }

  return (
    <>
      {/* The camera, hidden. What is on screen is the canvas below, which is the
          camera with the branding drawn over it — so the preview is literally
          the recording rather than an approximation of it. */}
      {React.createElement('video', {
        ref: recorder.attachVideo,
        playsInline: true,
        style: {
          position: 'absolute',
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
        },
      })}

      {recorder.take ? (
        <>
          <SectionHeader title={t('record.preview')} icon="play-circle-outline" />
          <View style={styles.stage}>
            {React.createElement('video', {
              src: recorder.take.url,
              controls: true,
              playsInline: true,
              style: { width: '100%', display: 'block', borderRadius: 14, background: '#000' },
            })}
          </View>

          <Text style={styles.factLine}>
            {formatCountdown(recorder.take.seconds)} · {formatBytes(recorder.take.bytes)}
          </Text>

          {recorder.take.endedEarly ? (
            <Notice tone="warning" icon="alert-circle-outline" text={t('record.endedEarly')} />
          ) : null}

          <Spacer />
          <View style={styles.buttonRow}>
            <Button
              label={t('record.again')}
              icon="refresh-outline"
              variant="outline"
              onPress={recorder.discard}
              style={{ flex: 1 }}
            />
            <Button
              label={t('record.useThis')}
              icon="arrow-forward"
              onPress={onAccept}
              style={{ flex: 1 }}
            />
          </View>
        </>
      ) : (
        <>
          <View style={styles.stage}>
            {React.createElement('canvas', {
              ref: recorder.attachCanvas,
              style: { width: '100%', display: 'block', borderRadius: 14, background: '#000' },
            })}

            {live ? (
              <View style={styles.timerBadge}>
                <View
                  style={[
                    styles.dot,
                    { backgroundColor: recorder.phase === 'paused' ? colors.warning : colors.danger },
                  ]}
                />
                <Text style={styles.timerText}>{formatCountdown(recorder.seconds)}</Text>
              </View>
            ) : null}

            {recorder.canFlip ? (
              <View style={styles.flip}>
                <IconButton
                  icon="camera-reverse-outline"
                  label={t('record.flip')}
                  onPress={recorder.flipCamera}
                  color={colors.textInverse}
                  background="rgba(4,30,74,0.6)"
                />
              </View>
            ) : null}
          </View>

          <View style={styles.meterRow}>
            <Text style={styles.meterText}>
              {recorder.phase === 'starting'
                ? t('record.starting')
                : t('record.remaining', { time: formatCountdown(recorder.secondsRemaining) })}
            </Text>
            {recorder.bytes > 0 ? (
              <Text style={styles.meterText}>{formatBytes(recorder.bytes)}</Text>
            ) : null}
          </View>

          {/* Said plainly, because the alternative is a teacher who thinks
              they recorded twenty minutes and finds a still photograph. */}
          {recorder.interrupted ? (
            <View style={styles.interrupted}>
              <Ionicons name="alert-circle" size={16} color={brand.orangeDark} />
              <Text style={styles.interruptedText}>{t('record.backgroundPaused')}</Text>
            </View>
          ) : null}

          <Spacer size={spacing.md} />

          <View style={styles.buttonRow}>
            {recorder.phase === 'recording' ? (
              <>
                <Button
                  label={t('record.pause')}
                  icon="pause"
                  variant="outline"
                  onPress={recorder.pause}
                  style={{ flex: 1 }}
                />
                <Button
                  label={t('record.stop')}
                  icon="stop"
                  variant="danger"
                  onPress={recorder.stop}
                  style={{ flex: 1 }}
                />
              </>
            ) : recorder.phase === 'paused' ? (
              <>
                <Button
                  label={t('record.resume')}
                  icon="play"
                  onPress={recorder.resume}
                  style={{ flex: 1 }}
                />
                <Button
                  label={t('record.stop')}
                  icon="stop"
                  variant="danger"
                  onPress={recorder.stop}
                  style={{ flex: 1 }}
                />
              </>
            ) : (
              <Button
                label={t('record.start')}
                icon="radio-button-on"
                size="lg"
                fullWidth
                disabled={recorder.phase !== 'ready'}
                onPress={recorder.start}
              />
            )}
          </View>

          <Spacer size={spacing.lg} />

          {/* Settings live under a disclosure because the defaults are right for
              almost every recording, and a row of pickers between somebody and
              the record button is a row of decisions they did not need to make. */}
          <Card>
            <Disclosure
              onPress={() => setShowDevices((open) => !open)}
              label={t('record.options')}
              open={showDevices}
            />

            {showDevices ? (
              <View style={{ marginTop: spacing.md }}>
                <Select<RecorderQuality>
                  label={t('record.quality')}
                  value={recorder.quality}
                  disabled={live}
                  options={(['sharp', 'standard', 'long'] as RecorderQuality[]).map((value) => ({
                    value,
                    label: t(`record.quality_${value}`),
                    description: t('record.qualityMinutes', { minutes: minutesAvailable(value) }),
                  }))}
                  onChange={(value) => void recorder.setQuality(value)}
                />

                <Select
                  label={t('record.camera')}
                  value={recorder.cameraId}
                  options={deviceOptions(recorder.cameras, t('record.camera'))}
                  onChange={(value) => void recorder.switchCamera(value)}
                />

                <Select
                  label={t('record.microphone')}
                  value={recorder.microphoneId}
                  disabled={live}
                  options={deviceOptions(recorder.microphones, t('record.microphone'))}
                  onChange={(value) => void recorder.switchMicrophone(value)}
                />

                <ToggleRow
                  label={t('record.branding')}
                  description={t('record.brandingHint')}
                  value={brandingEnabled}
                  onValueChange={onBrandingChange}
                  disabled={live}
                />
              </View>
            ) : null}
          </Card>
        </>
      )}
    </>
  );
}

function deviceOptions(devices: MediaDeviceInfo[], fallbackLabel: string): Option[] {
  return devices.map((device, index) => ({
    value: device.deviceId,
    // Browsers hand back an empty label for a device the page has not been
    // granted access to; numbering them at least keeps them distinguishable.
    label: device.label || `${fallbackLabel} ${index + 1}`,
  }));
}

/** A disclosure header. Small enough not to warrant its own file. */
function Disclosure({
  onPress,
  label,
  open,
}: {
  onPress: () => void;
  label: string;
  open: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded: open }}
      style={styles.disclosure}
    >
      <Ionicons name="options-outline" size={16} color={colors.textSecondary} />
      <Text style={styles.disclosureText}>{label}</Text>
      <Ionicons
        name={open ? 'chevron-up' : 'chevron-down'}
        size={16}
        color={colors.textSecondary}
      />
    </Pressable>
  );
}

/**
 * What to do about a camera that will not open.
 *
 * Each case gets its own instructions because each has a different fix, and the
 * commonest one — a permission denied in the past and remembered by the browser
 * — cannot be undone by this app at all. Only the person can undo it, and only
 * if they are told where to look.
 */
function Blocked({
  problem,
  onRetry,
}: {
  problem: RecorderProblem | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const key = problem ?? 'failed';

  return (
    <Card style={styles.blocked}>
      <View style={styles.blockedIcon}>
        <Ionicons name="videocam-off-outline" size={26} color={colors.danger} />
      </View>
      <Text style={styles.blockedTitle}>{t(`record.problem_${key}_title`)}</Text>
      <Text style={styles.blockedBody}>{t(`record.problem_${key}_body`)}</Text>

      {key === 'denied' ? (
        <Text style={styles.blockedSteps}>{t('record.problem_denied_steps')}</Text>
      ) : null}

      {key === 'unsupported' || key === 'insecure' ? null : (
        <Button
          label={t('record.tryAgain')}
          icon="refresh-outline"
          onPress={onRetry}
          style={{ marginTop: spacing.lg }}
        />
      )}
    </Card>
  );
}

// ------------------------------------------------------------- native stage

/**
 * On a phone build there is no MediaRecorder, so the device's own camera app
 * does the recording.
 *
 * It loses the branding burned into the frame — nothing here can draw on a
 * video the operating system produced — and gains everything the platform
 * camera already does well: stabilisation, focus, its own pause button, and a
 * front/rear switch the person already knows how to use.
 */
function DeviceCameraStage({
  onCaptured,
}: {
  onCaptured: (take: {
    uri: string;
    mimeType: string;
    extension: string;
    bytes: number;
    seconds: number;
    startedAt: Date;
  }) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setBusy(true);
    try {
      const ImagePicker = await import('expo-image-picker');
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        toast.error(t('record.problem_denied_body'));
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['videos'],
        quality: 0.7,
        // A ceiling in minutes, because the real ceiling is in megabytes and
        // the platform camera will not tell us the bitrate it is using. Six
        // minutes is under the upload limit at every quality a phone is likely
        // to choose. Cutting the recording short is bad; letting somebody film
        // for forty minutes and then refusing the file is worse.
        videoMaxDuration: 360,
      });
      if (result.canceled || !result.assets[0]) return;

      const asset = result.assets[0];
      onCaptured({
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'video/mp4',
        extension: asset.uri.split('.').pop() ?? 'mp4',
        bytes: asset.fileSize ?? 0,
        seconds: asset.duration ? Math.round(asset.duration / 1000) : 0,
        startedAt: new Date(),
      });
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl }}>
      <View style={styles.blockedIcon}>
        <Ionicons name="videocam-outline" size={26} color={colors.primary} />
      </View>
      <Text style={styles.blockedTitle}>{t('record.deviceCamera')}</Text>
      <Text style={styles.blockedBody}>{t('record.deviceCameraHint')}</Text>
      <Button
        label={t('record.openCamera')}
        icon="camera-outline"
        loading={busy}
        onPress={() => void open()}
        style={{ marginTop: spacing.sm }}
      />
    </Card>
  );
}

// ------------------------------------------------------------ details stage

interface TakeForUpload {
  uri: string;
  blob: Blob | null;
  mimeType: string;
  extension: string;
  bytes: number;
  seconds: number;
  startedAt: Date;
}

function DetailsStage({
  take,
  captureFrame,
  defaultSpeaker,
  defaultLanguage,
  classes,
  logoUrl,
  bannerUrl,
  fallbackThumbnail,
  onBack,
  onSaved,
}: {
  take: TakeForUpload;
  captureFrame: ((atSecond: number) => Promise<string | null>) | null;
  defaultSpeaker: string;
  defaultLanguage: LanguageCode;
  classes: { id: string; name: string; branchId?: string | null }[];
  logoUrl: string | null;
  bannerUrl: string | null;
  fallbackThumbnail: string | null;
  onBack: () => void;
  onSaved: (status: ContentStatus) => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();

  const [title, setTitle] = useState('');
  const [topic, setTopic] = useState('');
  const [speaker, setSpeaker] = useState(defaultSpeaker);
  const [date, setDate] = useState(toISODate(take.startedAt));
  const [description, setDescription] = useState('');
  const [classId, setClassId] = useState('');
  const [language, setLanguage] = useState<LanguageCode>(defaultLanguage);
  const [thumbnail, setThumbnail] = useState('');
  const [frame, setFrame] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState<'idle' | 'video' | 'cover' | 'record'>('idle');

  /**
   * The recording again, small, above the cover controls.
   *
   * Not a duplicate of the preview on the stage before: that one answers "keep
   * this or record it again", this one is how a frame is chosen. Scrub to the
   * moment that represents the lesson and take it.
   */
  const previewRef = useRef<HTMLVideoElement | null>(null);

  // A cover is chosen for you the moment this screen opens, from a second into
  // the recording. Nobody has to think about it, and it is still replaceable.
  useEffect(() => {
    if (!captureFrame) return;
    void captureFrame(1).then(setFrame);
  }, [captureFrame]);

  const classOptions = useMemo<Option[]>(
    () => classes.map((item) => ({ value: item.id, label: item.name })),
    [classes]
  );
  const branchForClass = useMemo(
    () => new Map(classes.map((item) => [item.id, item.branchId ?? null])),
    [classes]
  );

  const busy = stage !== 'idle';

  const save = async (status: ContentStatus) => {
    if (!user) return;
    if (!title.trim()) {
      setError('validation.titleRequired');
      return;
    }
    setError(null);

    try {
      setStage('video');
      setProgress(0);
      const uploaded = await storage.uploadVideo({
        uri: take.uri,
        fileName: `${slug(title)}.${take.extension}`,
        ownerId: user.uid,
        contentType: take.mimeType,
        sizeBytes: take.bytes || take.blob?.size,
        onProgress: setProgress,
      });

      // The cover, in order of what the person actually chose: a picture they
      // gave, then the frame they picked, then a still Cloudinary makes from
      // the video itself, then the organisation's default. Only the last is a
      // guess, and by then it is the only thing left.
      setStage('cover');
      let cover = thumbnail.trim();
      if (!cover && frame) {
        cover = await storage
          .upload({
            uri: frame,
            fileName: `${slug(title)}-cover.jpg`,
            kind: 'thumbnail',
            ownerId: user.uid,
            contentType: 'image/jpeg',
          })
          .then((result) => result.url)
          .catch(() => '');
      }
      if (!cover) cover = storage.videoPosterUrl(uploaded.url) ?? fallbackThumbnail ?? '';

      setStage('record');
      const seconds = uploaded.durationSeconds ?? take.seconds;
      await saveVideo(
        {
          title: title.trim(),
          description: description.trim(),
          speaker: speaker.trim(),
          topic: topic.trim(),
          videoUrl: uploaded.url,
          thumbnail: cover || null,
          // Copied onto the recording, exactly as the video manager does it, so
          // changing the organisation's logo later never restyles this one.
          logoUrl,
          bannerUrl,
          duration: seconds ? Math.max(1, Math.round(seconds / 60)) : undefined,
          date: new Date(date || toISODate(take.startedAt)),
          classId: classId || null,
          branchId: classId ? (branchForClass.get(classId) ?? null) : null,
          language,
          status,
          isFeatured: false,
          // Recorded lessons, not general videos: this is what puts it in the
          // student's Recorded Lessons list, and what `saveVideo` announces.
          kind: 'recording',
        },
        user
      );

      onSaved(status);
    } catch (uploadError) {
      toast.error(friendlyMessage(uploadError, t));
    } finally {
      setStage('idle');
    }
  };

  return (
    <>
      {busy ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={styles.progressLabel}>{t(`record.stage_${stage}`)}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${stage === 'video' ? progress : 100}%` }]} />
          </View>
          <Text style={styles.progressMeta}>
            {stage === 'video' ? `${progress}%  ·  ${formatBytes(take.bytes)}` : ''}
          </Text>
        </Card>
      ) : null}

      {captureFrame ? (
        <View style={[styles.stage, { marginBottom: spacing.lg }]}>
          {React.createElement('video', {
            ref: previewRef,
            src: take.uri,
            controls: true,
            playsInline: true,
            style: { width: '100%', display: 'block', borderRadius: 14, background: '#000' },
          })}
        </View>
      ) : null}

      <SectionHeader title={t('record.cover')} icon="image-outline" />
      <View style={styles.coverRow}>
        {frame || thumbnail ? (
          <Image
            source={{ uri: thumbnail || frame || '' }}
            style={styles.coverImage}
            resizeMode="cover"
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={styles.coverEmpty}>
            <Ionicons name="image-outline" size={20} color={colors.textMuted} />
          </View>
        )}

        {captureFrame ? (
          <View style={{ flex: 1, gap: spacing.xs }}>
            <Text style={styles.hint}>{t('record.coverHint')}</Text>
            <Button
              label={t('record.useFrame')}
              icon="camera-outline"
              variant="outline"
              size="sm"
              onPress={() => {
                const at = previewRef.current?.currentTime ?? 1;
                void captureFrame(at > 0.1 ? at : 1).then((next) => {
                  if (next) {
                    setFrame(next);
                    setThumbnail('');
                  }
                });
              }}
            />
          </View>
        ) : (
          <Text style={[styles.hint, { flex: 1 }]}>{t('record.coverHintNative')}</Text>
        )}
      </View>

      <Spacer />

      <TextField
        label={t('common.title')}
        value={title}
        onChangeText={setTitle}
        error={error ? t(error) : null}
        icon="book-outline"
        required
      />
      <TextField
        label={t('record.subject')}
        value={topic}
        onChangeText={setTopic}
        icon="pricetag-outline"
      />
      <TextField
        label={t('video.speaker')}
        value={speaker}
        onChangeText={setSpeaker}
        icon="mic-outline"
      />
      <DateField label={t('common.date')} value={date} onChange={setDate} />
      <TextField
        label={t('common.description')}
        value={description}
        onChangeText={setDescription}
        multiline
      />
      <Select
        label={t('lesson.assignedClass')}
        value={classId}
        options={classOptions}
        onChange={setClassId}
        placeholder={t('common.all')}
        allowClear
      />
      <Select<LanguageCode>
        label={t('common.language')}
        value={language}
        options={LANGUAGES.map((item) => ({
          value: item.code,
          label: item.nativeName,
        }))}
        onChange={setLanguage}
      />

      <ImageField
        label={t('record.customCover')}
        value={thumbnail}
        onChange={setThumbnail}
        kind="thumbnail"
        aspectRatio={16 / 9}
        hint={t('record.customCoverHint')}
      />

      <Spacer />

      <View style={styles.buttonRow}>
        <Button
          label={t('record.saveDraft')}
          icon="document-outline"
          variant="outline"
          disabled={busy}
          onPress={() => void save('draft')}
          style={{ flex: 1 }}
        />
        <Button
          label={t('record.publish')}
          icon="send-outline"
          loading={busy}
          onPress={() => void save('published')}
          style={{ flex: 1 }}
        />
      </View>

      <Text style={styles.publishNote}>{t('record.publishNote')}</Text>

      <Spacer />
      <Button
        label={t('record.back')}
        icon="chevron-back"
        variant="ghost"
        disabled={busy}
        onPress={onBack}
      />
      <Spacer size={spacing.xxl} />
    </>
  );
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^\w]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'lesson'
  );
}

function Notice({
  tone,
  icon,
  text,
}: {
  tone: 'warning';
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
}) {
  return (
    <View style={[styles.notice, tone === 'warning' ? styles.noticeWarning : null]}>
      <Ionicons name={icon} size={16} color={colors.warning} />
      <Text style={styles.noticeText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  timerBadge: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(4,30,74,0.72)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  dot: { width: 9, height: 9, borderRadius: 5 },
  timerText: {
    color: colors.textInverse,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    // Tabular-ish: a proportional font makes a running clock jitter.
    letterSpacing: 1,
  },
  /**
   * Bottom right, not top right — the logo is drawn into the top right corner
   * of every frame, and a button parked on top of the watermark hides the one
   * thing the watermark exists to show. The offset clears the branding strip
   * along the bottom, which is 13% of the frame.
   */
  flip: { position: 'absolute', bottom: '18%', right: spacing.md },
  interrupted: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.warningSoft,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  interruptedText: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.text,
    lineHeight: 18,
  },
  meterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  meterText: { fontSize: fontSize.xs, color: colors.textMuted },
  factLine: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  buttonRow: { flexDirection: 'row', gap: spacing.md },
  disclosure: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  disclosureText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
  },
  blocked: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  blockedIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockedTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
    textAlign: 'center',
  },
  blockedBody: {
    fontSize: fontSize.sm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  blockedSteps: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: spacing.sm,
  },
  coverRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  coverImage: { width: 160, height: 90, borderRadius: 10, backgroundColor: colors.surfaceMuted },
  coverEmpty: {
    width: 160,
    height: 90,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 17 },
  progressLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  fill: { height: '100%', backgroundColor: brand.orange },
  progressMeta: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  publishNote: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 17,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  noticeWarning: { backgroundColor: colors.warningSoft },
  noticeText: { flex: 1, fontSize: fontSize.xs, color: colors.text, lineHeight: 17 },
});
