import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/contexts/ToastContext';
import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import * as storageService from '@/services/storageService';
import { Button, IconButton, TextField } from '@/components/ui';

/**
 * An image that can be either uploaded or pasted as a URL.
 *
 * Both paths are offered deliberately. Uploading needs Cloud Storage to be
 * enabled on the Firebase project, and pasting a link works with no Storage at
 * all — which keeps this usable on a project that has not set Storage up, and
 * lets a large asset live somewhere that does not consume the free quota.
 */
export function ImageField({
  label,
  value,
  onChange,
  hint,
  kind = 'branding',
  ownerId = 'shared',
  aspectRatio = 1,
}: {
  label: string;
  value: string;
  onChange: (url: string) => void;
  hint?: string;
  kind?: storageService.UploadKind;
  ownerId?: string;
  /** Preview shape. Use ~3 for a wide banner, 1 for a square logo. */
  aspectRatio?: number;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const pick = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      toast.error(t('errors.permissionDenied'));
      return;
    }

    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });
    if (picked.canceled || !picked.assets[0]) return;

    const asset = picked.assets[0];
    setUploading(true);
    setProgress(0);
    try {
      const uploaded = await storageService.upload({
        uri: asset.uri,
        fileName: asset.fileName ?? `${label.toLowerCase()}.jpg`,
        kind,
        ownerId,
        contentType: asset.mimeType ?? 'image/jpeg',
        onProgress: setProgress,
      });
      onChange(uploaded.url);
      toast.success(t('common.success'));
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>

      {value ? (
        <View style={styles.previewRow}>
          <Image
            source={{ uri: value }}
            style={[styles.preview, { aspectRatio }]}
            resizeMode="contain"
            accessibilityLabel={label}
          />
          <IconButton
            icon="close"
            label={t('common.clear')}
            size={32}
            color={colors.danger}
            background={colors.dangerSoft}
            onPress={() => onChange('')}
          />
        </View>
      ) : null}

      <Button
        label={uploading ? t('material.uploading', { percent: progress }) : t('material.upload')}
        icon="image-outline"
        variant="outline"
        size="sm"
        loading={uploading}
        onPress={pick}
      />

      <Text style={styles.or}>{t('material.orPasteLink')}</Text>

      <TextField
        value={value}
        onChangeText={onChange}
        placeholder="https://…"
        autoCapitalize="none"
        icon="link-outline"
        hint={hint}
        containerStyle={{ marginBottom: 0 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.lg },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  preview: {
    flex: 1,
    maxHeight: 120,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  or: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    marginVertical: spacing.sm,
  },
});
