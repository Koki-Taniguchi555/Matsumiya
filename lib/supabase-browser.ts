"use client";

import { createBrowserClient } from "@supabase/ssr";

export function createAuthBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabaseの公開認証設定がありません。");
  return createBrowserClient(url, key);
}
