import { NextRequest, NextResponse } from "next/server";
import { recordLifecycleAction } from "@/lib/container-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.containerId || !body.action || !body.occurredOn) return NextResponse.json({ error: "容器、処理、処理日は必須です。" }, { status: 400 });
    await recordLifecycleAction(body);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "登録に失敗しました。" }, { status: 400 }); }
}
