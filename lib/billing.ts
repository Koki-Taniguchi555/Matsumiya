export const FREE_DAYS = 93;
export const MONTHLY_FEE_YEN = 600;
export const BILLING_DAYS = 31;

const utcDay = (value: string | Date) => {
  const date = new Date(value);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
};

/** Both delivery and recovery dates are included in the holding period. */
export function inclusiveDays(startDate: string | Date, endDate: string | Date) {
  return Math.floor((utcDay(endDate) - utcDay(startDate)) / 86_400_000) + 1;
}

export function calculateUsageFee(deliveredOn: string | Date, recoveredOn: string | Date) {
  const heldDays = inclusiveDays(deliveredOn, recoveredOn);
  if (heldDays < 1) throw new Error("回収日は納品日以降にしてください。");
  const billableDays = Math.max(0, heldDays - FREE_DAYS);
  return { heldDays, billableDays, amountYen: Math.floor((billableDays * MONTHLY_FEE_YEN) / BILLING_DAYS) };
}
