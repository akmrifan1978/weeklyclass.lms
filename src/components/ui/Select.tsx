import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import {
  colors,
  fontSize,
  fontWeight,
  radius,
  shadow,
  spacing,
  TOUCH_TARGET,
} from '@/constants/theme';
import { SearchField } from './Input';

export interface Option<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  icon?: keyof typeof Ionicons.glyphMap;
}

interface SelectProps<T extends string> {
  label?: string;
  value: T | null | undefined;
  options: Option<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  error?: string | null;
  required?: boolean;
  disabled?: boolean;
  /** Shows a search box when the list is long. */
  searchable?: boolean;
  allowClear?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Dropdown built on a modal sheet rather than a native picker so it looks and
 * behaves the same on Android, iOS and web, and stays keyboard-navigable.
 */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  placeholder,
  error,
  required,
  disabled,
  searchable,
  allowClear,
  containerStyle,
}: SelectProps<T>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');

  const selected = options.find((option) => option.value === value) ?? null;
  const showSearch = searchable ?? options.length > 8;

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    if (!needle) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        option.description?.toLowerCase().includes(needle)
    );
  }, [options, term]);

  const errorText = error?.includes('.') ? t(error) : error;

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
      ) : null}

      {/*
        Trigger and clear are SIBLINGS, not nested. Putting the clear control
        inside the trigger would render a button inside a button — invalid HTML,
        and a tap on the "x" would bubble up and reopen the dropdown it just
        cleared. The row wrapper keeps them looking like one field.
      */}
      <View style={[styles.triggerRow, errorText ? styles.triggerError : null]}>
        <Pressable
          onPress={() => !disabled && setOpen(true)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={label ?? placeholder ?? t('common.select')}
          accessibilityValue={{ text: selected?.label ?? t('common.none') }}
          accessibilityState={{ disabled, expanded: open }}
          style={({ pressed }) => [
            styles.trigger,
            { opacity: disabled ? 0.55 : pressed ? 0.85 : 1 },
          ]}
        >
          {selected?.icon ? (
            <Ionicons
              name={selected.icon}
              size={18}
              color={colors.primary}
              style={styles.leadIcon}
            />
          ) : null}
          <Text
            numberOfLines={1}
            style={[styles.triggerText, !selected ? styles.placeholder : null]}
          >
            {selected?.label ?? placeholder ?? t('common.select')}
          </Text>
          {allowClear && selected ? null : (
            <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
          )}
        </Pressable>

        {allowClear && selected ? (
          <Pressable
            hitSlop={8}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${t('common.clear')} ${label ?? ''}`.trim()}
            onPress={() => onChange('' as T)}
            style={styles.clearButton}
          >
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>

      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}

      <Modal
        visible={open}
        transparent
        animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
        onRequestClose={() => setOpen(false)}
      >
        {/*
          Tapping the backdrop dismisses the sheet, but it is deliberately NOT
          announced as a button: it wraps the sheet's own Close button, and a
          button inside a button is invalid HTML (React flags it as a hydration
          error on web). Assistive tech uses the explicit Close control below;
          the backdrop stays a pointer-only convenience.
        */}
        <Pressable
          style={styles.backdrop}
          onPress={() => setOpen(false)}
          accessible={false}
        >
          <Pressable
            style={styles.sheet}
            accessible={false}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle} accessibilityRole="header">
                {label ?? t('common.select')}
              </Text>
              <Pressable
                onPress={() => setOpen(false)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('common.close')}
              >
                <Ionicons name="close" size={22} color={colors.textSecondary} />
              </Pressable>
            </View>

            {showSearch ? (
              <SearchField value={term} onChangeText={setTerm} style={styles.search} />
            ) : null}

            <FlatList
              data={visible}
              keyExtractor={(item, index) => item.value || `option-${index}`}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={styles.empty}>{t('common.noResults')}</Text>
              }
              renderItem={({ item }) => {
                const isSelected = item.value === value;
                return (
                  <Pressable
                    onPress={() => {
                      // Guard against a malformed option (e.g. a hand-created
                      // Firestore row with no `code`). Passing undefined up
                      // would set the form field to undefined, and the caller's
                      // schema would then surface a raw validator message
                      // instead of a translated one.
                      onChange((item.value ?? '') as T);
                      setTerm('');
                      setOpen(false);
                    }}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: isSelected }}
                    style={({ pressed }) => [
                      styles.option,
                      isSelected ? styles.optionSelected : null,
                      pressed ? { opacity: 0.8 } : null,
                    ]}
                  >
                    {item.icon ? (
                      <Ionicons
                        name={item.icon}
                        size={18}
                        color={isSelected ? colors.accent : colors.textMuted}
                        style={styles.leadIcon}
                      />
                    ) : null}
                    <View style={styles.optionText}>
                      <Text
                        style={[styles.optionLabel, isSelected ? styles.optionLabelSelected : null]}
                      >
                        {item.label}
                      </Text>
                      {item.description ? (
                        <Text style={styles.optionDescription}>{item.description}</Text>
                      ) : null}
                    </View>
                    {isSelected ? (
                      <Ionicons name="checkmark-circle" size={20} color={colors.accent} />
                    ) : null}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/** Horizontal filter chips — the compact alternative to a dropdown. */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: Option<T>[];
  value: T | null;
  onChange: (value: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Without this the row grows to fill whatever height is going, and the
      // chips stretch with it - which is what it did on the admin
      // notifications page, where it sits above a full-height screen.
      style={styles.chipScroll}
      contentContainerStyle={[styles.chipRow, style]}
    >
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
              active ? styles.chipActive : null,
              pressed ? { opacity: 0.8 } : null,
            ]}
          >
            <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
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
  required: { color: colors.danger },
  triggerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET + 4,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingRight: spacing.sm,
  },
  trigger: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.md,
  },
  clearButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerError: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  triggerText: { flex: 1, fontSize: fontSize.md, color: colors.text },
  placeholder: { color: colors.textMuted },
  leadIcon: { marginRight: 2 },
  error: { fontSize: fontSize.xs, color: colors.danger, marginTop: spacing.xs },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingBottom: spacing.xxl,
    maxHeight: '75%',
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    ...shadow.lg,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    alignSelf: 'center',
    marginTop: spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  sheetTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.text },
  search: { marginHorizontal: spacing.lg, marginBottom: spacing.md },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: TOUCH_TARGET,
  },
  optionSelected: { backgroundColor: colors.accentSoft },
  optionText: { flex: 1 },
  optionLabel: { fontSize: fontSize.md, color: colors.text },
  optionLabelSelected: { fontWeight: fontWeight.semibold, color: colors.accentDark },
  optionDescription: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.textMuted, padding: spacing.xl },
  chipScroll: { flexGrow: 0, flexShrink: 0 },
  chipRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.transparent,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  chipText: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.accentDark, fontWeight: fontWeight.semibold },
});
