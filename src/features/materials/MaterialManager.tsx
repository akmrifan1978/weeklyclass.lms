import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAsync } from '@/hooks/useAsync';
import { colors, fontSize, radius, spacing } from '@/constants/theme';
import { friendlyMessage } from '@/utils/errors';
import { formatBytes, matchesSearch } from '@/utils/format';
import { deleteMaterial, listMaterials, saveMaterial } from '@/services/contentService';
import { listClasses } from '@/services/orgService';
import * as storageService from '@/services/storageService';
import type { ContentStatus, LanguageCode, Material, MaterialType } from '@/types';
import type { Cursor } from '@/services/firestore';
import { CrudScreen } from '@/features/CrudScreen';
import { AdminRow } from '@/features/AdminRow';
import { Button, Select, TextField, type Option } from '@/components/ui';

interface MaterialForm {
  title: string;
  description: string;
  type: MaterialType;
  url: string;
  storagePath: string;
  size: string;
  classId: string;
  language: LanguageCode;
  status: ContentStatus;
}

const EMPTY: MaterialForm = {
  title: '',
  description: '',
  type: 'pdf',
  url: '',
  storagePath: '',
  size: '',
  classId: '',
  language: 'en',
  status: 'published',
};

/**
 * Study materials.
 *
 * Files can either be uploaded to Firebase Storage or referenced by URL. The
 * link option exists so a large PDF can live on Google Drive without touching
 * the 5 GB free Storage quota.
 */
export function MaterialManager({ classScope }: { classScope?: string[] }) {
  const { t } = useTranslation();
  const { user, can } = useAuth();
  const toast = useToast();

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const loadClasses = useCallback(async () => {
    const page = await listClasses({ pageSize: 100 });
    return classScope ? page.items.filter((c) => classScope.includes(c.id)) : page.items;
  }, [classScope]);

  const { data: classes } = useAsync(loadClasses, [classScope?.join(',')]);

  const classOptions = useMemo<Option[]>(
    () => (classes ?? []).map((c) => ({ value: c.id, label: c.name })),
    [classes]
  );

  const fetchPage = useCallback(
    async (cursor: Cursor, search: string) => {
      const page = await listMaterials({ cursor, pageSize: 20 });
      const scoped = classScope
        ? page.items.filter((m) => !m.classId || classScope.includes(m.classId))
        : page.items;
      return {
        ...page,
        items: search
          ? scoped.filter((m) => matchesSearch(search, m.title, m.description))
          : scoped,
      };
    },
    [classScope]
  );

  const pickAndUpload = async (
    form: MaterialForm,
    set: <K extends keyof MaterialForm>(key: K, value: MaterialForm[K]) => void
  ) => {
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets[0]) return;

    const asset = picked.assets[0];
    setUploading(true);
    setProgress(0);
    try {
      const uploaded = await storageService.upload({
        uri: asset.uri,
        fileName: asset.name,
        kind: 'material',
        ownerId: form.classId || 'shared',
        contentType: asset.mimeType ?? undefined,
        onProgress: setProgress,
      });
      set('url', uploaded.url);
      set('storagePath', uploaded.path);
      set('size', String(uploaded.size));
      set('type', storageService.materialTypeFor(uploaded.contentType, asset.name));
      if (!form.title) set('title', asset.name.replace(/\.[^.]+$/, ''));
      toast.success(t('common.success'));
    } catch (error) {
      toast.error(friendlyMessage(error, t));
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  return (
    <CrudScreen<Material, MaterialForm>
      title={t('material.title')}
      addLabel={t('common.add')}
      emptyIcon="folder-open-outline"
      emptyTitle={t('material.noMaterials')}
      canCreate={can('UPLOAD_MATERIAL')}
      canDelete={can('DELETE_MATERIAL')}
      deps={[classScope?.join(',')]}
      fetchPage={fetchPage}
      emptyForm={EMPTY}
      toForm={(material) => ({
        title: material.title,
        description: material.description ?? '',
        type: material.type,
        url: material.url,
        storagePath: material.storagePath ?? '',
        size: material.size ? String(material.size) : '',
        classId: material.classId ?? '',
        language: material.language,
        status: material.status,
      })}
      validate={(form) => {
        const errors: Record<string, string> = {};
        if (!form.title.trim()) errors.title = 'validation.titleRequired';
        if (!form.url.trim()) errors.url = 'validation.invalidUrl';
        return Object.keys(errors).length ? errors : null;
      }}
      onSave={async (form, existing) => {
        if (!user) throw new Error('unauthenticated');
        return saveMaterial(
          {
            title: form.title.trim(),
            description: form.description.trim(),
            type: form.type,
            url: form.url.trim(),
            storagePath: form.storagePath || null,
            size: form.size ? Number(form.size) : undefined,
            classId: form.classId || null,
            language: form.language,
            status: form.status,
          },
          user,
          existing?.id
        );
      }}
      onDelete={async (material) => {
        if (!user) return;
        await deleteMaterial(material.id, user);
        // Remove the stored object too, otherwise the free quota leaks.
        await storageService.remove(material.storagePath);
      }}
      renderItem={(material, actions) => (
        <AdminRow
          icon={
            material.type === 'pdf'
              ? 'document-text-outline'
              : material.type === 'audio'
                ? 'headset-outline'
                : material.type === 'image'
                  ? 'image-outline'
                  : material.type === 'link'
                    ? 'link-outline'
                    : 'document-outline'
          }
          title={material.title}
          subtitle={material.description || undefined}
          meta={[material.type.toUpperCase(), material.size ? formatBytes(material.size) : null]
            .filter(Boolean)
            .join(' · ')}
          badges={[{ label: t(`common.${material.status}`), tone: material.status }]}
          onEdit={can('UPLOAD_MATERIAL') ? actions.edit : undefined}
          onDelete={can('DELETE_MATERIAL') ? actions.remove : undefined}
        />
      )}
      renderForm={(form, set, errors) => (
        <>
          <TextField
            label={t('common.title')}
            value={form.title}
            onChangeText={(v) => set('title', v)}
            error={errors.title}
            icon="document-outline"
            required
          />
          <TextField
            label={t('common.description')}
            value={form.description}
            onChangeText={(v) => set('description', v)}
            multiline
          />

          <View style={styles.uploadBlock}>
            <Button
              label={uploading ? t('material.uploading', { percent: progress }) : t('material.upload')}
              icon="cloud-upload-outline"
              variant="outline"
              fullWidth
              loading={uploading}
              onPress={() => pickAndUpload(form, set)}
            />
            {uploading ? (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress}%` }]} />
              </View>
            ) : null}
            <Text style={styles.orText}>{t('material.orPasteLink')}</Text>
          </View>

          <TextField
            label={t('material.typeLink')}
            value={form.url}
            onChangeText={(v) => {
              set('url', v);
              set('storagePath', '');
            }}
            error={errors.url}
            icon="link-outline"
            autoCapitalize="none"
            required
          />
          <Select<MaterialType>
            label={t('material.type')}
            value={form.type}
            options={[
              { value: 'pdf', label: t('material.typePdf') },
              { value: 'audio', label: t('material.typeAudio') },
              { value: 'image', label: t('material.typeImage') },
              { value: 'document', label: t('material.typeDocument') },
              { value: 'link', label: t('material.typeLink') },
            ]}
            onChange={(v) => set('type', v)}
          />
          <Select
            label={t('lesson.assignedClass')}
            value={form.classId}
            options={classOptions}
            onChange={(v) => set('classId', v)}
            placeholder={t('common.all')}
            allowClear
          />
          <Select<ContentStatus>
            label={t('common.status')}
            value={form.status}
            options={[
              { value: 'published', label: t('common.published') },
              { value: 'draft', label: t('common.draft') },
              { value: 'archived', label: t('common.archived') },
            ]}
            onChange={(v) => set('status', v)}
          />
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  uploadBlock: { marginBottom: spacing.lg },
  progressTrack: {
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    marginTop: spacing.sm,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.accent },
  orText: {
    textAlign: 'center',
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
});
