import { NextRequest, NextResponse } from "next/server";
import { requiredText, type MasterKind } from "@/lib/master-validation";
import { adminClient } from "@/lib/supabase";

const ownerKinds = new Set(["self", "manufacturer", "user", "other"]);
const containerForms = new Set(["single", "valve_equipped", "lgc", "cardle", "cardle_assembly", "cardle_product", "cardle_frame"]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const kind = body.kind as MasterKind;
    const db = adminClient();
    let result;

    switch (kind) {
      case "branch":
        result = await db.from("branches").insert({ name: requiredText(body.name, "営業所名") }).select("id, name").single();
        break;
      case "customer":
        result = await db.from("customers").insert({ name: requiredText(body.name, "顧客名") }).select("id, name").single();
        break;
      case "owner": {
        const ownerKind = String(body.ownerKind ?? "");
        if (!ownerKinds.has(ownerKind)) throw new Error("保有者区分が不正です。");
        result = await db.from("container_owners").insert({ code: requiredText(body.code, "保有者コード"), name: requiredText(body.name, "保有者名"), kind: ownerKind }).select("id, code, name, kind").single();
        break;
      }
      case "gas":
        result = await db.from("gas_types").insert({ code: requiredText(body.code, "ガス種コード"), name: requiredText(body.name, "ガス種名"), basic_unit: String(body.basicUnit || "本").trim() || "本" }).select("id, code, name, basic_unit").single();
        break;
      case "inspection":
        result = await db.from("inspection_providers").insert({ code: requiredText(body.code, "検査先コード"), name: requiredText(body.name, "検査先名"), phone: typeof body.phone === "string" ? body.phone.trim() || null : null }).select("id, code, name").single();
        break;
      case "container": {
        const form = String(body.containerForm || "single");
        if (!containerForms.has(form)) throw new Error("容器形態が不正です。");
        result = await db.from("containers").insert({
          serial_number: requiredText(body.serialNumber, "瓶号"),
          container_type: requiredText(body.containerType, "容器種別"),
          management_number: typeof body.managementNumber === "string" ? body.managementNumber.trim() || null : null,
          barcode: typeof body.barcode === "string" ? body.barcode.trim() || null : null,
          owner_id: typeof body.ownerId === "string" && body.ownerId ? body.ownerId : null,
          gas_type_id: typeof body.gasTypeId === "string" && body.gasTypeId ? body.gasTypeId : null,
          current_branch_id: typeof body.branchId === "string" && body.branchId ? body.branchId : null,
          container_form: form,
          capacity_value: body.capacityValue ? Number(body.capacityValue) : null,
          capacity_unit: typeof body.capacityUnit === "string" ? body.capacityUnit.trim() || null : null,
          pressure_test_due_month: typeof body.pressureTestDueMonth === "string" && body.pressureTestDueMonth ? `${body.pressureTestDueMonth}-01` : null,
          notes: typeof body.notes === "string" ? body.notes.trim() || null : null
        }).select("id, serial_number, barcode").single();
        break;
      }
      default:
        throw new Error("登録対象が不正です。");
    }
    if (result.error) throw new Error(result.error.message);
    return NextResponse.json({ item: result.data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "マスタを登録できませんでした。" }, { status: 400 });
  }
}
