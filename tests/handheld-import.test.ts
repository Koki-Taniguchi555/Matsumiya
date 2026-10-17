import { describe, expect, it } from "vitest";
import { normalizeAction, parseHandheldCsv, validateHandheldRows } from "../lib/handheld-import";

describe("ハンディCSV", () => {
  it("日本語ヘッダーと引用符を読める", () => {
    const rows = parseHandheldCsv("処理日,処理区分,バーコード,顧客\n2026-10-17,納品,C-1,\"松宮,商店\"");
    expect(rows[0]).toMatchObject({ action: "納品", barcode: "C-1", customerName: "松宮,商店" });
  });
  it("操作と必須項目を検証する", () => {
    expect(normalizeAction("回収")).toBe("recovered");
    const rows = parseHandheldCsv("処理日,処理区分,バーコード\n2026/10/17,納品,C-1");
    expect(validateHandheldRows(rows).map((item) => item.message)).toEqual(expect.arrayContaining([expect.stringContaining("YYYY-MM-DD"), expect.stringContaining("顧客名")]));
  });
});
