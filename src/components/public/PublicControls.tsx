import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
  brand,
  colors,
  fontSize,
  fontWeight,
  radius,
  shadow,
  spacing,
  TOUCH_TARGET,
} from '@/constants/theme';
import { tone } from './tone';

/**
 * The handful of pieces the public pages are assembled from.
 *
 * Kept together because they only mean anything next to each other: a search
 * box above a row of filters above a list of cards is one pattern repeated on
 * five pages, and five private copies of it would drift apart within a month.
 */

/** White rounded field with a magnifier, sitting above the filters. */
export function SearchBar({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={16} color={tone.muted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={tone.muted}
        style={styles.searchInput}
        accessibilityLabel={placeholder}
        autoCorrect={false}
        returnKeyType="search"
      />
      {value ? (
        <Pressable
          onPress={() => onChange('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Clear"
        >
          <Ionicons name="close-circle" size={16} color={tone.muted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The filter row.
 *
 * Scrolls sideways rather than wrapping: the categories are open-ended — they
 * come from whatever an admin has actually published — and a wrapping row of
 * them pushed the first card off a phone screen entirely.
 */
export function ChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            style={({ pressed }) => [
              styles.chip,
              active && styles.chipActive,
              { opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** A plain white panel. Everything below a hero is one of these. */
export function PublicCard({
  children,
  onPress,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  if (!onPress) return <View style={styles.card}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.9 : 1 }]}
    >
      {children}
    </Pressable>
  );
}

/** The small category label at the top of a card. */
export function Tag({ label, tone = 'accent' }: { label: string; tone?: 'accent' | 'muted' }) {
  return (
    <View style={[styles.tag, tone === 'muted' ? styles.tagMuted : styles.tagAccent]}>
      <Text
        style={[styles.tagText, tone === 'muted' ? styles.tagTextMuted : styles.tagTextAccent]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );
}

/** One fact on a card: an icon and a line of text. */
export function Fact({
  icon,
  text,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  tint?: string;
}) {
  return (
    <View style={styles.fact}>
      <Ionicons name={icon} size={13} color={tint ?? tone.muted} />
      <Text style={styles.factText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

/** The outlined full-width button at the foot of a card. */
export function CardAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.cardAction, { opacity: pressed ? 0.7 : 1 }]}
    >
      <Text style={styles.cardActionText}>{label}</Text>
    </Pressable>
  );
}

/** Spinner, message or nothing — the three states a list is ever in. */
export function ListState({
  loading,
  empty,
  icon = 'cloud-outline',
  title,
  message,
}: {
  loading: boolean;
  empty: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  message?: string;
}) {
  if (loading) {
    return (
      <View style={styles.state}>
        <ActivityIndicator color={brand.orange} />
      </View>
    );
  }
  if (!empty) return null;
  return (
    <View style={styles.state}>
      <Ionicons name={icon} size={28} color={tone.muted} />
      <Text style={styles.stateTitle}>{title}</Text>
      {message ? <Text style={styles.stateText}>{message}</Text> : null}
    </View>
  );
}

/**
 * The panel that says a page goes no further without an account.
 *
 * Used where the public copy of something is deliberately only its headline —
 * a lesson's title without its notes, a class without its register. It offers
 * the way in rather than pretending the rest is missing.
 */
export function SignInPrompt({ message }: { message: string }) {
  const { t } = useTranslation();
  const router = useRouter();

  return (
    <View style={styles.prompt}>
      <Ionicons name="lock-closed-outline" size={18} color={brand.orange} />
      <Text style={styles.promptText}>{message}</Text>
      <View style={styles.promptButtons}>
        <Pressable
          onPress={() => router.push('/(auth)/login')}
          accessibilityRole="button"
          accessibilityLabel={t('auth.login')}
          style={({ pressed }) => [styles.promptPrimary, { opacity: pressed ? 0.85 : 1 }]}
        >
          <Text style={styles.promptPrimaryText}>{t('auth.login')}</Text>
        </Pressable>
        <Pressable
          onPress={() => router.push('/(auth)/register')}
          accessibilityRole="button"
          accessibilityLabel={t('auth.register')}
          style={({ pressed }) => [styles.promptSecondary, { opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={styles.promptSecondaryText}>{t('auth.register')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: tone.control,
    borderWidth: 1,
    borderColor: tone.controlLine,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: TOUCH_TARGET,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.sm,
    color: tone.title,
    paddingVertical: spacing.sm,
    // Web draws its own focus ring on top of the border, which reads as a
    // second outline around the field.
    outlineStyle: 'none' as never,
  },

  chips: { gap: spacing.sm, paddingVertical: 2 },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: tone.controlLine,
    backgroundColor: tone.control,
    minHeight: 32,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: brand.orange, borderColor: brand.orange },
  chipText: { fontSize: fontSize.xs, color: tone.body, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.textInverse, fontWeight: fontWeight.bold },

  card: {
    backgroundColor: tone.panel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: tone.panelLine,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadow.sm,
  },

  tag: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.sm,
  },
  tagAccent: { backgroundColor: tone.accentPanel },
  tagMuted: { backgroundColor: tone.pressed },
  tagText: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 0.6 },
  tagTextAccent: { color: brand.orangeLight },
  tagTextMuted: { color: tone.body },

  fact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  factText: { flex: 1, fontSize: fontSize.xs, color: tone.body },

  cardAction: {
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: tone.controlLineStrong,
    borderRadius: radius.md,
    minHeight: TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardActionText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: tone.body,
  },

  state: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xxxl },
  stateTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold, color: tone.title },
  stateText: {
    fontSize: fontSize.sm,
    color: tone.body,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 19,
  },

  prompt: {
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: tone.accentPanel,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: tone.accentLine,
    padding: spacing.lg,
  },
  promptText: {
    fontSize: fontSize.sm,
    color: tone.body,
    textAlign: 'center',
    lineHeight: 19,
  },
  promptButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  promptPrimary: {
    paddingHorizontal: spacing.xl,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: brand.orange,
  },
  promptPrimaryText: {
    color: colors.textOnAccent,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  promptSecondary: {
    paddingHorizontal: spacing.xl,
    paddingVertical: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: tone.controlLineStrong,
    backgroundColor: tone.control,
  },
  promptSecondaryText: {
    color: tone.body,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
});
