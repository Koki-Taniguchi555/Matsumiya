import { adminClient } from "@/lib/supabase";
import { billingMonthRange, isLoanInBillingMonth, previewMonthlyUsageCharge, type BillingLoan } from "@/lib/monthly-billing";

export type LifecycleAction = "received" | "delivered" | "recovered" | "supplier_return";

export async function recordLifecycleAction(input: {
  containerId: string; action: LifecycleAction; occurredOn: string; customerId?: string; branchId?: string; actorId?: string; supplierId?: string;
}) {
  const db = adminClient();
  const { error } = await db.rpc("record_container_lifecycle", {
    p_container_id: input.containerId, p_action: input.action, p_occurred_on: input.occurredOn,
    p_customer_id: input.customerId ?? null, p_handled_branch_id: input.branchId ?? null,
    p_actor_id: input.actorId ?? null, p_supplier_id: input.supplierId ?? null
  });
  if (error) throw new Error(error.message);
}

/** Locks a monthly calculation. Calling it for the same loan/month is rejected by the database. */
export async function createMonthlyUsageCharge(loanId: string, billingMonth: string) {
  const db = adminClient();
  const { data, error } = await db.rpc("calculate_monthly_usage_charge", { p_loan_id: loanId, p_billing_month: billingMonth });
  if (error) throw new Error(error.message);
  return data;
}

export type MonthlyBillingItem = {
  loanId: string; containerId: string; containerSerialNumber: string; managementNumber: string | null;
  customerId: string; customerName: string; deliveredOn: string; recoveredOn: string | null;
  billableDays: number; amountYen: number; calculated: boolean; calculatedAt: string | null;
};

/** Lists every loan that overlaps the selected month, including zero-yen rows for review. */
export async function listMonthlyUsageCharges(billingMonth: string) {
  const { billingMonth: normalizedMonth, firstDay, lastDay } = billingMonthRange(billingMonth);
  const db = adminClient();
  const [loans, charges] = await Promise.all([
    db.from("container_loans").select("id, container_id, customer_id, delivered_on, recovered_on").lte("delivered_on", lastDay).or(`recovered_on.is.null,recovered_on.gte.${firstDay}`).order("delivered_on"),
    db.from("usage_charges").select("loan_id, billable_days, amount_yen, calculated_at").eq("billing_month", normalizedMonth)
  ]);
  if (loans.error) throw new Error(loans.error.message);
  if (charges.error) throw new Error(charges.error.message);
  const rows = loans.data ?? [];
  const [containers, customers] = await Promise.all([
    rows.length ? db.from("containers").select("id, serial_number, management_number").in("id", [...new Set(rows.map((row) => row.container_id))]) : Promise.resolve({ data: [], error: null }),
    rows.length ? db.from("customers").select("id, name").in("id", [...new Set(rows.map((row) => row.customer_id))]) : Promise.resolve({ data: [], error: null })
  ]);
  if (containers.error || customers.error) throw new Error(containers.error?.message ?? customers.error?.message);
  const containerById = new Map((containers.data ?? []).map((item) => [item.id, item]));
  const customerById = new Map((customers.data ?? []).map((item) => [item.id, item]));
  const chargeByLoan = new Map((charges.data ?? []).map((item) => [item.loan_id, item]));
  const items: MonthlyBillingItem[] = rows.map((row) => {
    const loan: BillingLoan = { id: row.id, containerId: row.container_id, customerId: row.customer_id, deliveredOn: row.delivered_on, recoveredOn: row.recovered_on };
    const preview = previewMonthlyUsageCharge(loan, billingMonth);
    const charge = chargeByLoan.get(row.id);
    return {
      loanId: row.id, containerId: row.container_id, containerSerialNumber: containerById.get(row.container_id)?.serial_number ?? "容器（削除済み）",
      managementNumber: containerById.get(row.container_id)?.management_number ?? null, customerId: row.customer_id,
      customerName: customerById.get(row.customer_id)?.name ?? "得意先（削除済み）", deliveredOn: row.delivered_on, recoveredOn: row.recovered_on,
      billableDays: charge?.billable_days ?? preview.billableDays, amountYen: charge?.amount_yen ?? preview.amountYen,
      calculated: !!charge, calculatedAt: charge?.calculated_at ?? null
    };
  }).filter((item) => isLoanInBillingMonth({ id: item.loanId, containerId: item.containerId, customerId: item.customerId, deliveredOn: item.deliveredOn, recoveredOn: item.recoveredOn }, billingMonth));
  items.sort((a, b) => a.customerName.localeCompare(b.customerName, "ja") || a.containerSerialNumber.localeCompare(b.containerSerialNumber, "ja"));
  return { billingMonth: normalizedMonth, items };
}

export async function confirmMonthlyUsageCharges(loanIds: string[], billingMonth: string) {
  const listing = await listMonthlyUsageCharges(billingMonth);
  const selectable = new Set(listing.items.filter((item) => !item.calculated).map((item) => item.loanId));
  const requested = [...new Set(loanIds)];
  if (!requested.length) throw new Error("確定対象が選択されていません。");
  const invalid = requested.filter((id) => !selectable.has(id));
  if (invalid.length) throw new Error("対象月に確定できない貸出が含まれています。画面を再読み込みしてください。");
  const settled: string[] = [];
  const errors: { loanId: string; error: string }[] = [];
  for (const loanId of requested) {
    try { await createMonthlyUsageCharge(loanId, billingMonth); settled.push(loanId); }
    catch (error) { errors.push({ loanId, error: error instanceof Error ? error.message : "確定に失敗しました。" }); }
  }
  return { settled, errors };
}
