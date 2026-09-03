import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useLanguageScope } from '@/hooks/useLanguageScope';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import * as zakat from '@/services/zakatService';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import {
  AppHeader,
  Card,
  ChipGroup,
  Screen,
  SectionHeader,
  TextField,
} from '@/components/ui';

/**
 * Zakat al-mal calculator.
 *
 * Everything recalculates as you type — no "calculate" button. The interesting
 * question is usually "am I over the threshold yet", and watching the answer
 * move as figures go in answers it far better than a result that only appears
 * once every field is filled.
 *
 * Nothing is stored or sent anywhere. These are someone's private finances, and
 * the calculation needs no server.
 */
export function ZakatScreen({ headerTint }: { headerTint?: string }) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguageScope('zakat');

  const [basis, setBasis] = useState<zakat.NisabBasis>('silver');
  const [fields, setFields] = useState({
    cash: '',
    goldGrams: '',
    silverGrams: '',
    businessAssets: '',
    receivables: '',
    investments: '',
    liabilities: '',
    goldPricePerGram: '',
    silverPricePerGram: '',
  });

  const set = (key: keyof typeof fields) => (value: string) =>
    // Digits and one decimal point. Currency amounts are typed, not chosen, and
    // a stray letter should simply not land rather than produce NaN downstream.
    setFields((previous) => ({
      ...previous,
      [key]: value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1'),
    }));

  const input = useMemo<zakat.ZakatInput>(
    () => ({
      cash: Number(fields.cash),
      goldGrams: Number(fields.goldGrams),
      silverGrams: Number(fields.silverGrams),
      businessAssets: Number(fields.businessAssets),
      receivables: Number(fields.receivables),
      investments: Number(fields.investments),
      liabilities: Number(fields.liabilities),
      goldPricePerGram: Number(fields.goldPricePerGram),
      silverPricePerGram: Number(fields.silverPricePerGram),
      basis,
    }),
    [fields, basis]
  );

  const result = useMemo(() => zakat.calculateZakat(input), [input]);
  const ready = zakat.hasEnoughToCalculate(input);

  const money = (value: number) =>
    value.toLocaleString(language, { maximumFractionDigits: 2 });

  return (
    <>
      <AppHeader
        title={t('nav.zakat')}
        showBack
        right={<LanguageMenu value={language} onChange={setLanguage} tint={headerTint} />}
      />
      <Screen>
        <Card style={styles.notice}>
          <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
          <Text style={styles.noticeText}>{t('zakat.disclaimer')}</Text>
        </Card>

        <SectionHeader title={t('zakat.metalPrices')} icon="pricetag-outline" />
        <Card>
          <Text style={styles.hint}>{t('zakat.pricesHint')}</Text>
          <TextField
            label={t('zakat.goldPrice')}
            value={fields.goldPricePerGram}
            onChangeText={set('goldPricePerGram')}
            keyboardType="decimal-pad"
            icon="cash-outline"
          />
          <TextField
            label={t('zakat.silverPrice')}
            value={fields.silverPricePerGram}
            onChangeText={set('silverPricePerGram')}
            keyboardType="decimal-pad"
            icon="cash-outline"
          />

          <Text style={styles.label}>{t('zakat.nisabBasis')}</Text>
          <ChipGroup<zakat.NisabBasis>
            options={[
              { value: 'silver', label: t('zakat.basisSilver') },
              { value: 'gold', label: t('zakat.basisGold') },
            ]}
            value={basis}
            onChange={setBasis}
          />
          <Text style={styles.hint}>{t('zakat.basisHint')}</Text>
        </Card>

        <SectionHeader title={t('zakat.assets')} icon="wallet-outline" />
        <Card>
          <TextField
            label={t('zakat.cash')}
            value={fields.cash}
            onChangeText={set('cash')}
            keyboardType="decimal-pad"
            icon="wallet-outline"
          />
          <TextField
            label={t('zakat.goldGrams')}
            value={fields.goldGrams}
            onChangeText={set('goldGrams')}
            keyboardType="decimal-pad"
            hint={result.goldValue > 0 ? money(result.goldValue) : undefined}
          />
          <TextField
            label={t('zakat.silverGrams')}
            value={fields.silverGrams}
            onChangeText={set('silverGrams')}
            keyboardType="decimal-pad"
            hint={result.silverValue > 0 ? money(result.silverValue) : undefined}
          />
          <TextField
            label={t('zakat.businessAssets')}
            value={fields.businessAssets}
            onChangeText={set('businessAssets')}
            keyboardType="decimal-pad"
            icon="storefront-outline"
          />
          <TextField
            label={t('zakat.receivables')}
            value={fields.receivables}
            onChangeText={set('receivables')}
            keyboardType="decimal-pad"
            icon="arrow-down-outline"
          />
          <TextField
            label={t('zakat.investments')}
            value={fields.investments}
            onChangeText={set('investments')}
            keyboardType="decimal-pad"
            icon="trending-up-outline"
          />
        </Card>

        <SectionHeader title={t('zakat.deductions')} icon="remove-circle-outline" />
        <Card>
          <TextField
            label={t('zakat.liabilities')}
            value={fields.liabilities}
            onChangeText={set('liabilities')}
            keyboardType="decimal-pad"
            icon="arrow-up-outline"
            hint={t('zakat.liabilitiesHint')}
          />
        </Card>

        <SectionHeader title={t('zakat.result')} icon="calculator-outline" />
        <Card style={styles.resultCard}>
          {!ready ? (
            <Text style={styles.needPrice}>{t('zakat.needPrice')}</Text>
          ) : (
            <>
              <Row label={t('zakat.totalAssets')} value={money(result.totalAssets)} />
              <Row
                label={t('zakat.netWealth')}
                value={money(result.netWealth)}
                emphasis
              />
              <Row label={t('zakat.nisab')} value={money(result.nisab)} />

              <View style={styles.divider} />

              {result.liable ? (
                <>
                  <Text style={styles.dueLabel}>{t('zakat.zakatDue')}</Text>
                  <Text style={styles.dueValue}>{money(result.zakatDue)}</Text>
                  <Text style={styles.dueNote}>{t('zakat.rateNote')}</Text>
                </>
              ) : (
                <View style={styles.belowRow}>
                  <Ionicons
                    name="information-circle"
                    size={20}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.belowText}>
                    {t('zakat.belowNisab', { amount: money(result.shortfall) })}
                  </Text>
                </View>
              )}
            </>
          )}
        </Card>
      </Screen>
    </>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, emphasis ? styles.rowLabelEmphasis : null]}>
        {label}
      </Text>
      <Text style={[styles.rowValue, emphasis ? styles.rowValueEmphasis : null]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  noticeText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17 },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  hint: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
  resultCard: { marginBottom: spacing.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    gap: spacing.md,
  },
  rowLabel: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary },
  rowLabelEmphasis: { color: colors.text, fontWeight: fontWeight.semibold },
  rowValue: { fontSize: fontSize.sm, color: colors.text, fontVariant: ['tabular-nums'] },
  rowValueEmphasis: { fontWeight: fontWeight.bold },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginVertical: spacing.md,
  },
  dueLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    textAlign: 'center',
  },
  dueValue: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: brand.orange,
    textAlign: 'center',
    marginTop: spacing.xs,
    fontVariant: ['tabular-nums'],
  },
  dueNote: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  belowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  belowText: { flex: 1, fontSize: fontSize.sm, color: colors.textSecondary, lineHeight: 20 },
  needPrice: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
    paddingVertical: spacing.md,
    lineHeight: 20,
  },
  radius: { borderRadius: radius.md },
});
