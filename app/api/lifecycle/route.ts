import { NextRequest, NextResponse } from "next/server";
import { canRecordLifecycle, requireAuthorizedUser } from "@/lib/auth";
import { recordLifecycleAction } from "@/lib/container-service";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body.containerId || !body.action || !body.occurredOn) return NextResponse.json({ error: "容器、処理、処理日は必須です。" }, { status: 400 });
    const user = await requireAuthorizedUser();
    if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (!canRecordLifecycle(user, body.branchId)) return NextResponse.json({ error: "この営業所の移動処理を登録する権限がありません。" }, { status: 403 });
    await recordLifecycleAction({ ...body, actorId: user.id });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "登録に失敗しました。" }, { status: 400 }); }
}
