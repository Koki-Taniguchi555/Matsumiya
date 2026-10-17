import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase";

type State = { current_branch_id?: string | null; current_customer_id?: string | null };
const actionLabel: Record<string, string> = { received: "入荷・返却", delivered: "納品・直送", recovered: "回収" };

function location(state: State, branches: Map<string, string>, customers: Map<string, string>) {
  if (state.current_branch_id) return branches.get(state.current_branch_id) ?? "営業所（削除済み）";
  if (state.current_customer_id) return customers.get(state.current_customer_id) ?? "顧客（削除済み）";
  return "－";
}

export async function GET(request: NextRequest) {
  try {
    const containerId = request.nextUrl.searchParams.get("containerId");
    if (!containerId) return NextResponse.json({ error: "容器IDが必要です。" }, { status: 400 });
    const db = adminClient();
    const [container, audits, branches, customers, imported] = await Promise.all([
      db.from("containers").select("id, serial_number, management_number, barcode").eq("id", containerId).single(),
      db.from("container_audit_logs").select("id, action, occurred_on, created_at, before_state, after_state").eq("container_id", containerId).order("occurred_on", { ascending: false }).order("id", { ascending: false }),
      db.from("branches").select("id, name"),
      db.from("customers").select("id, name"),
      db.from("handheld_import_rows").select("action, occurred_on").eq("container_id", containerId).eq("status", "applied")
    ]);
    const failed = [container, audits, branches, customers, imported].find((result) => result.error);
    if (failed?.error) throw new Error(failed.error.message);
    const branchNames = new Map((branches.data ?? []).map((item) => [item.id, item.name]));
    const customerNames = new Map((customers.data ?? []).map((item) => [item.id, item.name]));
    const importedKeys = new Set((imported.data ?? []).map((item) => `${item.action}:${item.occurred_on}`));
    const history = (audits.data ?? []).map((audit) => ({
      id: audit.id,
      occurredOn: audit.occurred_on,
      action: audit.action,
      actionLabel: actionLabel[audit.action] ?? audit.action,
      from: location((audit.before_state ?? {}) as State, branchNames, customerNames),
      to: location((audit.after_state ?? {}) as State, branchNames, customerNames),
      source: importedKeys.has(`${audit.action}:${audit.occurred_on}`) ? "ハンディCSV" : "画面入力",
      registeredAt: audit.created_at
    }));
    return NextResponse.json({ container: container.data, history });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "移動履歴を読み込めませんでした。" }, { status: 500 });
  }
}
