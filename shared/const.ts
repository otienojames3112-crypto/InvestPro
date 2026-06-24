export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';

/**
 * Bank-instrument deposit types (Round 30).
 *
 * Five kinds are recordable. TERM kinds (fixed_deposit, target_savings) have a
 * maturity date and accrue to maturity, then return principal + interest to the
 * MMF for redeployment. LIQUID kinds (call_deposit, ordinary_savings,
 * tiered_savings) accrue in place and stay withdrawable (no maturity lock).
 */
export type BankInstrumentType =
  | "call_deposit"
  | "fixed_deposit"
  | "ordinary_savings"
  | "target_savings"
  | "tiered_savings";

export interface BankInstrumentMeta {
  value: BankInstrumentType;
  /** Short label, e.g. "Fixed Deposit". */
  label: string;
  /** Whether the deposit locks until a maturity date (term) or stays liquid. */
  isTerm: boolean;
  /** One-line plain-language description for the picker. */
  hint: string;
}

export const BANK_INSTRUMENT_TYPES: BankInstrumentMeta[] = [
  {
    value: "fixed_deposit",
    label: "Fixed Deposit",
    isTerm: true,
    hint: "Locked for a set term at a fixed rate; pays principal + interest at maturity.",
  },
  {
    value: "call_deposit",
    label: "Call Deposit",
    isTerm: false,
    hint: "Liquid; withdraw on short notice. Lower rate than a fixed deposit.",
  },
  {
    value: "ordinary_savings",
    label: "Ordinary / Regular Savings",
    isTerm: false,
    hint: "Everyday savings account; fully liquid, modest interest.",
  },
  {
    value: "target_savings",
    label: "Target / Goal Savings",
    isTerm: true,
    hint: "Goal account with a target date; early withdrawal may forfeit some interest.",
  },
  {
    value: "tiered_savings",
    label: "Tiered / High-Yield Savings",
    isTerm: false,
    hint: "Liquid savings whose rate rises with balance tiers.",
  },
];

/** True when a bank-instrument type locks to a maturity date (term deposit). */
export function isTermBankInstrument(t: BankInstrumentType): boolean {
  return t === "fixed_deposit" || t === "target_savings";
}

/** Short human label for a bank-instrument type. */
export function bankInstrumentLabel(t: string): string {
  return BANK_INSTRUMENT_TYPES.find((m) => m.value === t)?.label ?? "Bank Deposit";
}
