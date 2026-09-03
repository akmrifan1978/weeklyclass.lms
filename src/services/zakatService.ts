/**
 * Zakat on wealth (zakat al-mal).
 *
 * Arithmetic only. The rate and the nisab thresholds below are the classical,
 * broadly agreed ones — 2.5% of qualifying net wealth, with nisab set at the
 * value of 85g of gold or 595g of silver — but how particular assets are treated
 * (pensions, shares, money owed to you that may never arrive) is a question
 * scholars answer differently. The screen says so rather than presenting one
 * answer as the only one.
 *
 * Prices are entered by the person, not fetched. Gold and silver move daily and
 * are quoted in a different currency in every country this app serves, so a
 * hard-coded or scraped price would be wrong for almost everyone — and reaching
 * out for financial data is not something this app should be doing on its own.
 */

/** The rate on qualifying wealth: a fortieth. */
export const ZAKAT_RATE = 0.025;

/** Nisab in grams of the metal itself. */
export const NISAB_GOLD_GRAMS = 85;
export const NISAB_SILVER_GRAMS = 595;

/**
 * Which metal sets the threshold.
 *
 * Silver gives the lower figure at today's prices, so it makes more people
 * liable and is the more cautious basis; many scholars recommend it for exactly
 * that reason. Gold is also widely used. The choice is offered rather than made.
 */
export type NisabBasis = 'silver' | 'gold';

export interface ZakatInput {
  /** Cash in hand, current accounts and savings. */
  cash: number;
  /** Weight held, in grams — not value. Valued using the prices below. */
  goldGrams: number;
  silverGrams: number;
  /** Stock held for sale, at what it would sell for. */
  businessAssets: number;
  /** Money owed to you that you reasonably expect to receive. */
  receivables: number;
  /** Other zakatable holdings — shares, funds, invested savings. */
  investments: number;
  /** Debts and bills due now, which come off the total. */
  liabilities: number;

  goldPricePerGram: number;
  silverPricePerGram: number;
  basis: NisabBasis;
}

export interface ZakatResult {
  goldValue: number;
  silverValue: number;
  totalAssets: number;
  netWealth: number;
  nisab: number;
  /** True when net wealth reaches the threshold. */
  liable: boolean;
  /** 2.5% of net wealth, or 0 when below the threshold. */
  zakatDue: number;
  /** How far short of the threshold, when not liable. */
  shortfall: number;
}

const num = (value: number | undefined): number =>
  Number.isFinite(value) && (value as number) > 0 ? (value as number) : 0;

export function calculateZakat(input: ZakatInput): ZakatResult {
  const goldValue = num(input.goldGrams) * num(input.goldPricePerGram);
  const silverValue = num(input.silverGrams) * num(input.silverPricePerGram);

  const totalAssets =
    num(input.cash) +
    goldValue +
    silverValue +
    num(input.businessAssets) +
    num(input.receivables) +
    num(input.investments);

  // Liabilities can exceed assets. Clamped at zero rather than reported as
  // negative wealth, which would be arithmetically tidy and meaningless.
  const netWealth = Math.max(0, totalAssets - num(input.liabilities));

  const nisab =
    input.basis === 'gold'
      ? NISAB_GOLD_GRAMS * num(input.goldPricePerGram)
      : NISAB_SILVER_GRAMS * num(input.silverPricePerGram);

  // With no price entered the threshold is zero, and everyone would look liable
  // on a total of nothing. Treat an unpriced threshold as not yet answerable.
  const liable = nisab > 0 && netWealth >= nisab;

  return {
    goldValue,
    silverValue,
    totalAssets,
    netWealth,
    nisab,
    liable,
    zakatDue: liable ? netWealth * ZAKAT_RATE : 0,
    shortfall: nisab > 0 && !liable ? Math.max(0, nisab - netWealth) : 0,
  };
}

/** True once there is enough entered for the result to mean anything. */
export function hasEnoughToCalculate(input: ZakatInput): boolean {
  const pricedBasis =
    input.basis === 'gold'
      ? num(input.goldPricePerGram) > 0
      : num(input.silverPricePerGram) > 0;
  return pricedBasis;
}
