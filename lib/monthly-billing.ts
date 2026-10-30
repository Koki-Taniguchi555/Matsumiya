import { BILLING_DAYS, FREE_DAYS, MONTHLY_FEE_YEN } from "./billing";

export type BillingLoan = {
  id: string;
  containerId: string;
  customerId: string;
  deliveredOn: string;
  recoveredOn: string | null;
};

export type MonthlyBillingPreview = {
  billableDays: number;
  amountYen: number;
  billingStart: string | null;
  billingEnd: string | null;
};

function parseMonth(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("対象年月はYYYY-MM形式で指定してください。");
  const [year, monthNumber] = month.split("-").map(Number);
  if (monthNumber < 1 || monthNumber > 12) throw new Error("対象年月が正しくありません。");
  return { year, monthNumber };
}

function isoDate(value: Date) { return value.toISOString().slice(0, 10); }
function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

/** Returns the first and final date of an accounting month without relying on local time. */
export function billingMonthRange(month: string) {
  const { year, monthNumber } = parseMonth(month);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const last = new Date(Date.UTC(year, monthNumber, 0));
  return { billingMonth: isoDate(first), firstDay: isoDate(first), lastDay: isoDate(last) };
}

/**
 * Calculates the chargeable portion inside one month. Day 1 through day 93 are
 * free; day 94 is `deliveredOn + 93`. The recovery date is included.
 */
export function previewMonthlyUsageCharge(loan: BillingLoan, billingMonth: string): MonthlyBillingPreview {
  const { firstDay, lastDay } = billingMonthRange(billingMonth);
  const billingStart = [addDays(loan.deliveredOn, FREE_DAYS), firstDay].sort().at(-1)!;
  const billingEnd = [loan.recoveredOn ?? lastDay, lastDay].sort()[0];
  if (billingStart > billingEnd) return { billableDays: 0, amountYen: 0, billingStart: null, billingEnd: null };
  const start = new Date(`${billingStart}T00:00:00.000Z`).getTime();
  const end = new Date(`${billingEnd}T00:00:00.000Z`).getTime();
  const billableDays = Math.floor((end - start) / 86_400_000) + 1;
  return { billableDays, amountYen: Math.floor((billableDays * MONTHLY_FEE_YEN) / BILLING_DAYS), billingStart, billingEnd };
}

export function isLoanInBillingMonth(loan: BillingLoan, billingMonth: string) {
  const { firstDay, lastDay } = billingMonthRange(billingMonth);
  return loan.deliveredOn <= lastDay && (!loan.recoveredOn || loan.recoveredOn >= firstDay);
}
