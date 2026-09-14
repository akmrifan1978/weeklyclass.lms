import React, { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { newListId } from '@/utils/branding';
import { listUploadedMedia, type MediaAsset } from '@/services/mediaLibraryService';
import { ImageField } from '@/components/shared/ImageField';
import type { BannerItem } from '@/types';
import { Button, ChipGroup, FormSheet, IconButton, SkeletonList } from '@/components/ui';

/**
 * Choosing what goes in the app banner.
 *
 * Mostly by PICKING, not uploading: every image and video already in the app —
 * recordings, khutbahs, flyers, event banners, lessons — is offered, so the
 * same file is never uploaded twice. A brand-new image can still be uploaded
 * at the bottom for the rare banner that exists nowhere else.
 *
 * The order here is the order the banner shows them in.
 */
export function BannerManager({
  items,
  onChange,
}: {
  items: BannerItem[];
  onChange: (items: BannerItem[]) => void;
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const [library, setLibrary] = useState<MediaAsset[] | null>(null);
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>('all');
  const [uploadValue, setUploadValue] = useState('');

  const openPicker = () => {
    setPicking(true);
    // Fetched when the picker opens, not with the settings screen: most visits
    // to Settings never open it, and this is several collections of reads.
    if (library === null) {
      void listUploadedMedia()
        .then(setLibrary)
        .catch(() => setLibrary([]));
    }
  };

  const chosen = useMemo(() => new Set(items.map((item) => item.url)), [items]);
  const visible = (library ?? []).filter((asset) => filter === 'all' || asset.type === filter);

  const toggle = (asset: MediaAsset) => {
    if (chosen.has(asset.url)) {
      onChange(items.filter((item) => item.url !== asset.url));
      return;
    }
    onChange([
      ...items,
      { id: newListId('banner'), type: asset.type, url: asset.url, title: asset.label || null },
    ]);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <View>
      <Text style={styles.hint}>{t('settings.appBannerHint')}</Text>

      {items.length === 0 ? (
        <Text style={styles.empty}>{t('settings.bannerEmpty')}</Text>
      ) : (
        items.map((item, i) => (
          <View key={item.id} style={styles.row}>
            <Preview url={item.type === 'image' ? item.url : null} type={item.type} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.title || t(item.type === 'video' ? 'settings.bannerVideo' : 'settings.bannerImage')}
              </Text>
              <Text style={styles.rowMeta}>
                {t(item.type === 'video' ? 'settings.bannerVideo' : 'settings.bannerImage')}
              </Text>
            </View>
            <IconButton
              icon="arrow-up"
              label={t('settings.bannerMoveUp')}
              size={32}
              color={i === 0 ? colors.border : colors.textSecondary}
              onPress={() => move(i, i - 1)}
            />
            <IconButton
              icon="arrow-down"
              label={t('settings.bannerMoveDown')}
              size={32}
              color={i === items.length - 1 ? colors.border : colors.textSecondary}
              onPress={() => move(i, i + 1)}
            />
            <IconButton
              icon="trash-outline"
              label={t('settings.bannerRemove')}
              size={32}
              color={colors.danger}
              onPress={() => onChange(items.filter((x) => x.id !== item.id))}
            />
          </View>
        ))
      )}

      <Button
        label={t('settings.bannerAddFromLibrary')}
        icon="albums-outline"
        variant="outline"
        fullWidth
        onPress={openPicker}
        style={{ marginTop: spacing.md }}
      />

      <View style={{ marginTop: spacing.md }}>
        <ImageField
          label={t('settings.bannerUploadNew')}
          value={uploadValue}
          onChange={(url) => {
            if (!url) return;
            onChange([...items, { id: newListId('banner'), type: 'image', url, title: null }]);
            setUploadValue('');
          }}
          aspectRatio={16 / 9}
        />
      </View>

      <FormSheet
        visible={picking}
        title={t('settings.bannerLibraryTitle')}
        onClose={() => setPicking(false)}
        onSubmit={() => setPicking(false)}
      >
        <ChipGroup<'all' | 'image' | 'video'>
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('settings.bannerAll') },
            { value: 'image', label: t('settings.bannerImages') },
            { value: 'video', label: t('settings.bannerVideos') },
          ]}
        />

        {library === null ? (
          <View style={{ marginTop: spacing.md }}>
            <SkeletonList count={3} />
          </View>
        ) : visible.length === 0 ? (
          <Text style={styles.empty}>{t('settings.bannerLibraryEmpty')}</Text>
        ) : (
          <View style={styles.grid}>
            {visible.map((asset) => {
              const on = chosen.has(asset.url);
              return (
                <Pressable
                  key={asset.url}
                  onPress={() => toggle(asset)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={asset.label || asset.url}
                  style={[styles.tile, on && styles.tileOn]}
                >
                  <Preview url={asset.preview} type={asset.type} wide />
                  <Text style={styles.tileLabel} numberOfLines={2}>
                    {asset.label || t(asset.type === 'video' ? 'settings.bannerVideo' : 'settings.bannerImage')}
                  </Text>
                  <Text style={styles.tileSource} numberOfLines={1}>
                    {t(asset.sourceKey)}
                  </Text>
                  {on ? (
                    <View style={styles.addedTag}>
                      <Ionicons name="checkmark" size={12} color={colors.textInverse} />
                      <Text style={styles.addedText}>{t('settings.bannerAdded')}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        )}
      </FormSheet>
    </View>
  );
}

function Preview({
  url,
  type,
  wide = false,
}: {
  url: string | null;
  type: 'image' | 'video';
  wide?: boolean;
}) {
  const style = wide ? styles.previewWide : styles.preview;
  return (
    <View style={style}>
      {url ? (
        <Image source={{ uri: url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : null}
      {type === 'video' ? (
        <View style={styles.play}>
          <Ionicons name="play" size={14} color={colors.textInverse} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: fontSize.xs, color: colors.textMuted, lineHeight: 17, marginBottom: spacing.md },
  empty: { fontSize: fontSize.sm, color: colors.textMuted, marginVertical: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  rowTitle: { fontSize: fontSize.sm, color: colors.text, fontWeight: fontWeight.semibold },
  rowMeta: { fontSize: fontSize.xs, color: colors.textMuted },
  preview: {
    width: 64,
    height: 36,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewWide: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: {
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  tile: {
    flexGrow: 1,
    flexBasis: 150,
    maxWidth: 240,
    padding: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
  },
  tileOn: { borderColor: colors.primary },
  tileLabel: { fontSize: fontSize.xs, color: colors.text, marginTop: spacing.xs },
  tileSource: { fontSize: 10, color: colors.textMuted },
  addedTag: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
  },
  addedText: { fontSize: 10, color: colors.textInverse, fontWeight: fontWeight.bold },
});
