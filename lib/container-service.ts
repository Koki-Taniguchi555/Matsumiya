import { adminClient } from "@/lib/supabase";

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
