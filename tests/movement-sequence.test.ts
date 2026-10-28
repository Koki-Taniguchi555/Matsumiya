import { describe, expect, it } from "vitest";
import { findSequenceErrors } from "../lib/movement-sequence";

describe("movement sequence validation", () => {
  it("accepts the received → delivered → recovered → supplier return cycle", () => {
    expect(findSequenceErrors([{ action: "received" }, { action: "delivered" }, { action: "recovered" }, { action: "supplier_return" }])).toEqual([null, null, null, null]);
  });

  it("flags an out-of-order action", () => {
    expect(findSequenceErrors([{ action: "received" }, { action: "recovered" }])[1]).toContain("順序エラー");
  });
});
