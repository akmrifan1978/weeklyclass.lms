import React, { useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import { DIAL_COUNTRIES, cleanDial, countryForDial, splitInternational } from '@/utils/phone';
import { TextField } from './Input';

/**
 * A mobile number with its country code chosen beside it: [🇸🇦 +966 ▾][0567560387].
 *
 * The number is kept exactly as typed, leading zero included. Pasting or typing
 * a whole international number ("+966 56…", "00966 56…") moves the code into the
 * picker and leaves the rest in the box, so there is one right way to end up
 * with the number, whichever way somebody enters it.
 *
 * The country list opens inline under the field rather than in a pop-up: this
 * field lives inside sheets that are already pop-ups, and a pop-up on a pop-up
 * is exactly what goes wrong on phones.
 */

type TextFieldProps = React.ComponentProps<typeof TextField>;

export interface PhoneFieldProps
  extends Omit<TextFieldProps, 'leading' | 'icon' | 'keyboardType' | 'onChangeText'> {
  dial: string;
  onDialChange: (dial: string) => void;
  onChangeText: (value: string) => void;
}

/**
 * The code chip and its country list, apart from any particular input.
 *
 * Separate because the sign-in and recovery boxes take a username, an email OR
 * a phone number in one field. They show the chip only once what is typed is a
 * number — and showing or hiding it must not rebuild the input, or the cursor
 * would jump out of the box mid-word.
 */
export function useDialPicker({
  dial,
  onDialChange,
  editable = true,
}: {
  dial: string;
  onDialChange: (dial: string) => void;
  editable?: boolean;
}): { chip: React.ReactElement; panel: React.ReactElement | null } {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const current = countryForDial(dial);
  const shownDial = cleanDial(dial);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return DIAL_COUNTRIES;
    const digits = needle.replace(/[^0-9]/g, '');
    return DIAL_COUNTRIES.filter(
      (country) =>
        country.name.toLowerCase().includes(needle) ||
        country.iso.toLowerCase() === needle ||
        (digits.length > 0 && country.dial.replace('+', '').startsWith(digits))
    );
  }, [query]);

  const chip = (
    <Pressable
      onPress={() => editable && setOpen((was) => !was)}
      accessibilityRole="button"
      accessibilityLabel={`${t('phone.chooseCode')}: ${shownDial}`}
      accessibilityState={{ expanded: open, disabled: !editable }}
      hitSlop={6}
      style={styles.chip}
    >
      <Text style={styles.flag}>{current?.flag ?? '🌐'}</Text>
      <Text style={styles.dial}>{shownDial}</Text>
      {editable ? (
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
      ) : null}
    </Pressable>
  );

  const panel = open ? (
    <View style={styles.panel}>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={t('phone.searchCountry')}
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel={t('phone.searchCountry')}
        style={styles.search}
      />
      <ScrollView style={styles.options} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {matches.length === 0 ? (
          <Text style={styles.none}>{t('phone.noMatch')}</Text>
        ) : (
          matches.map((country) => {
            const on = country.dial === shownDial;
            return (
              <Pressable
                key={country.iso}
                onPress={() => {
                  onDialChange(country.dial);
                  setOpen(false);
                  setQuery('');
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${country.name} ${country.dial}`}
                style={({ pressed }) => [styles.option, on && styles.optionOn, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.flag}>{country.flag}</Text>
                <Text style={styles.optionName} numberOfLines={1}>
                  {country.name}
                </Text>
                <Text style={styles.optionDial}>{country.dial}</Text>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  ) : null;

  return { chip, panel };
}

/**
 * Text typed into a phone box: a pasted international number moves its code to
 * the picker; otherwise digits and the usual punctuation, with a plus only at
 * the start — which is how a code typed into the box gets recognised.
 */
export function acceptPhoneText(
  text: string,
  onDialChange: (dial: string) => void,
  onChangeText: (value: string) => void
): void {
  const intl = splitInternational(text);
  if (intl) {
    onDialChange(intl.dial);
    onChangeText(intl.national);
    return;
  }
  onChangeText(text.replace(/[^0-9+\s()-]/g, '').replace(/(?!^)\+/g, ''));
}

export function PhoneField({
  dial,
  onDialChange,
  onChangeText,
  containerStyle,
  editable = true,
  ...rest
}: PhoneFieldProps) {
  const { chip, panel } = useDialPicker({ dial, onDialChange, editable });

  return (
    <View style={[styles.container, containerStyle]}>
      <TextField
        {...rest}
        editable={editable}
        leading={chip}
        keyboardType="phone-pad"
        onChangeText={(text) => acceptPhoneText(text, onDialChange, onChangeText)}
        containerStyle={styles.fieldTight}
      />
      {panel}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.lg },
  fieldTight: { marginBottom: 0 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: spacing.sm,
    marginRight: spacing.sm,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    minHeight: 32,
  },
  flag: { fontSize: fontSize.md },
  dial: { fontSize: fontSize.md, color: colors.text, fontWeight: fontWeight.semibold },
  panel: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  search: {
    fontSize: fontSize.md,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' as never } : {}),
  },
  options: { maxHeight: 240 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  optionOn: { backgroundColor: colors.surfaceMuted },
  optionName: { flex: 1, fontSize: fontSize.md, color: colors.text },
  optionDial: { fontSize: fontSize.sm, color: colors.textSecondary, fontWeight: fontWeight.semibold },
  none: { padding: spacing.md, color: colors.textMuted, fontSize: fontSize.sm },
});
