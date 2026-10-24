/**
 * Truthful GBP cost labels and budget comparison for MYT.
 *
 * Money is integer pence. This module does not convert currency, fetch prices,
 * add booking fees, read storage or touch the network. A null amount is an
 * unknown price. Only a valid stored zero is free.
 *
 * Pence are taken from decimal strings (or from an integer that is already
 * safe). Values are never multiplied or divided by 100, because that turns
 * pounds such as 0.29 into a binary fraction and can drop a penny.
 */

export interface CostInput {
  amountPence: number | null;
  currency: "GBP";
  isEstimate: boolean;
}

/** Mechanical budget relation. "within" on an estimate is an estimated fit. */
export type BudgetComparison = "within" | "over" | "unknown";

export type BudgetParseResult =
  | { ok: true; value: number | null }
  | { ok: false; message: string };

export const COST_UNKNOWN_LABEL = "Cost unknown";
export const COST_UNAVAILABLE_LABEL = "Cost unavailable";
export const FREE_LABEL = "Free";
/** Appended to a known amount, including an estimated zero, with one leading space. */
export const ESTIMATE_SUFFIX = " (estimate)";

const MAX_SAFE_PENCE_TEXT = "9007199254740991";

const GBP_FORMAT = new Intl.NumberFormat("en-GB", {
  style: "currency",
  currency: "GBP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const SCIENTIFIC_POUNDS = /^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/;
const LEADING_MINUS = /^[-−–—]/;
const TOO_MANY_DECIMALS = /^(?:\d+)?\.\d{3,}$/;
const POUNDS_TEXT = /^(\d*)(?:\.(\d{1,2}))?$/;

type CostReading =
  | { kind: "unknown" }
  | { kind: "invalid" }
  | { kind: "known"; amountPence: number; isEstimate: boolean };

function isStoredPence(value: unknown): value is number {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
    && !Object.is(value, -0);
}

function readCost(cost: CostInput): CostReading {
  if (cost === null || typeof cost !== "object") return { kind: "invalid" };
  if (cost.currency !== "GBP" || typeof cost.isEstimate !== "boolean") return { kind: "invalid" };
  if (cost.amountPence === null) return { kind: "unknown" };
  if (!isStoredPence(cost.amountPence)) return { kind: "invalid" };
  return { kind: "known", amountPence: cost.amountPence, isEstimate: cost.isEstimate };
}

/**
 * Format a safe whole number of pence with en-GB GBP grouping.
 * The pound digits come from the integer text, and the two pence digits
 * replace the formatter's fraction, so a large safe value cannot lose pennies.
 */
function formatGbp(amountPence: number): string {
  const digits = String(amountPence);
  const poundDigits = digits.length > 2 ? digits.slice(0, -2) : "0";
  const penceDigits = digits.length > 2 ? digits.slice(-2) : digits.padStart(2, "0");
  const parts = GBP_FORMAT.formatToParts(Number(poundDigits));
  let replacedFraction = false;
  const formatted = parts.map((part) => {
    if (part.type !== "fraction") return part.value;
    replacedFraction = true;
    return penceDigits;
  }).join("");
  return replacedFraction ? formatted : `${formatted}.${penceDigits}`;
}

function withEstimate(label: string, isEstimate: boolean): string {
  return isEstimate ? `${label}${ESTIMATE_SUFFIX}` : label;
}

export function formatCost(cost: CostInput): string {
  const reading = readCost(cost);
  if (reading.kind === "unknown") return COST_UNKNOWN_LABEL;
  if (reading.kind === "invalid") return COST_UNAVAILABLE_LABEL;
  const label = reading.amountPence === 0 ? FREE_LABEL : formatGbp(reading.amountPence);
  return withEstimate(label, reading.isEstimate);
}

export function compareBudget(cost: CostInput, budgetPence: number | null): BudgetComparison {
  const reading = readCost(cost);
  if (reading.kind !== "known" || !isStoredPence(budgetPence)) return "unknown";
  return reading.amountPence <= budgetPence ? "within" : "over";
}

function reject(message: string): BudgetParseResult {
  return { ok: false, message };
}

function penceFromDecimalParts(wholeDigits: string, fractionDigits: string): number | null {
  const whole = wholeDigits.replace(/^0+/, "") || "0";
  const fraction = fractionDigits.padEnd(2, "0");
  let combined = `${whole}${fraction}`.replace(/^0+/, "");
  if (combined.length === 0) combined = "0";
  if (combined.length > MAX_SAFE_PENCE_TEXT.length) return null;
  if (combined.length === MAX_SAFE_PENCE_TEXT.length && combined > MAX_SAFE_PENCE_TEXT) return null;
  return Number(combined);
}

export function parseBudgetPounds(input: string): BudgetParseResult {
  if (typeof input !== "string") return reject("Enter a budget in pounds.");
  const trimmed = input.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (SCIENTIFIC_POUNDS.test(trimmed)) {
    return reject("Scientific notation is not accepted. Enter pounds and pence, such as 12.50.");
  }
  if (LEADING_MINUS.test(trimmed)) {
    return reject("Enter zero or a positive amount. Leave blank for no budget preference.");
  }
  const dotCount = trimmed.split(".").length - 1;
  if (/[,\s_'’]/.test(trimmed) || dotCount > 1) {
    return reject("Use digits and a single decimal point. Thousands separators are not accepted.");
  }
  if (TOO_MANY_DECIMALS.test(trimmed)) return reject("Use at most two decimal places.");
  const match = POUNDS_TEXT.exec(trimmed);
  const wholeDigits = match?.[1] ?? "";
  const fractionDigits = match?.[2] ?? "";
  if (match === null || (wholeDigits.length === 0 && fractionDigits.length === 0)) {
    return reject("Enter a whole number of pounds, or pounds and pence such as 12.50.");
  }
  const pence = penceFromDecimalParts(wholeDigits.length === 0 ? "0" : wholeDigits, fractionDigits);
  if (pence === null) return reject("That amount is too large to store exactly in pence.");
  return { ok: true, value: pence };
}
