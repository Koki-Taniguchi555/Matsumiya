import { NextRequest, NextResponse } from "next/server";
import { requireAuthorizedUser } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";

type ContainerRow = {
  id: string; serial_number: string; management_number: string | null; status: string;
  current_branch_id: string | null; owner_id: string | null; gas_type_id: string | null;
  pressure_test_due_month: string | null;
};
type SessionRow = { id: string; branch_id: string; counted_on: string; status: string };

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthorizedUser();
    if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    const month = request.nextUrl.searchParams.get("month");
    if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ error: "対象年月を選択してください。" }, { status: 400 });
    }
    const db = adminClient();
    const [containersResult, branchesResult, ownersResult, gasesResult, sessionsResult] = await Promise.all([
      db.from("containers").select("id,serial_number,management_number,status,current_branch_id,owner_id,gas_type_id,pressure_test_due_month").order("serial_number").limit(10000),
      db.from("branches").select("id,name"),
      db.from("container_owners").select("id,name"),
      db.from("gas_types").select("id,name"),
      db.from("inventory_sessions").select("id,branch_id,counted_on,status").gte("counted_on", `${month}-01`).lt("counted_on", nextMonth(month)).order("counted_on", { ascending: false }).limit(1000)
    ]);
    const failure = [containersResult, branchesResult, ownersResult, gasesResult, sessionsResult].find(item => item.error);
    if (failure?.error) throw new Error(failure.error.message);
    const containers = (containersResult.data ?? []) as ContainerRow[];
    const sessions = (sessionsResult.data ?? []) as SessionRow[];
    const names = (items: { id: string; name: string }[]) => new Map(items.map(item => [item.id, item.name]));
    const branchNames = names(branchesResult.data ?? []);
    const ownerNames = names(ownersResult.data ?? []);
    const gasNames = names(gasesResult.data ?? []);
    const grouped = new Map<string, { owner: string; branch: string; gas: string; count: number }>();
    for (const container of containers.filter(item => item.status === "in_stock")) {
      const owner = ownerNames.get(container.owner_id ?? "") ?? "未設定";
      const branch = branchNames.get(container.current_branch_id ?? "") ?? "所属未設定";
      const gas = gasNames.get(container.gas_type_id ?? "") ?? "未設定";
      const key = JSON.stringify([owner, branch, gas]);
      const item = grouped.get(key) ?? { owner, branch, gas, count: 0 };
      item.count++;
      grouped.set(key, item);
    }
    const inventory = [...grouped.values()].sort((a, b) => a.owner.localeCompare(b.owner, "ja") || a.branch.localeCompare(b.branch, "ja") || a.gas.localeCompare(b.gas, "ja"));
    const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
    const threshold = new Date(monthEnd);
    threshold.setUTCMonth(threshold.getUTCMonth() + 3);
    const dateText = (date: Date) => date.toISOString().slice(0, 10);
    const alerts = containers.filter(item => item.pressure_test_due_month && item.pressure_test_due_month <= dateText(threshold))
      .map(item => ({
        serialNumber: item.serial_number, managementNumber: item.management_number,
        branch: branchNames.get(item.current_branch_id ?? "") ?? "所在地未設定",
        due: item.pressure_test_due_month!,
        kind: item.pressure_test_due_month! <= dateText(monthEnd) ? "期限到来・超過" : "3か月以内"
      })).sort((a, b) => a.due.localeCompare(b.due) || a.serialNumber.localeCompare(b.serialNumber));
    const scanResults = await Promise.all(sessions.map(session => db.from("inventory_scan_items").select("container_id").eq("session_id", session.id)));
    const scanError = scanResults.find(result => result.error);
    if (scanError?.error) throw new Error(scanError.error.message);
    const inventorySessions = sessions.map((session, i) => {
      const expected = containers.filter(item => item.status === "in_stock" && item.current_branch_id === session.branch_id);
      const ids = new Set((scanResults[i].data ?? []).map(item => item.container_id));
      const expectedIds = new Set(expected.map(item => item.id));
      return {
        id: session.id, branch: branchNames.get(session.branch_id) ?? "営業所不明",
        countedOn: session.counted_on, status: session.status, expected: expected.length, scanned: ids.size,
        missing: expected.filter(item => !ids.has(item.id)).length,
        unexpected: [...ids].filter(id => !expectedIds.has(id)).length
      };
    });
    return NextResponse.json({
      month, snapshotNote: "在庫・耐圧期限は照会時点の台帳状態です。月末時点の履歴再現ではありません。棚卸差異も現在の台帳との比較です。",
      inventory, inventoryTotal: inventory.reduce((total, item) => total + item.count, 0),
      alerts, inventorySessions
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "月次データを読み込めませんでした。" }, { status: 500 });
  }
}

function nextMonth(month: string) {
  const year = Number(month.slice(0, 4));
  const number = Number(month.slice(5, 7));
  return number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, "0")}-01`;
}
