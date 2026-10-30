import { NextRequest, NextResponse } from "next/server";
import { canCalculateCharges, requireAuthorizedUser } from "@/lib/auth";
import { confirmMonthlyUsageCharges, createMonthlyUsageCharge, listMonthlyUsageCharges } from "@/lib/container-service";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthorizedUser();
    if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (!canCalculateCharges(user)) return NextResponse.json({ error: "使用料照会は管理者のみ利用できます。" }, { status: 403 });
    const billingMonth = request.nextUrl.searchParams.get("billingMonth");
    if (!billingMonth) return NextResponse.json({ error: "対象年月は必須です。" }, { status: 400 });
    const result = await listMonthlyUsageCharges(billingMonth);
    const summary = result.items.reduce((total, item) => ({ count: total.count + 1, pending: total.pending + (item.calculated ? 0 : 1), calculated: total.calculated + (item.calculated ? 1 : 0), amountYen: total.amountYen + item.amountYen }), { count: 0, pending: 0, calculated: 0, amountYen: 0 });
    return NextResponse.json({ ...result, summary });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "使用料一覧を読み込めませんでした。" }, { status: 400 }); }
}

export async function POST(request: NextRequest) {
  try { const user = await requireAuthorizedUser(); if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 }); if (!canCalculateCharges(user)) return NextResponse.json({ error: "使用料計算は管理者のみ実行できます。" }, { status: 403 }); const body = await request.json(); const { loanId, billingMonth, loanIds, action } = body; if (!billingMonth) return NextResponse.json({ error: "対象年月は必須です。" }, { status: 400 }); if (action === "confirm") return NextResponse.json(await confirmMonthlyUsageCharges(Array.isArray(loanIds) ? loanIds : [], billingMonth), { status: 201 }); if (!loanId) return NextResponse.json({ error: "貸出IDまたは確定対象が必要です。" }, { status: 400 }); return NextResponse.json({ charge: await createMonthlyUsageCharge(loanId, billingMonth) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "計算に失敗しました。" }, { status: 400 }); }
}
