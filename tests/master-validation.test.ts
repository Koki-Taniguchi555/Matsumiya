import { describe, expect, it } from "vitest";
import { normalizeBarcodes, requiredText } from "../lib/master-validation";

describe("バーコード入力", () => {
  it("改行・タブ・重複を正規化する", () => {
    expect(normalizeBarcodes(" A001\nA002\tA001 , A003 ")).toEqual(["A001", "A002", "A003"]);
  });

  it("必須文字列を検証する", () => {
    expect(requiredText(" 松宮営業所 ", "営業所名")).toBe("松宮営業所");
    expect(() => requiredText(" ", "営業所名")).toThrow("営業所名は必須です。");
  });
});
