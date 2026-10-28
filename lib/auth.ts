import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { type AppRole, type AuthorizedUser } from "@/lib/auth-policy";
import { adminClient } from "@/lib/supabase";

export type { AppRole, AuthorizedUser } from "@/lib/auth-policy";

function authSettings() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabaseの公開認証設定がありません。");
  return { url, key };
}

export async function createAuthServerClient() {
  const cookieStore = await cookies();
  const { url, key } = authSettings();
  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(items) {
        try { items.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
        catch { /* Server Components cannot write cookies; middleware refreshes them. */ }
      }
    }
  });
}

export async function requireAuthorizedUser(): Promise<AuthorizedUser | null> {
  const supabase = await createAuthServerClient();
  const { data: claimsResult, error } = await supabase.auth.getClaims();
  const subject = claimsResult?.claims?.sub;
  const email = claimsResult?.claims?.email;
  if (error || typeof subject !== "string" || typeof email !== "string") return null;

  const { data: profile, error: profileError } = await adminClient()
    .from("app_user_profiles")
    .select("email, role, branch_id")
    .eq("user_id", subject)
    .maybeSingle();
  if (profileError || !profile) return null;
  return { id: subject, email: profile.email, role: profile.role as AppRole, branchId: profile.branch_id };
}

export { canCalculateCharges, canManageMasters, canRecordLifecycle } from "@/lib/auth-policy";

export async function provisionInitialAdmin(userId: string, email: string) {
  const configured = process.env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  if (!configured) throw new Error("初期管理者メールアドレスが設定されていません。");
  if (email.trim().toLowerCase() !== configured) return false;
  const db = adminClient();
  const existing = await db.from("app_user_profiles").select("user_id, email").eq("user_id", userId).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (!existing.data) {
    const profile = await db.from("app_user_profiles").insert({ user_id: userId, email: configured, role: "admin", branch_id: null });
    if (profile.error) throw new Error(profile.error.message);
    const audit = await db.from("app_access_audit_logs").insert({ user_id: userId, event_type: "role_assigned", details: { role: "admin", source: "initial_admin" } });
    if (audit.error) throw new Error(audit.error.message);
  }
  return true;
}

export async function writeAccessAudit(userId: string | null, eventType: "login" | "login_rejected", details: Record<string, unknown> = {}) {
  const { error } = await adminClient().from("app_access_audit_logs").insert({ user_id: userId, event_type: eventType, details });
  if (error) throw new Error(error.message);
}
