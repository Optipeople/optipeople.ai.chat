// Model spend → credits, and the per-account credit pool.
//
// Credits are the only unit the commercial side speaks. Tokens are not
// sellable: nobody buying this knows what one is, and pricing in them
// re-prices the product every time a provider moves a rate. So every
// usage view converts measured dollars into credits, and the invoice is
// raised in credits after the fact.
//
// Nothing in this file enforces anything. It is accounting, not a gate —
// there is no code path where a number here stops an operator getting an
// answer at a stopped machine, which is the one moment the app exists
// for. Overage is invoiced later, not blocked now.
//
// THE CONVERSION
//
//   credits = model_cost_usd / CREDIT_COST_USD
//
// One multiplication, applied to the USD figure src/lib/pricing.ts
// already computes from usage_events. Deliberately not a per-operation
// weight table: a weight table has to be re-tuned every time the prompt,
// the model or the retrieval depth changes, and it drifts from the real
// bill silently. Cost is measured, so derive from cost.
//
// Rounding happens once, at the account total. Rounding per event would
// turn a 20-token embedding call into a whole credit and inflate a
// month's usage by orders of magnitude.
//
// TWO CURRENCIES, NO EXCHANGE RATE
//
// We pay the model providers in USD, so every cost in this codebase is
// USD and CREDIT_COST_USD is a cost. Customers are Danish and invoiced in
// DKK, so every price is DKK.
//
// There is deliberately no USD/DKK rate anywhere. The price of a credit
// block is set in kroner directly, not converted from a dollar figure:
// a rate constant would be stale the week after it was written and would
// make a published price wobble with the currency market. The two
// currencies simply never meet in code. Comparing them (to check margin)
// is a spreadsheet job, done at whatever rate applies that day.
//
// Isomorphic: imported by admin API routes and by the admin UI, so no
// process.env reads here (a non-public env var is undefined in the client
// bundle and the two sides would disagree). One file of literals.

/**
 * Dollars of measured model spend that one credit represents.
 *
 * Calibrated so one credit is roughly one answered text question, which
 * is the unit an account admin can actually picture. Review against
 * usage_account_summary when model prices or the prompt change
 * materially; this is the only number that needs moving.
 *
 * CALIBRATION LAST CHECKED: 2026-09-16
 */
export const CREDIT_COST_USD = 0.05;

/** Credits each onboarded machine adds to its account's monthly pool. */
export const CREDITS_PER_MACHINE_PER_MONTH = 100;

/**
 * Overage is sold in blocks, not per credit. A per-credit line item
 * produces an invoice nobody can predict, which is the thing that makes
 * usage pricing hard to buy; a block is a number a customer can agree to
 * in advance.
 *
 * A block costs us OVERAGE_BLOCK_CREDITS * CREDIT_COST_USD = $5 of model
 * spend and sells for 150 DKK, so it carries a wide margin even at an
 * unfavourable exchange rate. It also sits below the per-machine price on
 * purpose: adding a machine should always be the better deal than living
 * on top-ups.
 */
export const OVERAGE_BLOCK_CREDITS = 100;
export const OVERAGE_BLOCK_PRICE_DKK = 150;

/** Credits for a USD amount of model spend. Fractional by design. */
export function creditsForUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return usd / CREDIT_COST_USD;
}

/** The USD of model spend one credit allowance is worth. */
export function usdForCredits(credits: number): number {
  return credits * CREDIT_COST_USD;
}

/** Monthly pool for an account, shared across every one of its machines. */
export function poolCredits(machineCount: number): number {
  return Math.max(0, Math.floor(machineCount)) * CREDITS_PER_MACHINE_PER_MONTH;
}

export type CreditSummary = {
  /** Onboarded machines on the account — what the pool scales with. */
  machines: number;
  /** Pool for the period: machines * CREDITS_PER_MACHINE_PER_MONTH. */
  includedCredits: number;
  /** Credits consumed, rounded up once at the account total. */
  usedCredits: number;
  /** Credits above the pool. Zero when inside it. */
  overageCredits: number;
  /** Whole top-up blocks the overage rounds up to, for the invoice. */
  overageBlocks: number;
  /** What those blocks bill at, in DKK. This is a price, not a cost. */
  overageDkk: number;
  /** Share of the pool consumed, 0..n. Above 1 means over. */
  poolUsedFraction: number;
};

/**
 * The whole invoicing picture for one account over one period.
 *
 * `costUsd` is the priced total from src/lib/pricing.ts. The pool is
 * whole-account: a five-machine account gets 500 credits spendable from
 * any one of them, because demand is concentrated — in a given month two
 * or three machines generate most of the questions, and a per-machine cap
 * would strand the allowance on the healthy ones.
 */
export function summarizeCredits(input: {
  machines: number;
  costUsd: number;
  /**
   * Period length, for pro-rating a pool that is quoted per month.
   * Defaults to 30 so a 30-day usage window is exactly one month's pool.
   */
  days?: number;
}): CreditSummary {
  const machines = Math.max(0, Math.floor(input.machines));
  const days = input.days ?? 30;
  const monthFraction = days / 30;

  const includedCredits = Math.round(poolCredits(machines) * monthFraction);
  const usedCredits = Math.ceil(creditsForUsd(input.costUsd));
  const overageCredits = Math.max(0, usedCredits - includedCredits);
  const overageBlocks = Math.ceil(overageCredits / OVERAGE_BLOCK_CREDITS);

  return {
    machines,
    includedCredits,
    usedCredits,
    overageCredits,
    overageBlocks,
    overageDkk: overageBlocks * OVERAGE_BLOCK_PRICE_DKK,
    poolUsedFraction:
      includedCredits > 0 ? usedCredits / includedCredits : usedCredits > 0 ? Infinity : 0,
  };
}

/**
 * Prices for display, in kroner. Always formatted da-DK regardless of the
 * interface language: the invoice is in DKK whoever is reading the
 * screen, and "DKK 150.00" in an English UI is a worse rendering of a
 * Danish price than "150 kr." is. Whole kroner, because every amount
 * here is a whole number of blocks.
 */
const DKK_FMT = new Intl.NumberFormat("da-DK", {
  style: "currency",
  currency: "DKK",
  maximumFractionDigits: 0,
});

export function formatDkk(dkk: number): string {
  if (!Number.isFinite(dkk)) return "—";
  return DKK_FMT.format(dkk);
}

/** Credits for display. Whole numbers — a fractional credit is noise. */
export function formatCredits(credits: number): string {
  if (!Number.isFinite(credits)) return "—";
  return Math.round(credits).toLocaleString("en-US");
}
