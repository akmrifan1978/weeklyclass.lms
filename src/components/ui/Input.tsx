import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import {
  colors,
  fontSize,
  fontWeight,
  radius,
  spacing,
  TOUCH_TARGET,
} from '@/constants/theme';

interface FieldProps extends Omit<TextInputProps, 'style' | 'onChangeText' | 'value'> {
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  /** i18n key or literal message. Rendered in red under the field. */
  error?: string | null;
  hint?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  required?: boolean;
  multiline?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}

/** Translates a value that may be an i18n key (`namespace.key`) or plain text. */
function useMessage() {
  const { t } = useTranslation();
  return (message?: string | null) => {
    if (!message) return null;
    // Supports "errors.fileTooLarge|3 MB" for interpolated messages.
    const [key, argument] = message.split('|');
    if (!key?.includes('.')) return message;
    return t(key, argument ? { size: argument } : undefined);
  };
}

export function TextField({
  label,
  value,
  onChangeText,
  error,
  hint,
  icon,
  required,
  multiline,
  containerStyle,
  ...rest
}: FieldProps) {
  const [focused, setFocused] = useState(false);
  const message = useMessage();
  const errorText = message(error);

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
      ) : null}

      <View
        style={[
          styles.inputWrap,
          multiline ? styles.inputWrapMultiline : null,
          focused ? styles.inputWrapFocused : null,
          errorText ? styles.inputWrapError : null,
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={18}
            color={errorText ? colors.danger : focused ? colors.accent : colors.textMuted}
            style={styles.icon}
          />
        ) : null}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          multiline={multiline}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={label}
          accessibilityHint={hint}
          style={[styles.input, multiline ? styles.inputMultiline : null]}
          {...rest}
        />
      </View>

      {errorText ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {errorText}
        </Text>
      ) : hint ? (
        <Text style={styles.hint}>{hint}</Text>
      ) : null}
    </View>
  );
}

export function PasswordField(props: FieldProps) {
  const [visible, setVisible] = useState(false);
  const { t } = useTranslation();

  return (
    <View>
      <TextField
        {...props}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="password"
      />
      <Pressable
        onPress={() => setVisible((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={t(visible ? 'auth.hidePassword' : 'auth.showPassword')}
        hitSlop={10}
        style={[styles.reveal, props.label ? styles.revealWithLabel : null]}
      >
        <Ionicons
          name={visible ? 'eye-off-outline' : 'eye-outline'}
          size={19}
          color={colors.textMuted}
        />
      </Pressable>
    </View>
  );
}

export function EmailField(props: FieldProps) {
  return (
    <TextField
      icon="mail-outline"
      keyboardType={'email-address' as KeyboardTypeOptions}
      autoCapitalize="none"
      autoCorrect={false}
      textContentType="emailAddress"
      {...props}
    />
  );
}

/** Search box with a clear affordance. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  style,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  return (
    <View style={[styles.search, style]}>
      <Ionicons name="search-outline" size={18} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? t('common.search')}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={placeholder ?? t('common.search')}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.searchInput}
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('common.clear')}
        >
          <Ionicons name="close-circle" size={18} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** On/off row used throughout settings and the permission editor. */
export function ToggleRow({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      style={({ pressed }) => [styles.toggleRow, { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 }]}
    >
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {description ? <Text style={styles.toggleDescription}>{description}</Text> : null}
      </View>
      <View style={[styles.track, value ? styles.trackOn : null]}>
        <View style={[styles.thumb, value ? styles.thumbOn : null]} />
      </View>
    </Pressable>
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
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: TOUCH_TARGET + 4,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  inputWrapMultiline: { alignItems: 'flex-start', paddingVertical: spacing.md, minHeight: 110 },
  inputWrapFocused: { borderColor: colors.accent, backgroundColor: colors.backgroundAlt },
  inputWrapError: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  icon: { marginRight: spacing.sm },
  input: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.text,
    paddingVertical: Platform.OS === 'ios' ? spacing.md : spacing.sm,
    // Removes the focus ring the browser adds on web; the border shows focus.
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  inputMultiline: { textAlignVertical: 'top', minHeight: 84 },
  error: { fontSize: fontSize.xs, color: colors.danger, marginTop: spacing.xs },
  hint: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
  reveal: { position: 'absolute', right: spacing.md, top: 0, bottom: 0, justifyContent: 'center' },
  revealWithLabel: { top: 26, bottom: 22 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: TOUCH_TARGET,
  },
  searchInput: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.text,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    gap: spacing.lg,
    minHeight: TOUCH_TARGET,
  },
  toggleText: { flex: 1 },
  toggleLabel: { fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.medium },
  toggleDescription: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: 2 },
  track: {
    width: 46,
    height: 27,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
    padding: 3,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: colors.accent },
  thumb: {
    width: 21,
    height: 21,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  thumbOn: { alignSelf: 'flex-end' },
});
