import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const currencyFormatters = new Map<string, Intl.NumberFormat>();

/** Signed money — the sign is ALWAYS in the text; color never carries P&L alone. */
export const fmtMoney = (value: number, currency = "USD"): string => {
  let formatter = currencyFormatters.get(currency);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      signDisplay: "exceptZero",
    });
    currencyFormatters.set(currency, formatter);
  }
  return formatter.format(value);
};

/**
 * Display-only sign normalisation: a leading ASCII hyphen becomes the true minus (U+2212) so
 * losses share one glyph with `SignedText` money. A figure that rounds to zero loses its sign
 * ("-0.00%" -> "0.00%"). A lone "-" placeholder and text without a leading hyphen pass through.
 * Never feed the result to exports, inputs, URLs or anything parsed back into a number.
 */
export const minusSign = (text: string): string => {
  if (!/^-\S/.test(text)) return text;
  const figure = text.slice(1).split(/\s/, 1)[0] ?? "";
  return /[1-9]/.test(figure) ? `\u2212${text.slice(1)}` : text.slice(1);
};

const numberFormatters = new Map<number, Intl.NumberFormat>();
export const fmtNumber = (value: number, digits = 2): string => {
  let formatter = numberFormatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      maximumFractionDigits: digits,
      signDisplay: "negative",
    });
    numberFormatters.set(digits, formatter);
  }
  return minusSign(formatter.format(value));
};

type SignOption = { sign?: boolean };

/** A fixed-decimal figure with display signs: true minus, unsigned zero, "+" only if asked. */
const signedFixed = (value: number, digits: number, suffix: string, sign: boolean): string => {
  const text = minusSign(value.toFixed(digits));
  const gain = sign && /[1-9]/.test(text) && !text.startsWith("\u2212");
  return `${gain ? "+" : ""}${text}${suffix}`;
};

/** `value` is a ratio (0.5 -> "50.0%"). Null/NaN -> "–". `sign` prefixes "+" on gains. */
export const fmtPercent = (
  value: number | null | undefined,
  digits = 1,
  { sign = false }: SignOption = {},
): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "–"
    : signedFixed(value * 100, digits, "%", sign);

/** R-multiple, e.g. "−1.20R". Null/NaN -> "–". `sign` prefixes "+" on gains. */
export const fmtR = (
  value: number | null | undefined,
  digits = 2,
  { sign = false }: SignOption = {},
): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "–"
    : signedFixed(value, digits, "R", sign);

export const fmtDuration = (ms: number | null | undefined): string => {
  if (ms === null || ms === undefined) return "–";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "< 1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
};

export const pnlClass = (value: number): string =>
  value > 0 ? "text-profit" : value < 0 ? "text-loss" : "text-muted-foreground";
