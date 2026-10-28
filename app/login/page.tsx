"use client";

import { FormEvent, useState } from "react";
import { createAuthBrowserClient } from "@/lib/supabase-browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const { error } = await createAuthBrowserClient().auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: true }
      });
      if (error) throw error;
      setMessage("ログイン用リンクを送信しました。メールを開いてログインを完了してください。");
    } catch (error) {
      setMessage(error instanceof Error ? `送信できませんでした: ${error.message}` : "ログイン用リンクを送信できませんでした。");
    } finally { setSubmitting(false); }
  }

  return <main className="loginShell"><section className="loginCard"><p className="loginCompany">松宮工材</p><h1>容器管理システム</h1><p>登録済みのメールアドレスへ、パスワード不要のログイン用リンクを送信します。</p><form onSubmit={submit}><label>メールアドレス<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="name@example.com" /></label><button className="actionButton" disabled={submitting}>{submitting ? "送信中…" : "ログイン用リンクを送信"}</button></form>{message && <p className="loginMessage" role="status">{message}</p>}</section></main>;
}
