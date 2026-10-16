import { describe, expect, it } from "vitest";
import { calculateUsageFee } from "../lib/billing";
describe("usage fee", () => {
  it("is free through the 93rd inclusive day", () => expect(calculateUsageFee("2026-01-01", "2026-04-03")).toMatchObject({ heldDays: 93, billableDays: 0, amountYen: 0 }));
  it("charges from day 94 and floors the daily prorated amount", () => expect(calculateUsageFee("2026-01-01", "2026-04-04")).toMatchObject({ heldDays: 94, billableDays: 1, amountYen: 19 }));
  it("includes the recovery day", () => expect(calculateUsageFee("2026-01-01", "2026-05-04")).toMatchObject({ billableDays: 31, amountYen: 600 }));
  it("rejects recovery before delivery", () => expect(() => calculateUsageFee("2026-02-01", "2026-01-31")).toThrow());
});
