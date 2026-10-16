import { NextRequest, NextResponse } from "next/server";
import { createMonthlyUsageCharge } from "@/lib/container-service";
export async function POST(request: NextRequest) {
  try { const { loanId, billingMonth } = await request.json(); if (!loanId || !billingMonth) return NextResponse.json({ error: "貸出IDと対象月は必須です。" }, { status: 400 }); return NextResponse.json({ charge: await createMonthlyUsageCharge(loanId, billingMonth) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "計算に失敗しました。" }, { status: 400 }); }
}
