import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';

import { colors, fontSize, fontWeight, radius, spacing, TOUCH_TARGET } from '@/constants/theme';
import { formatShortDate, formatTime, toISODate } from '@/utils/date';

/**
 * Date and time inputs.
 *
 * Web gets native `<input type="date">` / `<input type="time">` (keyboard
 * accessible, localised by the browser); native platforms get the OS picker.
 * Both store the same string format — `YYYY-MM-DD` and `HH:mm` — so callers
 * never deal with platform differences.
 */

function useWebInputProps(type: 'date' | 'time') {
  // `type` is a DOM attribute react-native-web forwards to the underlying input.
  return Platform.OS === 'web' ? ({ type } as unknown as object) : {};
}

export function DateField({
  label,
  value,
  onChange,
  error,
  required,
  minimumDate,
  hint,
  containerStyle,
}: {
  label?: string;
  /** ISO `YYYY-MM-DD`, or empty. */
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  required?: boolean;
  minimumDate?: Date;
  hint?: string;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  const webProps = useWebInputProps('date');

  const handleChange = (_event: DateTimePickerEvent, selected?: Date) => {
    setOpen(Platform.OS === 'ios');
    if (selected) onChange(toISODate(selected));
  };

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
      ) : null}

      {Platform.OS === 'web' ? (
        <View style={[styles.field, error ? styles.fieldError : null]}>
          <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={label}
            style={styles.input}
            {...webProps}
          />
        </View>
      ) : (
        <>
          <Pressable
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityValue={{ text: value || 'Not set' }}
            style={({ pressed }) => [
              styles.field,
              error ? styles.fieldError : null,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="calendar-outline" size={18} color={colors.textMuted} />
            <Text style={[styles.value, !value ? styles.placeholder : null]}>
              {value ? formatShortDate(value) : 'YYYY-MM-DD'}
            </Text>
          </Pressable>
          {open ? (
            <DateTimePicker
              value={value ? new Date(`${value}T00:00:00`) : new Date()}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              minimumDate={minimumDate}
              onChange={handleChange}
            />
          ) : null}
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function TimeField({
  label,
  value,
  onChange,
  error,
  required,
  containerStyle,
}: {
  label?: string;
  /** `HH:mm` 24-hour, or empty. */
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  required?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  const webProps = useWebInputProps('time');

  const handleChange = (_event: DateTimePickerEvent, selected?: Date) => {
    setOpen(Platform.OS === 'ios');
    if (selected) {
      const hh = String(selected.getHours()).padStart(2, '0');
      const mm = String(selected.getMinutes()).padStart(2, '0');
      onChange(`${hh}:${mm}`);
    }
  };

  const asDate = () => {
    const date = new Date();
    const [hh, mm] = value.split(':').map(Number);
    date.setHours(hh ?? 9, mm ?? 0, 0, 0);
    return date;
  };

  return (
    <View style={[styles.container, containerStyle]}>
      {label ? (
        <Text style={styles.label}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
      ) : null}

      {Platform.OS === 'web' ? (
        <View style={[styles.field, error ? styles.fieldError : null]}>
          <Ionicons name="time-outline" size={18} color={colors.textMuted} />
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder="HH:MM"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel={label}
            style={styles.input}
            {...webProps}
          />
        </View>
      ) : (
        <>
          <Pressable
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityValue={{ text: value || 'Not set' }}
            style={({ pressed }) => [
              styles.field,
              error ? styles.fieldError : null,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="time-outline" size={18} color={colors.textMuted} />
            <Text style={[styles.value, !value ? styles.placeholder : null]}>
              {value ? formatTime(value) : 'HH:MM'}
            </Text>
          </Pressable>
          {open ? (
            <DateTimePicker
              value={asDate()}
              mode="time"
              is24Hour
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleChange}
            />
          ) : null}
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // No `flex` here on purpose: these fields normally stack in a form, and a
  // flexing container overlaps the next label. Callers that place a date and a
  // time side by side pass containerStyle={{ flex: 1 }}.
  container: { marginBottom: spacing.lg },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  required: { color: colors.danger },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: TOUCH_TARGET + 4,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  fieldError: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  input: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.text,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  value: { flex: 1, fontSize: fontSize.md, color: colors.text },
  placeholder: { color: colors.textMuted },
  error: { fontSize: fontSize.xs, color: colors.danger, marginTop: spacing.xs },
  hint: { fontSize: fontSize.xs, color: colors.textMuted, marginTop: spacing.xs },
});
