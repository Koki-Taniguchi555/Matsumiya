import { NextRequest, NextResponse } from "next/server";
import { createAuthServerClient, provisionInitialAdmin, writeAccessAudit } from "@/lib/auth";

function redirect(request: NextRequest, path: string) { return NextResponse.redirect(new URL(path, request.url)); }

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return redirect(request, "/login?error=missing_code");
  try {
    const supabase = await createAuthServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user?.email) throw userError ?? new Error("ログイン情報を確認できませんでした。");
    const allowed = await provisionInitialAdmin(user.id, user.email);
    if (!allowed) {
      await writeAccessAudit(user.id, "login_rejected", { email: user.email.toLowerCase() });
      await supabase.auth.signOut();
      return redirect(request, "/login?error=not_authorized");
    }
    await writeAccessAudit(user.id, "login", { email: user.email.toLowerCase() });
    return redirect(request, "/");
  } catch {
    return redirect(request, "/login?error=callback_failed");
  }
}
