import { NextRequest, NextResponse } from "next/server";
import { recordLifecycleAction, type LifecycleAction } from "@/lib/container-service";
import { normalizeAction, parseHandheldCsv, validateHandheldRows } from "@/lib/handheld-import";
import { adminClient } from "@/lib/supabase";

type ResolvedRow = { lineNumber: number; raw: Record<string, string>; action: LifecycleAction | null; barcode: string; occurredOn: string; containerId: string | null; customerId: string | null; branchId: string | null; error: string | null };

export async function POST(request: NextRequest) {
  try {
    const { filename, content, mode = "validate" } = await request.json() as { filename?: string; content?: string; mode?: "validate" | "apply" };
    if (!filename || !content) return NextResponse.json({ error: "CSVファイル名と内容が必要です。" }, { status: 400 });
    if (content.length > 1_000_000) return NextResponse.json({ error: "CSVは1MB以下にしてください。" }, { status: 400 });
    const rows = parseHandheldCsv(content);
    if (rows.length > 500) return NextResponse.json({ error: "一度に取り込める明細は500件までです。" }, { status: 400 });
    const basicIssues = validateHandheldRows(rows);
    const db = adminClient();
    const [containers, customers, branches] = await Promise.all([
      db.from("containers").select("id, barcode, serial_number, management_number, status"),
      db.from("customers").select("id, name"), db.from("branches").select("id, name")
    ]);
    for (const result of [containers, customers, branches]) if (result.error) throw new Error(result.error.message);
    const resolve = (items: { id: string; name?: string }[], name: string) => items.find((item) => item.name === name)?.id ?? null;
    const resolved: ResolvedRow[] = rows.map((row) => {
      const action = normalizeAction(row.action);
      const container = containers.data?.find((item) => [item.barcode, item.serial_number, item.management_number].includes(row.barcode.trim()));
      const errors = basicIssues.filter((issue) => issue.lineNumber === row.lineNumber).map((issue) => issue.message);
      const customerId = row.customerName.trim() ? resolve(customers.data ?? [], row.customerName.trim()) : null;
      const branchId = row.branchName.trim() ? resolve(branches.data ?? [], row.branchName.trim()) : null;
      if (!container) errors.push("バーコード・瓶号・管理番号に一致する容器がありません。");
      if (row.customerName.trim() && !customerId) errors.push("指定された顧客名が見つかりません。");
      if (row.branchName.trim() && !branchId) errors.push("指定された営業所名が見つかりません。");
      if (container && action === "delivered" && container.status !== "in_stock") errors.push("納品は在庫中の容器のみ可能です。");
      if (container && action === "recovered" && container.status !== "on_loan") errors.push("回収は貸出中の容器のみ可能です。");
      if (container && action === "received" && container.status === "on_loan") errors.push("貸出中の容器は入荷できません。");
      return { lineNumber: row.lineNumber, raw: row.raw, action, barcode: row.barcode, occurredOn: row.occurredOn, containerId: container?.id ?? null, customerId, branchId, error: errors.join(" ") || null };
    });
    if (mode === "validate") return NextResponse.json({ valid: resolved.filter((row) => !row.error).length, errors: resolved.filter((row) => row.error), rows: resolved });
    const importResult = await db.from("handheld_imports").insert({ source_filename: filename, total_rows: resolved.length, error_rows: resolved.filter((row) => row.error).length, status: resolved.some((row) => row.error) ? "partially_applied" : "validated" }).select("id").single();
    if (importResult.error || !importResult.data) throw new Error(importResult.error?.message ?? "取込履歴を作成できませんでした。");
    const importId = importResult.data.id;
    const rowInsert = await db.from("handheld_import_rows").insert(resolved.map((row) => ({ import_id: importId, line_number: row.lineNumber, raw_row: row.raw, action: row.action, barcode: row.barcode || null, container_id: row.containerId, occurred_on: /^\d{4}-\d{2}-\d{2}$/.test(row.occurredOn) ? row.occurredOn : null, status: row.error ? "error" : "validated", error_message: row.error })));
    if (rowInsert.error) throw new Error(rowInsert.error.message);
    let applied = 0;
    for (const row of resolved.filter((item) => !item.error && item.action && item.containerId)) {
      try {
        await recordLifecycleAction({ containerId: row.containerId!, action: row.action!, occurredOn: row.occurredOn, customerId: row.customerId ?? undefined, branchId: row.branchId ?? undefined });
        await db.from("handheld_import_rows").update({ status: "applied" }).eq("import_id", importId).eq("line_number", row.lineNumber);
        applied += 1;
      } catch (error) {
        await db.from("handheld_import_rows").update({ status: "error", error_message: error instanceof Error ? error.message : "登録に失敗しました。" }).eq("import_id", importId).eq("line_number", row.lineNumber);
      }
    }
    const errors = resolved.length - applied;
    await db.from("handheld_imports").update({ applied_rows: applied, error_rows: errors, status: errors === 0 ? "applied" : "partially_applied", completed_at: new Date().toISOString() }).eq("id", importId);
    return NextResponse.json({ importId, applied, errors });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "CSVを取り込めませんでした。" }, { status: 400 });
  }
}
