import React, { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { formatBytes } from '@/utils/format';
import * as storage from '@/services/storageService';
import { Button, IconButton } from '@/components/ui';

/**
 * Attach a recording — an audio or video file — to something.
 *
 * Separate from the "paste a link" field beside it, because they solve
 * different problems. A link costs nothing and is right when the recording is
 * already on YouTube. An upload is the only option when the recording exists
 * only on the phone that made it, which for a Friday khutbah is the usual case.
 *
 * Video goes through the same path as a recorded lesson, so it inherits that
 * path's size ceiling and its honest failure when a file is too large — better
 * than discovering the limit after a long upload.
 */
export function MediaField({
  url,
  type,
  onChange,
  label,
  hint,
}: {
  url: string;
  type: 'audio' | 'video' | null;
  onChange: (next: { url: string; type: 'audio' | 'video' | null }) => void;
  label: string;
  hint?: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);

  const pick = async () => {
    if (!user) return;
    setBusy(true);
    setProgress(0);
    try {
      const DocumentPicker = await import('expo-document-picker');
      const picked = await DocumentPicker.getDocumentAsync({
        type: ['audio/*', 'video/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;

      const asset = picked.assets[0];
      const mime = asset.mimeType ?? '';
      const isVideo = mime.startsWith('video');

      const uploaded = isVideo
        ? await storage.uploadVideo({
            uri: asset.uri,
            fileName: asset.name ?? 'recording.mp4',
            ownerId: user.uid,
            contentType: mime || 'video/mp4',
            sizeBytes: asset.size,
            onProgress: setProgress,
          })
        : await storage.upload({
            uri: asset.uri,
            fileName: asset.name ?? 'recording.mp3',
            kind: 'material',
            ownerId: user.uid,
            contentType: mime || 'audio/mpeg',
            onProgress: setProgress,
          });

      onChange({ url: uploaded.url, type: isVideo ? 'video' : 'audio' });
      toast.success(t('common.success'));
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>

      {url ? (
        <View style={styles.attached}>
          <Ionicons
            name={type === 'video' ? 'videocam' : 'musical-notes'}
            size={16}
            color={colors.primary}
          />
          <Text style={styles.attachedText} numberOfLines={1}>
            {t(type === 'video' ? 'khutbah.videoAttached' : 'khutbah.audioAttached')}
          </Text>
          <IconButton
            icon="close"
            label={t('common.remove')}
            size={30}
            color={colors.danger}
            background={colors.dangerSoft}
            onPress={() => onChange({ url: '', type: null })}
          />
        </View>
      ) : (
        <Button
          label={t('khutbah.attachMedia')}
          icon="cloud-upload-outline"
          variant="outline"
          size="sm"
          loading={busy}
          onPress={() => void pick()}
        />
      )}

      {busy && progress > 0 ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progress}%` }]} />
        </View>
      ) : null}

      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {Platform.OS === 'web' ? null : (
        <Text style={styles.hint}>{t('khutbah.attachHintNative')}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.lg },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  attached: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  attachedText: { flex: 1, fontSize: fontSize.xs, color: colors.text },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
    marginTop: spacing.sm,
  },
  fill: { height: '100%', backgroundColor: colors.accent },
  hint: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs, lineHeight: 16 },
});
