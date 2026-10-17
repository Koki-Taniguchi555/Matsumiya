import type { LifecycleAction } from "@/lib/container-service";

export type HandheldRow = { lineNumber: number; action: string; barcode: string; occurredOn: string; branchName: string; customerName: string; referenceNumber: string; note: string; raw: Record<string, string> };
export type RowIssue = { lineNumber: number; message: string };

const headerAliases: Record<string, keyof Omit<HandheldRow, "lineNumber" | "raw">> = {
  action: "action", "操作": "action", "処理": "action", "処理区分": "action",
  barcode: "barcode", "バーコード": "barcode", "瓶号": "barcode", "容器番号": "barcode", "管理番号": "barcode",
  operation_date: "occurredOn", date: "occurredOn", "処理日": "occurredOn", "日付": "occurredOn",
  branch_name: "branchName", branch: "branchName", "営業所": "branchName", "拠点": "branchName",
  customer_name: "customerName", customer: "customerName", "顧客": "customerName", "納入先": "customerName",
  reference_number: "referenceNumber", "伝票番号": "referenceNumber", "伝票": "referenceNumber",
  note: "note", "備考": "note"
};

function splitLine(line: string, delimiter: string) {
  const values: string[] = []; let value = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { values.push(value.trim()); value = ""; }
    else value += char;
  }
  values.push(value.trim());
  return values;
}

export function parseHandheldCsv(content: string): HandheldRow[] {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("ヘッダー行と少なくとも1件の明細行が必要です。");
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = splitLine(lines[0], delimiter).map((header) => headerAliases[header.trim().toLowerCase()] ?? header.trim());
  if (!headers.includes("action") || !headers.includes("barcode") || !headers.includes("occurredOn")) throw new Error("必須列「処理区分・バーコード・処理日」がありません。");
  return lines.slice(1).map((line, index) => {
    const values = splitLine(line, delimiter); const raw: Record<string, string> = {}; const row = { lineNumber: index + 2, action: "", barcode: "", occurredOn: "", branchName: "", customerName: "", referenceNumber: "", note: "", raw };
    headers.forEach((header, column) => { const value = values[column] ?? ""; raw[header] = value; if (header in row) (row as Record<string, unknown>)[header] = value; });
    return row;
  });
}

export function normalizeAction(value: string): LifecycleAction | null {
  const normalized = value.trim().toLowerCase();
  if (["received", "入荷", "返却"].includes(normalized)) return "received";
  if (["delivered", "納品", "出荷", "直送"].includes(normalized)) return "delivered";
  if (["recovered", "回収"].includes(normalized)) return "recovered";
  return null;
}

export function validateHandheldRows(rows: HandheldRow[]): RowIssue[] {
  return rows.flatMap((row) => {
    const issues: string[] = [];
    const action = normalizeAction(row.action);
    if (!action) issues.push("処理区分は入荷・納品・回収のいずれかにしてください。");
    if (!row.barcode.trim()) issues.push("バーコード（瓶号または管理番号でも可）が必要です。");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.occurredOn.trim())) issues.push("処理日は YYYY-MM-DD 形式で指定してください。");
    if (action === "delivered" && !row.customerName.trim()) issues.push("納品には顧客名が必要です。");
    return issues.map((message) => ({ lineNumber: row.lineNumber, message }));
  });
}

export const handheldCsvTemplate = "処理日,処理区分,バーコード,営業所,顧客,伝票番号,備考\n2026-10-17,入荷,CYL-0001,本社営業所,,IN-1001,初回取込\n2026-10-17,納品,CYL-0002,,松宮商店,DL-1002,\n2026-10-17,回収,CYL-0003,,松宮商店,RC-1003,";
