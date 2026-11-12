import { NextRequest, NextResponse } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth";
import { findSequenceErrors, movementActionLabel } from "@/lib/movement-sequence";
import { adminClient } from "@/lib/supabase";

type State = { current_branch_id?: string | null; current_customer_id?: string | null };

function location(state: State, branches: Map<string, string>, customers: Map<string, string>) {
  if (state.current_branch_id) return branches.get(state.current_branch_id) ?? "営業所（削除済み）";
  if (state.current_customer_id) return customers.get(state.current_customer_id) ?? "顧客（削除済み）";
  return "－";
}

export async function GET(request: NextRequest) {
  try {
    if (!await requireAuthorizedUser()) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    const containerId = request.nextUrl.searchParams.get("containerId");
    const customerId = request.nextUrl.searchParams.get("customerId");
    const supplierId = request.nextUrl.searchParams.get("supplierId");
    const handledBranchId = request.nextUrl.searchParams.get("handledBranchId");
    const db = adminClient();
    let auditQuery = db.from("container_audit_logs").select("id, container_id, action, occurred_on, created_at, before_state, after_state, handled_branch_id, customer_id, supplier_id");
    if (containerId) auditQuery = auditQuery.eq("container_id", containerId);
    if (customerId) auditQuery = auditQuery.eq("customer_id", customerId);
    if (supplierId) auditQuery = auditQuery.eq("supplier_id", supplierId);
    if (handledBranchId) auditQuery = auditQuery.eq("handled_branch_id", handledBranchId);
    const [audits, branches, customers, suppliers, imported] = await Promise.all([
      auditQuery.order("occurred_on", { ascending: true }).order("id", { ascending: true }).limit(500),
      db.from("branches").select("id, name"),
      db.from("customers").select("id, name"),
      db.from("suppliers").select("id, name"),
      containerId ? db.from("handheld_import_rows").select("action, occurred_on").eq("container_id", containerId).eq("status", "applied") : Promise.resolve({ data: [], error: null })
    ]);
    const failed = [audits, branches, customers, suppliers, imported].find((result) => result.error);
    if (failed?.error) throw new Error(failed.error.message);
    const branchNames = new Map((branches.data ?? []).map((item) => [item.id, item.name]));
    const customerNames = new Map((customers.data ?? []).map((item) => [item.id, item.name]));
    const supplierNames = new Map((suppliers.data ?? []).map((item) => [item.id, item.name]));
    const importedKeys = new Set((imported.data ?? []).map((item) => `${item.action}:${item.occurred_on}`));
    const containerIds = [...new Set((audits.data ?? []).map((audit) => audit.container_id))];
    const [containers, allContainerAudits] = await Promise.all([
      containerIds.length ? db.from("containers").select("id, serial_number, management_number, barcode").in("id", containerIds) : Promise.resolve({ data: [], error: null }),
      containerIds.length ? db.from("container_audit_logs").select("id, container_id, action, occurred_on").in("container_id", containerIds).order("occurred_on", { ascending: true }).order("id", { ascending: true }) : Promise.resolve({ data: [], error: null })
    ]);
    if (containers.error || allContainerAudits.error) throw new Error(containers.error?.message ?? allContainerAudits.error?.message);
    const reviews = containerIds.length
      ? await db.from("container_history_order_reviews").select("container_id, occurred_on, ordered_audit_ids, reason, reviewed_at")
          .in("container_id", containerIds).order("reviewed_at", { ascending: false }).limit(1000)
      : { data: [], error: null };
    if (reviews.error) throw new Error(reviews.error.message);
    const latestReviews = new Map<string, { ordered_audit_ids: number[]; reason: string }>();
    for (const item of reviews.data ?? []) {
      const key = `${item.container_id}:${item.occurred_on}`;
      if (!latestReviews.has(key)) latestReviews.set(key, item);
    }
    const orderIndex = (item: { id: number; container_id: string; occurred_on: string }) => {
      const selected = latestReviews.get(`${item.container_id}:${item.occurred_on}`)?.ordered_audit_ids;
      return selected ? selected.indexOf(Number(item.id)) : -1;
    };
    const sortAudits = <T extends { id: number; container_id: string; occurred_on: string }>(items: T[]) => [...items].sort((a, b) => {
      const byDate = a.occurred_on.localeCompare(b.occurred_on);
      if (byDate) return byDate;
      if (a.container_id !== b.container_id) return a.container_id.localeCompare(b.container_id);
      const aPos = orderIndex(a);
      const bPos = orderIndex(b);
      return aPos >= 0 && bPos >= 0 ? aPos - bPos : Number(a.id) - Number(b.id);
    });
    const containerMap = new Map((containers.data ?? []).map((item) => [item.id, item]));
    const sequenceErrors = new Map<number, string>();
    const auditsByContainer = new Map<string, { id: number; action: string }[]>();
    for (const audit of sortAudits(allContainerAudits.data ?? [])) auditsByContainer.set(audit.container_id, [...(auditsByContainer.get(audit.container_id) ?? []), audit]);
    for (const items of auditsByContainer.values()) findSequenceErrors(items).forEach((error, index) => { if (error) sequenceErrors.set(items[index].id, error); });
    const history = sortAudits(audits.data ?? []).map((audit) => {
      const before = (audit.before_state ?? {}) as State;
      const after = (audit.after_state ?? {}) as State;
      const supplier = audit.supplier_id ? supplierNames.get(audit.supplier_id) ?? "仕入れ先（削除済み）" : "－";
      const from = audit.action === "received" ? supplier : location(before, branchNames, customerNames);
      const to = audit.action === "supplier_return" ? supplier : location(after, branchNames, customerNames);
      const container = containerMap.get(audit.container_id);
      return {
        id: audit.id, containerId: audit.container_id, containerSerialNumber: container?.serial_number ?? "容器（削除済み）",
        managementNumber: container?.management_number ?? null, occurredOn: audit.occurred_on, action: audit.action,
        actionLabel: movementActionLabel[audit.action as keyof typeof movementActionLabel] ?? audit.action,
        from, to, customer: audit.customer_id ? customerNames.get(audit.customer_id) ?? "得意先（削除済み）" : "－",
        supplier, handledBranch: audit.handled_branch_id ? branchNames.get(audit.handled_branch_id) ?? "営業所（削除済み）" : "－",
        source: importedKeys.has(`${audit.action}:${audit.occurred_on}`) ? "ハンディCSV" : "画面入力",
        registeredAt: audit.created_at, sequenceError: sequenceErrors.get(audit.id) ?? null,
        orderAdjusted: latestReviews.has(`${audit.container_id}:${audit.occurred_on}`)
      };
    }).reverse();
    return NextResponse.json({ history });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "移動履歴を読み込めませんでした。" }, { status: 500 });
  }
}
