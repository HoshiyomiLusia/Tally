import type { Currency } from "./api";

export function formatAmount(amount: number, currency: Currency | string | undefined, currencies?: Currency[]): string {
  const c = typeof currency === "string" ? currencies?.find((x) => x.code === currency) : currency;
  const digits = c?.decimal_digits ?? 2;
  const sym = c?.symbol ?? "";
  const value = amount / Math.pow(10, digits);
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${sym}${formatted}`;
}

export function parseAmount(text: string, decimalDigits: number): number {
  const cleaned = text.replace(/,/g, "").trim();
  if (!cleaned) return 0;
  const value = parseFloat(cleaned);
  if (isNaN(value)) return 0;
  return Math.round(value * Math.pow(10, decimalDigits));
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function monthLabel(monthStr: string): string {
  const [y, m] = monthStr.split("-");
  return `${y} 年 ${parseInt(m, 10)} 月`;
}
