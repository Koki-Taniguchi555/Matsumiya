"use client";
import { FormEvent, useState } from "react";

export default function Home() {
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice("登録中です…");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/lifecycle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    setNotice(response.ok ? "登録しました。監査履歴にも記録されています。" : `登録できませんでした: ${(await response.json()).error}`);
  }
  async function calculateCharge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice("使用料を計算中です…");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch("/api/usage-charges", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
    const result = await response.json();
    setNotice(response.ok ? `計算を確定しました: ${result.charge.amount_yen.toLocaleString()}円（対象 ${result.charge.billable_days}日）` : `計算できませんでした: ${result.error}`);
  }
  return <main><h1>容器管理</h1><p className="muted">入荷・納品・回収と使用料計算を一元管理します。</p>
    <div className="grid"><section><h2>容器の移動を登録</h2><form onSubmit={submit}><label>容器ID<input name="containerId" required placeholder="UUID" /></label><label>処理<select name="action"><option value="received">入荷</option><option value="delivered">納品</option><option value="recovered">回収</option></select></label><label>処理日<input name="occurredOn" type="date" required /></label><label>顧客ID（納品・回収）<input name="customerId" placeholder="UUID" /></label><label>営業所ID（入荷）<input name="branchId" placeholder="UUID" /></label><button>登録する</button></form></section>
    <section><h2>使用料計算</h2><p className="muted">93日間無料。94日目以降は31日あたり600円を日割りし、月次で切り捨てます。回収日を含めて計算します。</p><form onSubmit={calculateCharge}><label>貸出ID<input name="loanId" required placeholder="UUID" /></label><label>対象月<input name="billingMonth" type="month" required /></label><button>月次使用料を確定</button></form><p className="muted">同じ貸出・対象月の計算済みデータは再実行できません。</p></section></div><p id="notice" role="status">{notice}</p></main>;
}
