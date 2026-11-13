import { NextRequest, NextResponse } from "next/server";
import { canManageMasters, requireAuthorizedUser } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";

type ImportRow = {
  id: number; line_number: number; raw_row: Record<string, string>; status: string;
  barcode: string | null; action: string | null; occurred_on: string | null;
  error_message: string | null; container_id: string | null;
};

async function requireReconciler() {
  const user = await requireAuthorizedUser();
  if (!user) return { user: null, error: NextResponse.json({ error: "ログインが必要です。" }, { status: 401 }) };
  if (!canManageMasters(user)) return { user: null, error: NextResponse.json({ error: "伝票照合と確定は管理者のみ実行できます。" }, { status: 403 }) };
  return { user, error: null };
}
function field(raw: Record<string, string>, key: string, alias: string) {
  return String(raw[key] ?? raw[alias] ?? "").trim();
}
async function loadBatch(importId: string) {
  const db = adminClient();
  const [batch, rows, finalization] = await Promise.all([
    db.from("handheld_imports").select("id,source_filename,created_at,total_rows,applied_rows,error_rows,status").eq("id", importId).maybeSingle(),
    db.from("handheld_import_rows").select("id,line_number,raw_row,status,barcode,action,occurred_on,error_message,container_id").eq("import_id", importId).order("line_number"),
    db.from("handheld_reconciliation_finalizations").select("finalized_at,finalized_by,note").eq("import_id", importId).maybeSingle()
  ]);
  const failure = [batch, rows, finalization].find(result => result.error);
  if (failure?.error) throw new Error(failure.error.message);
  if (!batch.data) throw new Error("対象のハンディ取込履歴がありません。");
  const importedRows = (rows.data ?? []) as ImportRow[];
  const ids = importedRows.map(item => item.id);
  const [checks, containers, customers, suppliers] = await Promise.all([
    ids.length ? db.from("handheld_reconciliation_checks").select("import_row_id,decision,note,checked_at").in("import_row_id", ids) : Promise.resolve({ data: [], error: null }),
    db.from("containers").select("id,serial_number,gas_types(name),capacity_value,capacity_unit"),
    db.from("customers").select("id,name"),
    db.from("suppliers").select("id,name")
  ]);
  const err = [checks, containers, customers, suppliers].find(result => result.error);
  if (err?.error) throw new Error(err.error.message);
  const checkMap = new Map((checks.data ?? []).map(item => [item.import_row_id, item]));
  const containerMap = new Map((containers.data ?? []).map(item => [item.id, item]));
  const reportRows = importedRows.map(row => {
    const raw = row.raw_row ?? {};
    const container = containerMap.get(row.container_id ?? "");
    const gas = (container?.gas_types as { name?: string } | null)?.name ?? "";
    const enteredGas = field(raw, "gasName", "ガス種");
    const enteredCapacity = field(raw, "capacityValue", "容量") || field(raw, "capacityValue", "充填量");
    const unit = field(raw, "capacityUnit", "容量単位");
    const issues: string[] = [];
    if (enteredGas && gas && enteredGas !== gas) issues.push("ガス種が台帳と異なります。");
    if (enteredGas && !gas) issues.push("ガス種の台帳設定がありません。");
    if (enteredCapacity && container?.capacity_value != null && Number.isFinite(Number(enteredCapacity))) {
      if (unit && container.capacity_unit && unit !== container.capacity_unit) issues.push("容量単位が異なります。");
      else if (Math.abs(Number(enteredCapacity) - Number(container.capacity_value)) > 0.000001) issues.push("容量が台帳と異なります。");
    }
    const checked = checkMap.get(row.id);
    return {
      id: row.id, lineNumber: row.line_number, action: row.action, barcode: row.barcode,
      serialNumber: container?.serial_number ?? row.barcode ?? "", occurredOn: row.occurred_on, status: row.status,
      customer: field(raw, "customerName", "顧客"), supplier: field(raw, "supplierName", "仕入先"),
      branch: field(raw, "branchName", "営業所"), referenceNumber: field(raw, "referenceNumber", "伝票番号"),
      gasName: enteredGas || gas, capacity: enteredCapacity, capacityUnit: unit,
      error: row.error_message, issues, decision: checked?.decision ?? "unreviewed", note: checked?.note ?? "",
      checkedAt: checked?.checked_at ?? null
    };
  });
  const applied = reportRows.filter(row => row.status === "applied");
  return {
    batch: batch.data, rows: reportRows, finalized: finalization.data,
    summary: {
      applied: applied.length, errors: reportRows.filter(row => row.status === "error").length,
      matched: applied.filter(row => row.decision === "matched").length,
      held: applied.filter(row => row.decision === "hold").length,
      unreviewed: applied.filter(row => row.decision === "unreviewed").length
    }
  };
}
export async function GET(request: NextRequest) {
  try {
    const auth = await requireReconciler();
    if (auth.error) return auth.error;
    const db = adminClient();
    const id = request.nextUrl.searchParams.get("importId");
    if (id) return NextResponse.json(await loadBatch(id));
    const result = await db.from("handheld_imports")
      .select("id,source_filename,created_at,total_rows,applied_rows,error_rows,status")
      .order("created_at", { ascending: false }).limit(40);
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ batches: result.data ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "照合データを読み込めませんでした。" }, { status: 400 });
  }
}
export async function POST(request: NextRequest) {
  try {
    const auth = await requireReconciler();
    if (auth.error || !auth.user) return auth.error;
    const body = await request.json() as {
      action?: "check" | "bulk_check" | "finalize"; importId?: string; rowId?: number; rowIds?: number[];
      decision?: "matched" | "hold"; note?: string; paperSlipChecked?: boolean
    };
    if (!body.importId || !/^[0-9a-f-]{36}$/i.test(body.importId)) throw new Error("取込履歴を選択してください。");
    const db = adminClient();
    const dataset = await loadBatch(body.importId);
    if (dataset.finalized) return NextResponse.json({ error: "この取込はすでに照合確定済みです。" }, { status: 409 });
    if (body.action === "check") {
      const row = dataset.rows.find(item => item.id === body.rowId);
      if (!row || row.status !== "applied") throw new Error("照合できるのは登録成功した明細のみです。");
      if (body.decision !== "matched" && body.decision !== "hold") throw new Error("照合結果を指定してください。");
      if (body.decision === "matched" && !body.paperSlipChecked) throw new Error("紙の伝票との照合確認が必要です。");
      const note = String(body.note ?? "").trim();
      if (body.decision === "hold" && note.length < 3) throw new Error("保留理由を3文字以上入力してください。");
      if (row.issues.length && body.decision === "matched" && note.length < 3) throw new Error("台帳との差異があります。確認内容を備考に入力してください。");
      if (note.length > 1000) throw new Error("備考は1000文字以内で入力してください。");
      const saved = await db.from("handheld_reconciliation_checks").upsert({
        import_row_id: row.id, decision: body.decision, note, checked_by: auth.user.id, checked_at: new Date().toISOString()
      }, { onConflict: "import_row_id" });
      if (saved.error) throw new Error(saved.error.message);
      const audit = await db.from("handheld_reconciliation_events").insert({
        import_row_id: row.id, decision: body.decision, note, checked_by: auth.user.id
      });
      if (audit.error) throw new Error(audit.error.message);
      return NextResponse.json({ ok: true, batch: await loadBatch(body.importId) });
    }
    if (body.action === "bulk_check") {
      if (!body.paperSlipChecked) throw new Error("選択した全明細について紙伝票との一致確認が必要です。");
      if (!Array.isArray(body.rowIds) || !body.rowIds.length || body.rowIds.length > 500) {
        throw new Error("一括照合する明細を1〜500件選択してください。");
      }
      const ids = body.rowIds;
      if (ids.some(id => !Number.isSafeInteger(id) || id <= 0) || new Set(ids).size !== ids.length) {
        throw new Error("選択明細に不正なIDまたは重複があります。");
      }
      const eligible = new Map(dataset.rows.filter(row =>
        row.status === "applied" && row.decision === "unreviewed" &&
        row.issues.length === 0 && !row.error
      ).map(row => [row.id, row]));
      if (ids.some(id => !eligible.has(id))) {
        throw new Error("一括照合できるのは、未照合・登録成功・台帳との差異なしの明細のみです。保留・照合済・要確認・エラー行は対象外です。");
      }
      const now = new Date().toISOString();
      const note = "紙伝票と目視照合済み（一括操作・自動照合ではありません）";
      const saved = await db.from("handheld_reconciliation_checks").upsert(
        ids.map(id => ({
          import_row_id: id, decision: "matched" as const, note,
          checked_by: auth.user.id, checked_at: now
        })),
        { onConflict: "import_row_id" }
      );
      if (saved.error) throw new Error(saved.error.message);
      const audit = await db.from("handheld_reconciliation_events").insert(
        ids.map(id => ({
          import_row_id: id, decision: "matched" as const, note, checked_by: auth.user.id
        }))
      );
      if (audit.error) throw new Error("照合は保存されましたが、監査履歴の記録に失敗しました。管理者へ連絡してください：" + audit.error.message);
      return NextResponse.json({ ok: true, matchedCount: ids.length, batch: await loadBatch(body.importId) });
    }
    if (body.action === "finalize") {
      if (!dataset.summary.applied) throw new Error("確定対象の登録成功明細がありません。");
      if (dataset.summary.held || dataset.summary.unreviewed) {
        throw new Error("すべての登録成功明細を伝票照合済みにしてから確定してください。保留中・未照合の明細があります。");
      }
      const finalization = await db.from("handheld_reconciliation_finalizations").insert({
        import_id: body.importId, finalized_by: auth.user.id, note: "ハンディ取込明細の伝票照合確定（売上未計上）"
      });
      if (finalization.error) throw new Error(finalization.error.message);
      return NextResponse.json({ ok: true, batch: await loadBatch(body.importId) }, { status: 201 });
    }
    throw new Error("処理内容が不正です。");
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "照合処理に失敗しました。" }, { status: 400 });
  }
}
