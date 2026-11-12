import { NextRequest, NextResponse } from "next/server";
import { requireAuthorizedUser, canManageMasters } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthorizedUser();
    if (!user) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (!canManageMasters(user)) return NextResponse.json({ error: "履歴順の訂正は管理者のみ行えます。" }, { status: 403 });
    const { containerId, occurredOn, orderedAuditIds, reason } = await request.json() as {
      containerId?: string; occurredOn?: string; orderedAuditIds?: number[]; reason?: string;
    };
    if (!containerId || !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn ?? "")) throw new Error("容器と対象日を指定してください。");
    if (!Array.isArray(orderedAuditIds) || orderedAuditIds.length < 2 || orderedAuditIds.length > 100 ||
        orderedAuditIds.some(id => !Number.isSafeInteger(id) || id < 1) ||
        new Set(orderedAuditIds).size !== orderedAuditIds.length) {
      throw new Error("対象日の移動履歴を重複なく2件以上指定してください。");
    }
    const note = (reason ?? "").trim();
    if (note.length < 3 || note.length > 1000) throw new Error("訂正理由を3〜1000文字で入力してください。");
    const db = adminClient();
    const [audits, existing] = await Promise.all([
      db.from("container_audit_logs").select("id, action").eq("container_id", containerId).eq("occurred_on", occurredOn).order("id", { ascending: true }),
      db.from("container_history_order_reviews").select("ordered_audit_ids").eq("container_id", containerId).eq("occurred_on", occurredOn).order("reviewed_at", { ascending: false }).limit(1)
    ]);
    if (audits.error || existing.error) throw new Error(audits.error?.message ?? existing.error?.message);
    const auditIds = (audits.data ?? []).map(row => Number(row.id));
    if (auditIds.length !== orderedAuditIds.length ||
        auditIds.some(id => !orderedAuditIds.includes(id))) {
      return NextResponse.json({ error: "現在の履歴が変更されています。再検索後に訂正してください。" }, { status: 409 });
    }
    const previous = (existing.data?.[0]?.ordered_audit_ids as number[] | undefined) ?? auditIds;
    if (previous.every((id, i) => id === orderedAuditIds[i])) {
      return NextResponse.json({ error: "現在の順序から変更されていません。" }, { status: 400 });
    }
    const saved = await db.from("container_history_order_reviews").insert({
      container_id: containerId, occurred_on: occurredOn,
      ordered_audit_ids: orderedAuditIds, previous_audit_ids: previous,
      reason: note, reviewed_by: user.id
    }).select("id, reviewed_at").single();
    if (saved.error) throw new Error(saved.error.message);
    return NextResponse.json({ ok: true, reviewId: saved.data?.id, warning: "履歴の表示順のみ訂正しました。元の監査ログ、容器状態、貸出・使用料計算には反映されません。" }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "履歴順を保存できませんでした。" }, { status: 400 });
  }
}
