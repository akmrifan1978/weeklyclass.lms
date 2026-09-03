import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useLanguageScope } from '@/hooks/useLanguageScope';
import { brand, colors, fontSize, fontWeight, radius, spacing } from '@/constants/theme';
import * as zakat from '@/services/zakatService';
import * as rateService from '@/services/rateService';
import { useAsync } from '@/hooks/useAsync';
import { LanguageMenu } from '@/components/shared/LanguageMenu';
import {
  AppHeader,
  Button,
  Card,
  ChipGroup,
  Screen,
  SectionHeader,
  Select,
  TextField,
  type Option,
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
/** Used until the rate feed answers and tells us what is available. */
const CURRENCY_FALLBACK = 'USD';

/**
 * Formats a fetched price for a text field.
 *
 * Two decimals for a per-gram figure in most currencies, but none at all where
 * the number runs into the thousands — LKR gold is around 47,000 a gram, and
 * ".07" on the end of that is noise, not precision.
 */
function formatPrice(value: number): string {
  if (!value) return '';
  return value >= 1000 ? String(Math.round(value)) : value.toFixed(2);
}

export function ZakatScreen({ headerTint }: { headerTint?: string }) {
  const { t } = useTranslation();
  const { language, setLanguage } = useLanguageScope('zakat');

  const [basis, setBasis] = useState<zakat.NisabBasis>('silver');
  const [currency, setCurrency] = useState(CURRENCY_FALLBACK);
  // Set when the person edits a price themselves. A fetched rate then stops
  // overwriting it — see the effect below.
  const [priceEdited, setPriceEdited] = useState(false);
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

  const loadRates = useCallback(() => rateService.getRates(), []);
  const { data: rates, loading: loadingRates, error: rateError, reload: refreshRates } =
    useAsync(loadRates, [loadRates]);

  /**
   * Pre-fills the two price fields from the live quote.
   *
   * Only until the person types a price of their own. A fetched spot price is a
   * starting point, not the answer — what a jeweller actually pays differs — and
   * silently overwriting a figure someone entered deliberately, every time the
   * currency changed, would be the worst behaviour available.
   */
  useEffect(() => {
    if (!rates || priceEdited) return;
    setFields((previous) => ({
      ...previous,
      goldPricePerGram: formatPrice(
        rateService.perGram(rates.goldUsdPerOunce, currency, rates.fx)
      ),
      silverPricePerGram: formatPrice(
        rateService.perGram(rates.silverUsdPerOunce, currency, rates.fx)
      ),
    }));
  }, [rates, currency, priceEdited]);

  const currencyChoices = useMemo<Option[]>(
    () =>
      (rates ? rateService.currencyOptions(rates.fx) : [CURRENCY_FALLBACK]).map(
        (code) => ({ value: code, label: code })
      ),
    [rates]
  );

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

        <SectionHeader title={t('zakat.currency')} icon="globe-outline" />
        <Card>
          <Select
            label={t('zakat.currency')}
            value={currency}
            options={currencyChoices}
            onChange={setCurrency}
            searchable
            required
          />
          <Text style={styles.hint}>{t('zakat.currencyHint')}</Text>
        </Card>

        <SectionHeader
          title={t('zakat.metalPrices')}
          icon="pricetag-outline"
          actionLabel={t('common.refresh')}
          onAction={refreshRates}
        />
        <Card>
          {/*
            The source and the timestamp are shown, not hidden. A fetched spot
            price is not what a jeweller pays, and someone deciding whether they
            owe zakat needs to know which number they are looking at and how old
            it is before they trust it.
          */}
          {loadingRates ? (
            <Text style={styles.hint}>{t('zakat.fetchingRates')}</Text>
          ) : rateError ? (
            <Text style={styles.rateWarning}>{t('zakat.ratesUnavailable')}</Text>
          ) : rates ? (
            <View style={styles.rateRow}>
              <Ionicons
                name={rates.cached ? 'cloud-offline-outline' : 'trending-up-outline'}
                size={15}
                color={rates.cached ? colors.textMuted : colors.success}
              />
              <Text style={styles.rateText}>
                {t(rates.cached ? 'zakat.ratesCached' : 'zakat.ratesLive', {
                  date: new Date(rates.fetchedAt).toLocaleString(language),
                })}
              </Text>
            </View>
          ) : null}

          <Text style={styles.hint}>{t('zakat.pricesHint')}</Text>
          <TextField
            label={t('zakat.goldPrice', { currency })}
            value={fields.goldPricePerGram}
            onChangeText={(v) => {
              setPriceEdited(true);
              set('goldPricePerGram')(v);
            }}
            keyboardType="decimal-pad"
            icon="cash-outline"
          />
          <TextField
            label={t('zakat.silverPrice', { currency })}
            value={fields.silverPricePerGram}
            onChangeText={(v) => {
              setPriceEdited(true);
              set('silverPricePerGram')(v);
            }}
            keyboardType="decimal-pad"
            icon="cash-outline"
          />

          {priceEdited && rates ? (
            <Button
              label={t('zakat.useLiveRate')}
              icon="refresh"
              variant="ghost"
              size="sm"
              onPress={() => setPriceEdited(false)}
              style={{ marginBottom: spacing.md }}
            />
          ) : null}

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
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  rateText: { flex: 1, fontSize: fontSize.xs, color: colors.textSecondary, lineHeight: 17 },
  rateWarning: {
    fontSize: fontSize.xs,
    color: colors.warning,
    lineHeight: 17,
    marginBottom: spacing.md,
  },
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
