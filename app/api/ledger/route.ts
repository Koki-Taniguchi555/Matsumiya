import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase";

export async function GET() {
  try {
    const db = adminClient();
    const [containers, branches, customers, owners, gases, inspections] = await Promise.all([
      db.from("containers").select("id, serial_number, management_number, barcode, container_type, container_form, status, condition, capacity_value, capacity_unit, pressure_test_due_month, current_branch_id, current_customer_id, branches(name), customers(name), container_owners(name), gas_types(name)").order("serial_number").limit(100),
      db.from("branches").select("id, name").order("name"),
      db.from("customers").select("id, name").order("name"),
      db.from("container_owners").select("id, code, name, kind").order("code"),
      db.from("gas_types").select("id, code, name, basic_unit").order("code"),
      db.from("inspection_providers").select("id, code, name").order("code")
    ]);
    const failed = [containers, branches, customers, owners, gases, inspections].find((result) => result.error);
    if (failed?.error) throw new Error(failed.error.message);
    return NextResponse.json({ containers: containers.data, masters: { branches: branches.data, customers: customers.data, owners: owners.data, gases: gases.data, inspections: inspections.data } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "台帳を読み込めませんでした。" }, { status: 500 });
  }
}
