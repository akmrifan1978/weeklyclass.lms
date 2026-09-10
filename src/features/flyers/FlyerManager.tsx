import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { CrudScreen } from '@/features/CrudScreen';
import { AdminRow } from '@/features/AdminRow';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { friendlyMessage } from '@/utils/errors';
import * as flyers from '@/services/flyerService';
import * as storageService from '@/services/storageService';
import { formatShortDate } from '@/utils/date';
import type { Flyer, FlyerPosition } from '@/types';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import {
  Badge,
  Button,
  DateField,
  Select,
  StatusBadge,
  TextField,
  ToggleRow,
} from '@/components/ui';

interface FlyerForm {
  title: string;
  description: string;
  fileUrl: string;
  fileType: 'image' | 'pdf';
  storagePath: string;
  link: string;
  position: FlyerPosition;
  startDate: string;
  endDate: string;
  active: boolean;
  priority: string;
}

const EMPTY: FlyerForm = {
  title: '',
  description: '',
  fileUrl: '',
  fileType: 'image',
  storagePath: '',
  link: '',
  position: 'dashboard',
  startDate: '',
  endDate: '',
  active: true,
  priority: '0',
};

/**
 * Advertising, managed by an admin and by nobody else.
 *
 * Built on the same CrudScreen every other manager uses, so it behaves the way
 * an admin already expects: search, a list, a sheet to edit in, a confirm
 * before deleting.
 *
 * The one thing it adds is a file that may be an image OR a PDF, which is why
 * it picks documents rather than using ImageField.
 */
export function FlyerManager() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const pickFile = async (
    form: FlyerForm,
    set: <K extends keyof FlyerForm>(key: K, value: FlyerForm[K]) => void
  ) => {
    const picked = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      type: ['image/jpeg', 'image/png', 'application/pdf'],
    });
    if (picked.canceled || !picked.assets[0]) return;

    const asset = picked.assets[0];
    const mime = asset.mimeType ?? '';
    const isPdf = mime === 'application/pdf' || /\.pdf$/i.test(asset.name);

    // Checked here as well as in the picker. The `type` filter is a hint on
    // some platforms rather than a rule, and a video dropped into an
    // advertising slot would upload happily and then render as nothing.
    if (!isPdf && !/^image\/(jpeg|png)$/.test(mime) && !/\.(jpe?g|png)$/i.test(asset.name)) {
      toast.error(t('flyer.wrongType'));
      return;
    }

    setUploading(true);
    setProgress(0);
    try {
      const uploaded = await storageService.upload({
        uri: asset.uri,
        fileName: asset.name,
        kind: 'branding',
        ownerId: 'flyers',
        contentType: asset.mimeType ?? undefined,
        onProgress: setProgress,
      });
      set('fileUrl', uploaded.url);
      set('storagePath', uploaded.path);
      set('fileType', isPdf ? 'pdf' : 'image');
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
    <CrudScreen<Flyer, FlyerForm>
      title={t('flyer.title')}
      addLabel={t('flyer.add')}
      emptyIcon="megaphone-outline"
      emptyTitle={t('flyer.none')}
      searchable={false}
      fetchPage={(cursor) => flyers.listFlyers(cursor)}
      emptyForm={EMPTY}
      toForm={(flyer) => ({
        title: flyer.title,
        description: flyer.description ?? '',
        fileUrl: flyer.fileUrl,
        fileType: flyer.fileType,
        storagePath: flyer.storagePath ?? '',
        link: flyer.link ?? '',
        position: flyer.position,
        startDate: flyer.startDate ?? '',
        endDate: flyer.endDate ?? '',
        active: flyer.active,
        priority: String(flyer.priority ?? 0),
      })}
      validate={(form) => {
        const errors: Record<string, string> = {};
        if (form.title.trim().length < 2) errors.title = t('validation.required');
        if (!form.fileUrl) errors.fileUrl = t('flyer.fileRequired');
        // Caught here rather than left to look like a scheduling quirk: a
        // flyer that ends before it starts never shows, and nothing else in
        // the app would ever tell the admin why.
        if (form.startDate && form.endDate && form.endDate < form.startDate) {
          errors.endDate = t('flyer.endBeforeStart');
        }
        return errors;
      }}
      onSave={async (form, editing) => {
        if (!user) throw new Error('not signed in');
        return flyers.saveFlyer(
          {
            title: form.title.trim(),
            description: form.description.trim() || null,
            fileUrl: form.fileUrl,
            fileType: form.fileType,
            storagePath: form.storagePath || null,
            link: form.link.trim() || null,
            position: form.position,
            startDate: form.startDate || null,
            endDate: form.endDate || null,
            active: form.active,
            priority: Number(form.priority) || 0,
          },
          user,
          editing?.id
        );
      }}
      onDelete={async (flyer) => {
        if (!user) return;
        await flyers.deleteFlyer(flyer, user);
      }}
      renderItem={(flyer, actions) => (
        <AdminRow
          icon={flyer.fileType === 'pdf' ? 'document-text-outline' : 'image-outline'}
          iconTint={flyers.isShowing(flyer) ? colors.success : colors.textMuted}
          title={flyer.title}
          subtitle={flyer.description}
          meta={
            flyer.startDate || flyer.endDate
              ? [
                  flyer.startDate ? formatShortDate(flyer.startDate) : t('flyer.fromNow'),
                  flyer.endDate ? formatShortDate(flyer.endDate) : t('flyer.noEnd'),
                ].join('  →  ')
              : null
          }
          badges={[
            {
              label: flyers.isShowing(flyer) ? t('flyer.showing') : t('common.inactive'),
              tone: flyers.isShowing(flyer) ? 'success' : 'muted',
            },
            { label: t(`flyer.position_${flyer.position}`) },
            ...(flyer.priority ? [{ label: `#${flyer.priority}` }] : []),
          ]}
          onEdit={actions.edit}
          onDelete={actions.remove}
          extraActions={
            /* One tap. The common case is a poster coming down the morning
               after the event, and making somebody open a form to tick a box
               is how a flyer ends up still advertising last month. */
            <Button
              label={flyer.active ? t('flyer.hide') : t('flyer.show')}
              icon={flyer.active ? 'eye-off-outline' : 'eye-outline'}
              variant="ghost"
              onPress={() => {
                if (!user) return;
                void flyers
                  .setActive(flyer, !flyer.active, user)
                  .catch((error) => toast.error(friendlyMessage(error, t)));
              }}
            />
          }
        />
      )}
      renderForm={(form, set, errors) => (
        <>
          {/* The file first. Everything else on this form describes it, and
              asking for a title before there is anything to title is the wrong
              way round. */}
          {form.fileUrl ? (
            form.fileType === 'pdf' ? (
              <View style={[styles.preview, styles.previewPdf]}>
                <Ionicons name="document-text" size={28} color={brand.orange} />
                <Text style={styles.previewPdfText}>PDF</Text>
              </View>
            ) : (
              <Image source={{ uri: form.fileUrl }} style={styles.preview} resizeMode="cover" />
            )
          ) : null}

          <Button
            label={form.fileUrl ? t('flyer.replaceFile') : t('flyer.chooseFile')}
            icon="cloud-upload-outline"
            variant="outline"
            fullWidth
            loading={uploading}
            onPress={() => pickFile(form, set)}
          />
          {uploading ? <Text style={styles.progress}>{progress}%</Text> : null}
          {errors.fileUrl ? <Text style={styles.error}>{errors.fileUrl}</Text> : null}
          <Text style={styles.hint}>{t('flyer.fileHint')}</Text>

          <TextField
            label={t('flyer.flyerTitle')}
            value={form.title}
            onChangeText={(v) => set('title', v)}
            error={errors.title}
            icon="text-outline"
          />
          <TextField
            label={t('flyer.description')}
            value={form.description}
            onChangeText={(v) => set('description', v)}
            multiline
            numberOfLines={3}
          />
          <TextField
            label={t('flyer.link')}
            value={form.link}
            onChangeText={(v) => set('link', v)}
            autoCapitalize="none"
            keyboardType="url"
            icon="link-outline"
            hint={t('flyer.linkHint')}
          />

          <Select<FlyerPosition>
            label={t('flyer.position')}
            value={form.position}
            options={[
              { value: 'dashboard', label: t('flyer.position_dashboard') },
              { value: 'home', label: t('flyer.position_home') },
              { value: 'both', label: t('flyer.position_both') },
            ]}
            onChange={(v) => set('position', v)}
          />

          <DateField
            label={t('flyer.startDate')}
            value={form.startDate}
            onChange={(v) => set('startDate', v)}
            hint={t('flyer.startHint')}
          />
          <DateField
            label={t('flyer.endDate')}
            value={form.endDate}
            onChange={(v) => set('endDate', v)}
            error={errors.endDate}
            hint={t('flyer.endHint')}
          />

          <TextField
            label={t('flyer.priority')}
            value={form.priority}
            onChangeText={(v) => set('priority', v.replace(/[^0-9-]/g, ''))}
            keyboardType="numeric"
            icon="swap-vertical-outline"
            hint={t('flyer.priorityHint')}
          />

          <ToggleRow
            label={t('flyer.active')}
            description={t('flyer.activeHint')}
            value={form.active}
            onValueChange={(v) => set('active', v)}
          />
        </>
      )}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  thumb: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  thumbPdf: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentSoft,
  },
  rowTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.text },
  rowMeta: { fontSize: fontSize.xs, color: colors.textMuted },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, alignItems: 'center' },
  rowActions: { flexDirection: 'row', alignItems: 'center' },

  preview: {
    width: '100%',
    height: 150,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    marginBottom: spacing.sm,
  },
  previewPdf: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.accentSoft,
  },
  previewPdfText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: brand.orangeDark },
  progress: { fontSize: fontSize.xs, color: colors.textSecondary, textAlign: 'center' },
  error: { fontSize: fontSize.xs, color: colors.danger },
  hint: { fontSize: fontSize.xs, color: colors.textMuted, marginBottom: spacing.sm },
});
