export type MasterKind = "branch" | "customer" | "supplier" | "owner" | "gas" | "inspection" | "container";

export function requiredText(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label}は必須です。`);
  return text;
}

/** Bar-code scanners commonly send one value per line (or paste a list). */
export function normalizeBarcodes(value: string) {
  return [...new Set(value.split(/[\r\n,\t]+/).map((item) => item.trim()).filter(Boolean))];
}
