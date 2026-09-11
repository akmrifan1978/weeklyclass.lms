import React from 'react';
import { Linking, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/contexts/ToastContext';
import { friendlyMessage } from '@/utils/errors';
import { colors, spacing } from '@/constants/theme';
import { IconButton } from '@/components/ui';
import type { ContentStatus } from '@/types';

/**
 * Preview and publish, on the row rather than inside the form.
 *
 * Publishing was already possible — every editor has a status field — but it
 * meant opening a sheet, changing a dropdown and saving, to do the one thing
 * an author does most. Something written on Tuesday and published on Thursday
 * is two visits to the same form, and the second one risks changing more than
 * was intended.
 *
 * Preview opens the actual file. An author about to publish a PDF to a class
 * should be able to see the PDF, and "does the upload work" is not a question
 * the list view could otherwise answer.
 *
 * Shared by lessons, materials, videos and articles because the question is
 * the same in all four, and four copies of it would drift.
 */
export function PublishActions({
  status,
  previewUrl,
  onSetStatus,
  canEdit = true,
  extra,
}: {
  status?: ContentStatus;
  /** The file or link to open. Absent means there is nothing to preview. */
  previewUrl?: string | null;
  onSetStatus: (next: ContentStatus) => Promise<void>;
  canEdit?: boolean;
  /** Anything the caller already had in this slot. */
  extra?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const toast = useToast();

  const published = status === 'published';

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      {extra}

      {previewUrl ? (
        <IconButton
          icon="eye-outline"
          label={t('common.preview')}
          size={36}
          color={colors.info}
          background={colors.infoSoft}
          onPress={() => Linking.openURL(previewUrl).catch(() => undefined)}
        />
      ) : null}

      {canEdit ? (
        <IconButton
          icon={published ? 'cloud-offline-outline' : 'cloud-upload-outline'}
          label={t(published ? 'common.unpublish' : 'common.publish')}
          size={36}
          color={published ? colors.textSecondary : colors.success}
          background={published ? colors.surfaceMuted : colors.successSoft}
          onPress={() => {
            void onSetStatus(published ? 'draft' : 'published')
              .then(() => toast.success(t(published ? 'common.unpublishedToast' : 'common.publishedToast')))
              .catch((error) => toast.error(friendlyMessage(error, t)));
          }}
        />
      ) : null}
    </View>
  );
}
