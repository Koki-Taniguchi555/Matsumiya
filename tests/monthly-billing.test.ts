import { describe, expect, it } from "vitest";
import { billingMonthRange, isLoanInBillingMonth, previewMonthlyUsageCharge } from "../lib/monthly-billing";

const loan = { id: "loan-1", containerId: "container-1", customerId: "customer-1", deliveredOn: "2026-01-01", recoveredOn: null };

describe("monthly billing preview", () => {
  it("uses the 94th day as the first billable date", () => {
    expect(previewMonthlyUsageCharge(loan, "2026-04")).toMatchObject({ billingStart: "2026-04-04", billingEnd: "2026-04-30", billableDays: 27, amountYen: 522 });
  });

  it("includes a recovery date when calculating the final month", () => {
    expect(previewMonthlyUsageCharge({ ...loan, recoveredOn: "2026-04-04" }, "2026-04")).toMatchObject({ billableDays: 1, amountYen: 19 });
  });

  it("keeps free or out-of-period loans visible with a zero preview", () => {
    expect(previewMonthlyUsageCharge(loan, "2026-03")).toMatchObject({ billableDays: 0, amountYen: 0 });
    expect(isLoanInBillingMonth({ ...loan, recoveredOn: "2026-01-20" }, "2026-02")).toBe(false);
  });

  it("normalizes the month range", () => expect(billingMonthRange("2026-02")).toEqual({ billingMonth: "2026-02-01", firstDay: "2026-02-01", lastDay: "2026-02-28" }));
});
