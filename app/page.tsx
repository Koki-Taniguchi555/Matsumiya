"use client";

import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { handheldCsvTemplate } from "@/lib/handheld-import";

type Choice = { id: string; name: string; code?: string };
type Masters = { branches: Choice[]; customers: Choice[]; suppliers: Choice[]; owners: Choice[]; gases: Choice[]; inspections: Choice[] };
type Container = { id: string; serial_number: string; management_number?: string | null; barcode?: string | null; container_type: string; container_form: string; status: string; condition: string; capacity_value?: number | null; capacity_unit?: string | null; pressure_test_due_month?: string | null; branches?: { name: string } | null; customers?: { name: string } | null; container_owners?: { name: string } | null; gas_types?: { name: string } | null };
type HistoryItem = { id: number; containerId: string; containerSerialNumber: string; managementNumber?: string | null; occurredOn: string; action: string; actionLabel: string; from: string; to: string; customer: string; supplier: string; handledBranch: string; source: string; registeredAt: string; sequenceError: string | null; orderAdjusted?: boolean };
type HistoryResult = { history: HistoryItem[] };
type MonthlyBillingItem = { loanId: string; containerId: string; containerSerialNumber: string; managementNumber: string | null; customerId: string; customerName: string; deliveredOn: string; recoveredOn: string | null; billableDays: number; amountYen: number; calculated: boolean; calculatedAt: string | null };
type MonthlyBillingResult = { billingMonth: string; items: MonthlyBillingItem[]; summary: { count: number; pending: number; calculated: number; amountYen: number } };
type CustomerBillingSummary = { customerId: string; customerName: string; count: number; amountYen: number; confirmed: number };
type InventoryDifference = { expected: number; scanned: number; missing: { id: string; serial_number: string; management_number?: string | null }[]; unexpected: { container_id: string; containers?: { serial_number: string; management_number?: string | null } | null }[] };
type MonthlyReport = { month: string; snapshotNote: string; inventoryTotal: number; inventory: { owner: string; branch: string; gas: string; count: number }[]; alerts: { serialNumber: string; managementNumber: string | null; branch: string; due: string; kind: string }[]; inventorySessions: { id: string; branch: string; countedOn: string; status: string; expected: number; scanned: number; missing: number; unexpected: number }[] };
type ReconciliationBatch = { id: string; source_filename: string; created_at: string; total_rows: number; applied_rows: number; error_rows: number; status: string };
type ReconciliationRow = { id: number; lineNumber: number; action: string | null; barcode: string | null; serialNumber: string; occurredOn: string | null; status: string; customer: string; supplier: string; branch: string; referenceNumber: string; gasName: string; capacity: string; capacityUnit: string; error: string | null; issues: string[]; decision: "matched" | "hold" | "unreviewed"; note: string; checkedAt: string | null };
type ReconciliationResult = { batch: ReconciliationBatch; rows: ReconciliationRow[]; finalized: { finalized_at: string; finalized_by: string; note: string } | null; summary: { applied: number; errors: number; matched: number; held: number; unreviewed: number } };
type SalesBatch = { id:string; source_filename?:string; created_at?:string; total_rows?:number; finalizedAt:string };
type SalesCandidate = { id:number;lineNumber:number;deliveredOn:string;referenceNumber:string;customer:string;branch:string;serialNumber:string;gasName:string;quantity:number;unit:string;productCode:string;productName:string;supplier:string;saleUnitPrice:number|null;purchaseUnitPrice:number|null;note:string;confirmed:boolean;confirmedAt:string|null;suggestion:SalesSuggestion|null; quantitySuggestion:{ruleId:string;quantity:number;unit:string;explanation:string}|null;actualFillSuggestion:{quantity:number;unit:string;source:string;standardQuantity:number|null;differsFromStandard:boolean}|null;actualFillWarning:string|null;quantitySource:"rule"|"actual_fill"|"manual";quantityReason:string;quantityRuleId:string|null };
type SalesResult = {batch:{id:string;source_filename:string};candidates:SalesCandidate[];summary:{total:number;confirmed:number;pending:number;totalSalesYen:number}};
type SalesSuggestion = {productCode:string;productName:string;supplier:string;unit:string;saleUnitPrice:number|null;purchaseUnitPrice:number|null;source:string;warnings:string[]};
type SalesMasters = {
 gases:{id:string;code:string;name:string}[];
 customers:{id:string;name:string}[];
 suppliers:{id:string;code:string;name:string}[];
 owners:{id:string;code:string;name:string}[];
 products:{id:string;gas_type_id:string;supplier_id:string|null;owner_id:string|null;product_code:string;product_name:string;unit:string}[];
 prices:{id:string;product_mapping_id:string;price_kind:"sale"|"purchase";customer_id:string|null;supplier_id:string|null;owner_id:string|null;unit_price:number;effective_from:string;effective_until:string|null}[];
 quantities:{id:string;customer_id:string;product_mapping_id:string;billing_unit:string;quantity_per_container:number;effective_from:string;effective_until:string|null}[];
};
type SalesDraft = {productCode:string;productName:string;supplier:string;quantity:string;unit:string;saleUnitPrice:string;purchaseUnitPrice:string;note:string;quantitySource:"rule"|"actual_fill"|"manual";quantityReason:string;quantityRuleId:string|null};
type ImportOutcome = { lineNumber: number; barcode: string; occurredOn: string; action: string; status: string; error: string | null; warnings?: string[] };
type Page = "home" | "ledger" | "history" | "daily" | "handheld" | "inspection" | "billing" | "monthly" | "sales" | "masters";
type MasterKind = "branch" | "customer" | "supplier" | "owner" | "gas" | "inspection" | "container";

const emptyMasters: Masters = { branches: [], customers: [], suppliers: [], owners: [], gases: [], inspections: [] };
const statusLabel: Record<string, string> = { in_stock: "在庫", on_loan: "貸出中", recovered: "回収済", returned_to_supplier: "仕入先返却済" };
const conditionLabel: Record<string, string> = { normal: "正常", stopped: "停滞", lost: "紛失", damaged: "破損", disposed: "廃棄" };
const masterLabels: Record<MasterKind, string> = { branch: "営業所", customer: "得意先", supplier: "仕入先", owner: "保有者", gas: "ガス種", inspection: "検査先", container: "容器" };
const menus: { heading: string; items: [Page, string][] }[] = [
  { heading: "日常業務", items: [["daily", "容器移動入力"], ["handheld", "ハンディ取り込み"]] },
  { heading: "照会", items: [["ledger", "容器台帳照会"], ["history", "容器移動履歴照会"], ["inspection", "検査・保全照会"]] },
  { heading: "請求・月次", items: [["billing", "使用料計算"], ["monthly", "月次処理・帳票"], ["sales", "売上候補確認"]] },
  { heading: "マスタ・設定", items: [["masters", "マスタ一覧"]] }
];

export default function Home() {
  const [page, setPage] = useState<Page>("home");
  const [containers, setContainers] = useState<Container[]>([]);
  const [masters, setMasters] = useState<Masters>(emptyMasters);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [containerText, setContainerText] = useState("");
  const [customerText, setCustomerText] = useState("");
  const [supplierText, setSupplierText] = useState("");
  const [branchText, setBranchText] = useState("");
  const [masterKind, setMasterKind] = useState<MasterKind>("container");
  const [importResult, setImportResult] = useState<{ mode: string; rows: ImportOutcome[]; importId?: string } | null>(null);
  const [importFilter, setImportFilter] = useState<"all" | "applied" | "error">("all");
  const [reconciliationBatches, setReconciliationBatches] = useState<ReconciliationBatch[]>([]);
  const [reconciliationImportId, setReconciliationImportId] = useState("");
  const [reconciliationResult, setReconciliationResult] = useState<ReconciliationResult | null>(null);
  const [reconciliationNotes, setReconciliationNotes] = useState<Record<number, string>>({});
  const [slipChecked, setSlipChecked] = useState<Record<number, boolean>>({});
  const [bulkReconciliationSelected, setBulkReconciliationSelected] = useState<number[]>([]);
  const [bulkPaperSlipConfirmed, setBulkPaperSlipConfirmed] = useState(false);
  const [reconciliationBusy, setReconciliationBusy] = useState(false);
  const [reconciliationMessage, setReconciliationMessage] = useState("");
  const [salesBatches, setSalesBatches] = useState<SalesBatch[]>([]);
  const [salesImportId, setSalesImportId] = useState("");
  const [salesResult, setSalesResult] = useState<SalesResult | null>(null);
  const [salesDraftId, setSalesDraftId] = useState<number | null>(null);
  const [salesDraft, setSalesDraft] = useState<SalesDraft>({productCode:"",productName:"",supplier:"",quantity:"1",unit:"本",saleUnitPrice:"",purchaseUnitPrice:"",note:"",quantitySource:"manual",quantityReason:"",quantityRuleId:null});
  const [salesMasters, setSalesMasters] = useState<SalesMasters|null>(null);
  const [salesMasterTab, setSalesMasterTab] = useState<"product"|"price"|"quantity">("product");
  const [expandedSalesMasterId, setExpandedSalesMasterId] = useState<string | null>(null);
  const [productMasterForm, setProductMasterForm] = useState({gas:"",supplier:"",owner:"",code:"",name:"",unit:"本"});
  const [priceMasterForm, setPriceMasterForm] = useState({product:"",kind:"sale" as "sale"|"purchase",customer:"",supplier:"",owner:"",price:"",from:"",until:""});
  const [quantityMasterForm, setQuantityMasterForm] = useState({customer:"",product:"",unit:"",perContainer:"",from:"",until:""});
  const [salesMasterMessage, setSalesMasterMessage] = useState("");
  const [salesPriceHistory, setSalesPriceHistory] = useState<{date:string;quantity:number;unit:string;salePrice:number;purchasePrice:number;reviewedAt:string}[]>([]);
  const [salesPriceHistoryNote, setSalesPriceHistoryNote] = useState("");
  const [salesBusy, setSalesBusy] = useState(false);
  const [salesMessage, setSalesMessage] = useState("");
  const [historyContainerId, setHistoryContainerId] = useState("");
  const [historyCustomerId, setHistoryCustomerId] = useState("");
  const [historySupplierId, setHistorySupplierId] = useState("");
  const [historyBranchId, setHistoryBranchId] = useState("");
  const [historyContainerText, setHistoryContainerText] = useState("");
  const [historyCustomerText, setHistoryCustomerText] = useState("");
  const [historySupplierText, setHistorySupplierText] = useState("");
  const [historyBranchText, setHistoryBranchText] = useState("");
  const [historyResult, setHistoryResult] = useState<HistoryResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [orderEdit, setOrderEdit] = useState<{ containerId: string; occurredOn: string; orderedIds: number[]; reason: string } | null>(null);
  const [orderSaving, setOrderSaving] = useState(false);
  const [orderMessage, setOrderMessage] = useState("");
  const [billingMonth, setBillingMonth] = useState("");
  const [monthlyMonth, setMonthlyMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [monthlyReport, setMonthlyReport] = useState<MonthlyReport | null>(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyError, setMonthlyError] = useState("");
  const [monthlyTab, setMonthlyTab] = useState<"inventory" | "inspection" | "stocktake" | "sales">("inventory");
  const billingMonthOptions = useMemo(() => { const currentYear = new Date().getFullYear(); return Array.from({ length: 60 }, (_, index) => { const year = currentYear - 3 + Math.floor(index / 12); const month = index % 12 + 1; return { value: `${year}-${String(month).padStart(2, "0")}`, label: `${year}年${month}月` }; }).reverse(); }, []);
  const [billingResult, setBillingResult] = useState<MonthlyBillingResult | null>(null);
  const [billingLoading, setBillingLoading] = useState(false);
  const [showInvoiceDemo, setShowInvoiceDemo] = useState(false);
  const [invoiceCustomerId, setInvoiceCustomerId] = useState("");
  const [inventorySessionId, setInventorySessionId] = useState("");
  const [inventoryDifference, setInventoryDifference] = useState<InventoryDifference | null>(null);

  async function loadLedger() {
    setLoading(true);
    const response = await fetch("/api/ledger"); const result = await response.json();
    if (response.ok) { setContainers(result.containers ?? []); setMasters({ ...emptyMasters, ...(result.masters ?? {}) }); }
    else setNotice(result.error ?? "台帳データを読み込めませんでした。");
    setLoading(false);
  }
  useEffect(() => { void loadLedger(); }, []);
  const filtered = useMemo(() => containers.filter((c) => [c.serial_number, c.management_number, c.barcode, c.gas_types?.name, c.branches?.name, c.customers?.name, c.container_owners?.name].filter(Boolean).join(" ").toLowerCase().includes(query.toLowerCase())), [containers, query]);
  const selected = containers.find((c) => [c.serial_number, c.management_number, c.barcode].includes(containerText.trim()));
  const inspectionDue = containers.filter((c) => c.pressure_test_due_month && c.pressure_test_due_month <= "2027-12-31").length;
  const billingCustomers = useMemo<CustomerBillingSummary[]>(() => {
    const grouped = new Map<string, CustomerBillingSummary>();
    for (const item of billingResult?.items ?? []) {
      const summary = grouped.get(item.customerId) ?? { customerId: item.customerId, customerName: item.customerName, count: 0, amountYen: 0, confirmed: 0 };
      summary.count += 1; summary.amountYen += item.amountYen; summary.confirmed += item.calculated ? 1 : 0;
      grouped.set(item.customerId, summary);
    }
    return [...grouped.values()].sort((a, b) => a.customerName.localeCompare(b.customerName, "ja"));
  }, [billingResult]);

  function choosePage(next: Page) { setPage(next); window.scrollTo({ top: 0, behavior: "smooth" }); }
  async function signOut() { await fetch("/api/auth/signout", { method: "POST" }); window.location.assign("/login"); }
  function resolveContainer(reference: string) { const value = reference.trim(); return containers.find((item) => [item.id, item.serial_number, item.management_number, item.barcode].includes(value))?.id ?? null; }
  function resolveChoice(reference: string, choices: Choice[]) { const value = reference.trim(); return choices.find((item) => item.id === value || item.name === value || item.code === value)?.id ?? null; }
  async function submitLifecycle(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); const enteredContainer = String(data.containerText ?? "").trim(); const enteredCustomer = String(data.customerText ?? "").trim(); const enteredSupplier = String(data.supplierText ?? "").trim(); const enteredBranch = String(data.branchText ?? "").trim(); const resolvedContainer = resolveContainer(enteredContainer); const resolvedCustomer = enteredCustomer ? resolveChoice(enteredCustomer, masters.customers) : String(data.customerId ?? ""); const resolvedSupplier = enteredSupplier ? resolveChoice(enteredSupplier, masters.suppliers) : String(data.supplierId ?? ""); const resolvedBranch = enteredBranch ? resolveChoice(enteredBranch, masters.branches) : String(data.branchId ?? ""); if (!resolvedContainer) return setNotice("容器番号を入力するか、候補から選択してください。"); if (enteredCustomer && !resolvedCustomer) return setNotice("入力した得意先が見つかりません。"); if (enteredSupplier && !resolvedSupplier) return setNotice("入力した仕入先が見つかりません。"); if (!resolvedBranch) return setNotice("処理営業所を入力するか、候補から選択してください。"); setNotice("日常処理を登録中です…"); const response = await fetch("/api/lifecycle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...data, containerId: resolvedContainer, customerId: resolvedCustomer || undefined, supplierId: resolvedSupplier || undefined, branchId: resolvedBranch }) }); const result = await response.json(); setNotice(response.ok ? "登録しました。監査履歴にも記録されています。" : `登録できませんでした: ${result.error}`); if (response.ok) { event.currentTarget.reset(); setContainerText(""); setCustomerText(""); setSupplierText(""); setBranchText(""); await loadLedger(); } }
  async function submitMaster(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); if (masterKind === "container") { for (const [field, choices] of [["ownerId", masters.owners], ["gasTypeId", masters.gases], ["branchId", masters.branches]] as const) { const input = String(data[field] ?? "").trim(); if (input) { const resolved = resolveChoice(input, choices); if (!resolved) return setNotice(`${field === "ownerId" ? "保有者" : field === "gasTypeId" ? "ガス種" : "初期営業所"}が見つかりません。`); data[field] = resolved; } } } setNotice(`${masterLabels[masterKind]}を登録中です…`); const response = await fetch("/api/masters", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...data, kind: masterKind }) }); const result = await response.json(); setNotice(response.ok ? `${masterLabels[masterKind]}を登録しました。` : `登録できませんでした: ${result.error}`); if (response.ok) { event.currentTarget.reset(); await loadLedger(); } }
  async function loadInventoryDifference(sessionId = inventorySessionId) { if (!sessionId) return; const response = await fetch(`/api/operations?sessionId=${encodeURIComponent(sessionId)}`); const result = await response.json(); if (response.ok) setInventoryDifference(result.inventory); else setNotice(result.error ?? "棚卸差異を読み込めませんでした。"); }
  async function submitOperation(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); for (const [field, choices] of [["containerId", containers], ["providerId", masters.inspections], ["branchId", masters.branches]] as const) { const input = String(data[field] ?? "").trim(); if (!input) continue; const resolved = field === "containerId" ? resolveContainer(input) : field === "providerId" ? resolveChoice(input, masters.inspections) : resolveChoice(input, masters.branches); if (!resolved) return setNotice(`${field === "containerId" ? "容器" : field === "providerId" ? "検査先" : "営業所"}が見つかりません。`); data[field] = resolved; } const response = await fetch("/api/operations", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(data) }); const result=await response.json(); if(!response.ok)return setNotice(`登録できませんでした: ${result.error}`); const sessionId = data.action === "startInventory" ? result.session.id : String(data.sessionId ?? inventorySessionId); if(data.action==="startInventory") { setInventorySessionId(sessionId); setInventoryDifference(null); } if (data.action === "scanInventory" || data.action === "closeInventory") await loadInventoryDifference(sessionId); setNotice(data.action==="startInventory"?"棚卸を開始しました。容器を読み取ってください。":"登録しました。"); await loadLedger(); }
  async function loadBilling() { if (!/^\d{4}-\d{2}$/.test(billingMonth)) return setNotice("対象年月を選択してください。"); setShowInvoiceDemo(false); setInvoiceCustomerId(""); setBillingLoading(true); const response = await fetch(`/api/usage-charges?billingMonth=${encodeURIComponent(billingMonth)}`); const result = await response.json(); if (response.ok) setBillingResult(result); else setNotice(result.error ?? "使用料一覧を読み込めませんでした。"); setBillingLoading(false); }
  async function confirmBilling() { if (!billingResult) return; const loanIds = billingResult.items.filter((item) => !item.calculated).map((item) => item.loanId); if (!loanIds.length) return setNotice("未確定の使用料はありません。"); if (!window.confirm(`${loanIds.length}件の使用料を確定します。確定済みの再計算はできません。`)) return; setBillingLoading(true); const response = await fetch("/api/usage-charges", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "confirm", billingMonth, loanIds }) }); const result = await response.json(); if (response.ok) { setNotice(`月次使用料を確定しました：${result.settled.length}件${result.errors.length ? `、エラー ${result.errors.length}件` : ""}`); await loadBilling(); } else setNotice(result.error ?? "使用料を確定できませんでした。"); setBillingLoading(false); }
  async function loadMonthlyReport() {
    if (!monthlyMonth) return setMonthlyError("対象年月を選択してください。");
    setMonthlyLoading(true);
    setMonthlyError("");
    setMonthlyReport(null);
    try {
      const response = await fetch(`/api/monthly-reports?month=${encodeURIComponent(monthlyMonth)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "月次レポートを取得できませんでした。");
      setMonthlyReport(data as MonthlyReport);
    } catch (error) {
      setMonthlyError(error instanceof Error ? error.message : "通信に失敗しました。");
    } finally {
      setMonthlyLoading(false);
    }
  }
  function exportMonthlyCsv(kind: "inventory" | "inspection" | "stocktake") {
    if (!monthlyReport) return;
    const report = monthlyReport;
    const rows: (string | number)[][] = kind === "inventory"
      ? [["保有者", "営業所", "ガス種", "在庫本数"], ...report.inventory.map(item => [item.owner, item.branch, item.gas, item.count])]
      : kind === "inspection"
      ? [["瓶号", "管理番号", "所在地", "耐圧期限", "判定"], ...report.alerts.map(item => [item.serialNumber, item.managementNumber ?? "", item.branch, item.due, item.kind])]
      : [["棚卸日", "営業所", "状態", "帳簿在庫", "読取済", "未読取", "帳簿外"], ...report.inventorySessions.map(item => [item.countedOn, item.branch, item.status, item.expected, item.scanned, item.missing, item.unexpected])];
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `matsumiya_${kind}_${report.month}.csv`; link.click();
    URL.revokeObjectURL(url);
  }
  function openMonthlyBilling() {
    setBillingMonth(monthlyMonth);
    setBillingResult(null);
    choosePage("billing");
  }
  function downloadBillingCsv() { if (!billingResult) return; const header = ["対象月", "得意先", "瓶号", "管理番号", "納品日", "回収日", "課金日数", "使用料", "状態"];
    const escape = (value: string | number | null) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const lines = billingResult.items.map((item) => [billingResult.billingMonth.slice(0, 7), item.customerName, item.containerSerialNumber, item.managementNumber, item.deliveredOn, item.recoveredOn, item.billableDays, item.amountYen, item.calculated ? "確定済" : "未確定"]);
    const blob = new Blob(["\uFEFF" + [header, ...lines].map((line) => line.map(escape).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `matsumiya_usage_charges_${billingResult.billingMonth.slice(0, 7)}.csv`; anchor.click(); URL.revokeObjectURL(url); }
  function downloadSalesIntegrationDemo() { if (!billingResult) return; const header = ["連携区分", "対象月", "得意先", "計上日", "品目", "数量", "金額", "税区分", "連携状態"];
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const lines = billingCustomers.map((item) => ["使用料", billingResult.billingMonth.slice(0, 7), item.customerName, billingResult.billingMonth, "容器使用料", item.count, item.amountYen, "課税", "DEMO"]);
    const blob = new Blob(["\uFEFF" + [header, ...lines].map((line) => line.map(escape).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `matsumiya_sales_integration_demo_${billingResult.billingMonth.slice(0, 7)}.csv`; anchor.click(); URL.revokeObjectURL(url); setNotice("販売管理連携用のデモCSVを出力しました。実際の外部システムには連携していません。"); }
  async function loadHistory(id = historyContainerId) { const enteredContainer = historyContainerText.trim(); const enteredCustomer = historyCustomerText.trim(); const enteredSupplier = historySupplierText.trim(); const enteredBranch = historyBranchText.trim(); const resolvedContainer = enteredContainer ? resolveContainer(enteredContainer) : id; const resolvedCustomer = enteredCustomer ? resolveChoice(enteredCustomer, masters.customers) : historyCustomerId; const resolvedSupplier = enteredSupplier ? resolveChoice(enteredSupplier, masters.suppliers) : historySupplierId; const resolvedBranch = enteredBranch ? resolveChoice(enteredBranch, masters.branches) : historyBranchId; if (enteredContainer && !resolvedContainer) return setNotice("入力した容器番号が見つかりません。"); if (enteredCustomer && !resolvedCustomer) return setNotice("入力した得意先が見つかりません。"); if (enteredSupplier && !resolvedSupplier) return setNotice("入力した仕入先が見つかりません。"); if (enteredBranch && !resolvedBranch) return setNotice("入力した営業所が見つかりません。"); setHistoryLoading(true); const params = new URLSearchParams(); if (resolvedContainer) params.set("containerId", resolvedContainer); if (resolvedCustomer) params.set("customerId", resolvedCustomer); if (resolvedSupplier) params.set("supplierId", resolvedSupplier); if (resolvedBranch) params.set("handledBranchId", resolvedBranch); const response = await fetch(`/api/container-history?${params.toString()}`); const result = await response.json(); if (response.ok) { setHistoryResult(result); setHistoryContainerId(resolvedContainer ?? ""); } else setNotice(result.error ?? "移動履歴を読み込めませんでした。"); setHistoryLoading(false); }
  function startHistoryOrderEdit(item: HistoryItem) {
    if (!historyResult) return;
    const sameDay = historyResult.history.filter(row => row.containerId === item.containerId && row.occurredOn === item.occurredOn).reverse();
    if (sameDay.length < 2) {
      setOrderMessage("同じ日に記録された履歴が2件以上ある場合にのみ順序を変更できます。");
      return;
    }
    setOrderMessage("");
    setOrderEdit({ containerId: item.containerId, occurredOn: item.occurredOn, orderedIds: sameDay.map(row => row.id), reason: "" });
  }
  function moveHistoryOrder(index: number, direction: -1 | 1) {
    setOrderEdit(current => {
      if (!current) return null;
      const target = index + direction;
      if (target < 0 || target >= current.orderedIds.length) return current;
      const orderedIds = [...current.orderedIds];
      [orderedIds[index], orderedIds[target]] = [orderedIds[target], orderedIds[index]];
      return { ...current, orderedIds };
    });
  }
  async function saveHistoryOrder() {
    if (!orderEdit) return;
    setOrderSaving(true);
    setOrderMessage("");
    try {
      const response = await fetch("/api/history-order", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ containerId: orderEdit.containerId, occurredOn: orderEdit.occurredOn, orderedAuditIds: orderEdit.orderedIds, reason: orderEdit.reason })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "履歴順を保存できませんでした。");
      setOrderEdit(null);
      setOrderMessage(result.warning || "表示順を保存しました。");
      await loadHistory();
    } catch (error) {
      setOrderMessage(error instanceof Error ? error.message : "通信エラーが発生しました。");
    } finally {
      setOrderSaving(false);
    }
  }
  function openHistory(id: string) { const container = containers.find((item) => item.id === id); setHistoryContainerId(id); setHistoryContainerText(container?.serial_number ?? ""); setHistoryResult(null); choosePage("history"); void loadHistory(id); }
  function downloadTemplate() { const blob = new Blob(["\uFEFF" + handheldCsvTemplate], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "matsumiya_handheld_v1.csv"; anchor.click(); URL.revokeObjectURL(url); }
  async function loadReconciliationBatches(preferId?: string) {
    setReconciliationBusy(true); setReconciliationMessage("");
    try {
      const response = await fetch("/api/handheld-reconciliation");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "取込履歴を取得できませんでした。");
      const batches: ReconciliationBatch[] = data.batches ?? [];
      setReconciliationBatches(batches);
      const id = preferId ?? reconciliationImportId ?? "";
      if (id && batches.some(item => item.id === id)) await loadReconciliation(id);
    } catch (error) {
      setReconciliationMessage(error instanceof Error ? error.message : "照合履歴を読み込めませんでした。");
    } finally { setReconciliationBusy(false); }
  }
  async function loadReconciliation(id: string) {
    setReconciliationImportId(id);
    setReconciliationResult(null);
    if (!id) return;
    const response = await fetch(`/api/handheld-reconciliation?importId=${encodeURIComponent(id)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "伝票照合明細を取得できませんでした。");
    setReconciliationResult(result as ReconciliationResult);
    setReconciliationNotes(Object.fromEntries((result.rows as ReconciliationRow[]).map(row => [row.id, row.note])));
    setSlipChecked({});
    setBulkReconciliationSelected([]);
    setBulkPaperSlipConfirmed(false);
  }
  async function reconcileRow(row: ReconciliationRow, decision: "matched" | "hold") {
    if (!reconciliationResult) return;
    setReconciliationBusy(true); setReconciliationMessage("");
    try {
      const response = await fetch("/api/handheld-reconciliation", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "check", importId: reconciliationResult.batch.id, rowId: row.id,
          decision, note: reconciliationNotes[row.id] ?? "", paperSlipChecked: !!slipChecked[row.id]
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "照合結果を保存できませんでした。");
      setReconciliationResult(result.batch as ReconciliationResult);
      setSlipChecked(current => ({ ...current, [row.id]: false }));
      setReconciliationMessage(`${row.lineNumber}行目の照合結果を保存しました。`);
    } catch (error) {
      setReconciliationMessage(error instanceof Error ? error.message : "照合結果を保存できませんでした。");
    } finally { setReconciliationBusy(false); }
  }
  async function reconcileSelectedRows() {
    if (!reconciliationResult || !bulkReconciliationSelected.length || !bulkPaperSlipConfirmed) return;
    setReconciliationBusy(true); setReconciliationMessage("");
    try {
      const response = await fetch("/api/handheld-reconciliation", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "bulk_check", importId: reconciliationResult.batch.id,
          rowIds: bulkReconciliationSelected, paperSlipChecked: bulkPaperSlipConfirmed
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "一括照合を保存できませんでした。");
      setReconciliationResult(result.batch as ReconciliationResult);
      setBulkReconciliationSelected([]);
      setBulkPaperSlipConfirmed(false);
      setReconciliationMessage(`${result.matchedCount}件を紙伝票と一括照合済みにしました。取込の最終確定は別操作です。`);
    } catch (error) {
      setReconciliationMessage(error instanceof Error ? error.message : "一括照合に失敗しました。");
    } finally { setReconciliationBusy(false); }
  }
  const bulkEligibleRows = reconciliationResult?.finalized ? [] : (reconciliationResult?.rows ?? []).filter(
    row => row.status === "applied" && row.decision === "unreviewed" && !row.error && row.issues.length === 0
  );
  async function finalizeReconciliation() {
    if (!reconciliationResult) return;
    setReconciliationBusy(true); setReconciliationMessage("");
    try {
      const response = await fetch("/api/handheld-reconciliation", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "finalize", importId: reconciliationResult.batch.id })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "伝票照合を確定できませんでした。");
      setReconciliationResult(result.batch as ReconciliationResult);
      setReconciliationMessage("取込単位の伝票照合を確定しました。売上の計上は行っていません。");
    } catch (error) {
      setReconciliationMessage(error instanceof Error ? error.message : "確定に失敗しました。");
    } finally { setReconciliationBusy(false); }
  }
  function exportReconciledDeliveries() {
    if (!reconciliationResult?.finalized) return;
    const rows = reconciliationResult.rows.filter(item => item.status === "applied" && item.decision === "matched" && item.action === "delivered");
    const cells = [["処理日", "伝票番号", "得意先", "瓶号", "ガス種", "容量", "容量単位", "営業所", "照合状態", "売上計上状態"],
      ...rows.map(row => [row.occurredOn ?? "", row.referenceNumber, row.customer, row.serialNumber, row.gasName, row.capacity, row.capacityUnit, row.branch, "照合確定", "未計上"])];
    const safe = (value: string) => {
      const text = /^[=+@\-\t\r]/.test(value) ? "'" + value : value;
      return '"' + text.replaceAll('"', '""') + '"';
    };
    const csv = cells.map(row => row.map(safe).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const element = document.createElement("a");
    element.href = url; element.download = "matsumiya_reconciled_deliveries_" + reconciliationResult.batch.id.slice(0, 8) + ".csv";
    element.click(); URL.revokeObjectURL(url);
  }
  async function fetchSalesMasters() {
    const response=await fetch("/api/sales-masters",{cache:"no-store"});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error??"商品・単価マスタを読み込めませんでした。");
    setSalesMasters(data as SalesMasters);
  }
  function matchMaster<T extends {id:string;name:string;code?:string}>(items:T[], entered:string) {
    const value=entered.trim();
    return items.find(item=>item.name===value||item.code===value||(item.code&&`${item.code} — ${item.name}`===value))?.id??null;
  }
  async function saveSalesMaster() {
    if(!salesMasters)return;
    setSalesBusy(true);setSalesMasterMessage("");
    try{
      const body=salesMasterTab==="quantity"?{
        kind:"quantity",customerId:matchMaster(salesMasters.customers,quantityMasterForm.customer),
        productMappingId:salesMasters.products.find(p=>`${p.product_code} — ${p.product_name}`===quantityMasterForm.product)?.id??null,
        billingUnit:quantityMasterForm.unit,quantityPerContainer:quantityMasterForm.perContainer===""?null:Number(quantityMasterForm.perContainer),
        effectiveFrom:quantityMasterForm.from,effectiveUntil:quantityMasterForm.until||null
      }:salesMasterTab==="product"?{
        kind:"product",gasTypeId:matchMaster(salesMasters.gases,productMasterForm.gas),
        supplierId:productMasterForm.supplier?matchMaster(salesMasters.suppliers,productMasterForm.supplier):null,
        ownerId:productMasterForm.owner?matchMaster(salesMasters.owners,productMasterForm.owner):null,
        productCode:productMasterForm.code,productName:productMasterForm.name,unit:productMasterForm.unit
      }:{
        kind:"price",productMappingId:salesMasters.products.find(p=>`${p.product_code} — ${p.product_name}`===priceMasterForm.product)?.id??null,
        priceKind:priceMasterForm.kind,
        customerId:priceMasterForm.kind==="sale"?matchMaster(salesMasters.customers,priceMasterForm.customer):null,
        supplierId:priceMasterForm.kind==="purchase"?matchMaster(salesMasters.suppliers,priceMasterForm.supplier):null,
        ownerId:priceMasterForm.kind==="purchase"&&priceMasterForm.owner?matchMaster(salesMasters.owners,priceMasterForm.owner):null,
        unitPrice:priceMasterForm.price===""?null:Number(priceMasterForm.price),
        effectiveFrom:priceMasterForm.from,effectiveUntil:priceMasterForm.until||null
      };
      if(salesMasterTab==="quantity"&&(!body.customerId||!body.productMappingId))throw new Error("得意先と商品を候補から正しく選択してください。");
      if(salesMasterTab==="product"&&(!body.gasTypeId||(productMasterForm.supplier&&!body.supplierId)||(productMasterForm.owner&&!body.ownerId)))throw new Error("ガス種・仕入先・保有者を候補から正しく選んでください。");
      if(salesMasterTab==="price"&&(!body.productMappingId||(priceMasterForm.kind==="sale"&&!body.customerId)||(priceMasterForm.kind==="purchase"&&!body.supplierId)||(priceMasterForm.owner&&!body.ownerId)))throw new Error("商品・取引先・仕入先・保有者を候補から正しく選んでください。");
      const response=await fetch("/api/sales-masters",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error??"マスタを保存できませんでした。");
      await fetchSalesMasters();
      if(salesImportId)await fetchSalesCandidates(salesImportId);
      setSalesMasterMessage("マスタを登録しました。候補の単価を適用する前に内容を確認してください。");
      if(salesMasterTab==="quantity")setQuantityMasterForm({customer:"",product:"",unit:"",perContainer:"",from:"",until:""});
      else if(salesMasterTab==="product")setProductMasterForm({gas:"",supplier:"",owner:"",code:"",name:"",unit:"本"});
      else setPriceMasterForm(current=>({...current,price:"",from:"",until:""}));
    }catch(error){setSalesMasterMessage(error instanceof Error?error.message:"登録に失敗しました。");}
    finally{setSalesBusy(false);}
  }
  async function fetchSalesBatches() {
    setSalesBusy(true);setSalesMessage("");
    try {
      const response=await fetch("/api/sales-candidates");
      const result=await response.json();
      if(!response.ok)throw new Error(result.error??"照合確定済みの履歴を取得できませんでした。");
      setSalesBatches(result.batches??[]);
      await fetchSalesMasters();
    }catch(error){setSalesMessage(error instanceof Error?error.message:"取得できませんでした。");}
    finally{setSalesBusy(false);}
  }
  async function fetchSalesCandidates(importId:string) {
    setSalesImportId(importId);setSalesResult(null);setSalesDraftId(null);setSalesMessage("");
    if(!importId)return;
    setSalesBusy(true);
    try{
      const response=await fetch(`/api/sales-candidates?importId=${encodeURIComponent(importId)}`);
      const result=await response.json();
      if(!response.ok)throw new Error(result.error??"売上候補を取得できませんでした。");
      setSalesResult(result as SalesResult);
    }catch(error){setSalesMessage(error instanceof Error?error.message:"取得できませんでした。");}
    finally{setSalesBusy(false);}
  }
  async function loadPreviousCandidatePrices(item:SalesCandidate) {
    const productCode=item.productCode||item.suggestion?.productCode||"";
    setSalesPriceHistory([]);setSalesPriceHistoryNote("");
    if(!item.customer||!productCode)return;
    try{
      const query=new URLSearchParams({customer:item.customer,productCode});
      const response=await fetch(`/api/sales-price-history?${query.toString()}`);
      const data=await response.json();
      if(!response.ok)throw new Error(data.error??"参照履歴を取得できませんでした。");
      setSalesPriceHistory(data.history??[]);
      setSalesPriceHistoryNote(data.note??"");
    }catch(error){setSalesPriceHistoryNote(error instanceof Error?error.message:"過去の確認記録を取得できませんでした。");}
  }
  function editSalesCandidate(item:SalesCandidate) {
    void loadPreviousCandidatePrices(item);
    setSalesDraftId(item.id);setSalesMessage("");
    setSalesDraft({
      productCode:item.confirmed?item.productCode:(item.suggestion?.productCode??item.productCode),
      productName:item.confirmed?item.productName:(item.suggestion?.productName??item.productName),
      supplier:item.confirmed?item.supplier:(item.suggestion?.supplier||item.supplier),
      quantity:String(item.quantity),
      unit:item.unit,
      saleUnitPrice:item.confirmed?(item.saleUnitPrice===null?"":String(item.saleUnitPrice)):(item.suggestion?.saleUnitPrice==null?"":String(item.suggestion.saleUnitPrice)),
      purchaseUnitPrice:item.confirmed?(item.purchaseUnitPrice===null?"":String(item.purchaseUnitPrice)):(item.suggestion?.purchaseUnitPrice==null?"":String(item.suggestion.purchaseUnitPrice)),
      note:item.note,
      quantitySource:item.quantitySource,
      quantityReason:item.quantityReason,
      quantityRuleId:item.quantityRuleId
    });
  }
  function applySalesSuggestion() {
    const row=salesResult?.candidates.find(item=>item.id===salesDraftId);
    const suggestion=row?.suggestion;
    if(!suggestion)return;
    setSalesDraft(current=>({
      ...current,productCode:suggestion.productCode,productName:suggestion.productName,
      supplier:suggestion.supplier||current.supplier,unit:suggestion.unit,
      saleUnitPrice:suggestion.saleUnitPrice===null?current.saleUnitPrice:String(suggestion.saleUnitPrice),
      purchaseUnitPrice:suggestion.purchaseUnitPrice===null?current.purchaseUnitPrice:String(suggestion.purchaseUnitPrice)
    }));
    setSalesMessage("マスタ候補を入力欄へ反映しました。内容・数量・単価を確認して保存してください。");
  }
  function applyActualFillSuggestion() {
    const row=salesResult?.candidates.find(item=>item.id===salesDraftId);
    const actual=row?.actualFillSuggestion;
    if(!actual)return;
    setSalesDraft(current=>({...current,quantity:String(actual.quantity),unit:actual.unit,
      quantitySource:"actual_fill",quantityReason:"ハンディCSVの実充填量を採用（確認済み）",quantityRuleId:null}));
    setSalesMessage("ハンディで記録された実充填量を反映しました。出荷実績と照合のうえ保存してください。");
  }
  function applyQuantitySuggestion() {
    const row=salesResult?.candidates.find(item=>item.id===salesDraftId);
    if(!row?.quantitySuggestion)return;
    const rule=row.quantitySuggestion;
    setSalesDraft(current=>({...current,quantity:String(rule.quantity),unit:rule.unit,
      quantitySource:"rule",quantityReason:"",quantityRuleId:rule.ruleId}));
    setSalesMessage("得意先別の数量換算を入力欄に反映しました。実充填量と数量を確認して保存してください。");
  }
  async function confirmSalesCandidate() {
    if(!salesResult||salesDraftId===null)return;
    setSalesBusy(true);setSalesMessage("");
    try{
      const response=await fetch("/api/sales-candidates",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({importId:salesResult.batch.id,rowId:salesDraftId,
          productCode:salesDraft.productCode,productName:salesDraft.productName,supplier:salesDraft.supplier,
          quantity:salesDraft.quantity===""?null:Number(salesDraft.quantity),unit:salesDraft.unit,
          saleUnitPrice:salesDraft.saleUnitPrice===""?null:Number(salesDraft.saleUnitPrice),
          purchaseUnitPrice:salesDraft.purchaseUnitPrice===""?null:Number(salesDraft.purchaseUnitPrice),
          note:salesDraft.note,quantitySource:salesDraft.quantitySource,
          quantityReason:salesDraft.quantityReason,quantityRuleId:salesDraft.quantityRuleId})
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.error??"候補を保存できませんでした。");
      setSalesResult(result.result as SalesResult);setSalesDraftId(null);
      setSalesMessage("商品・単価を確認済みとして保存しました。実際の売上計上は行っていません。");
    }catch(error){setSalesMessage(error instanceof Error?error.message:"候補を保存できませんでした。");}
    finally{setSalesBusy(false);}
  }
  async function exportSalesCandidates() {
    if(!salesResult||salesResult.summary.pending>0)return;
    setSalesBusy(true);setSalesMessage("");
    try{
      const response=await fetch(`/api/sales-candidates?importId=${encodeURIComponent(salesResult.batch.id)}&format=csv`,{cache:"no-store"});
      if(!response.ok){const result=await response.json();throw new Error(result.error??"CSVを出力できませんでした。");}
      const blob=await response.blob();
      const url=URL.createObjectURL(blob);
      const link=document.createElement("a");link.href=url;link.download=`sales_candidates_${salesResult.batch.id.slice(0,8)}.csv`;
      link.click();URL.revokeObjectURL(url);
      setSalesMessage("確認済み売上候補CSVを出力しました。販売管理への取込・売上計上は未実施です。");
    }catch(error){setSalesMessage(error instanceof Error?error.message:"CSV出力に失敗しました。");}
    finally{setSalesBusy(false);}
  }
  const salesGroupTotals=useMemo(()=>{
    const map=new Map<string,{customer:string;productCode:string;productName:string;unit:string;quantity:number;total:number;count:number}>();
    for(const row of salesResult?.candidates??[]){
      if(!row.confirmed||row.saleUnitPrice===null)continue;
      const key=JSON.stringify([row.customer,row.productCode,row.unit,row.saleUnitPrice]);
      const item=map.get(key)??{customer:row.customer,productCode:row.productCode,productName:row.productName,unit:row.unit,quantity:0,total:0,count:0};
      item.quantity+=row.quantity;item.total+=Math.round(row.quantity*row.saleUnitPrice*100)/100;item.count++;
      map.set(key,item);
    }
    return [...map.values()].sort((a,b)=>a.customer.localeCompare(b.customer,"ja")||a.productCode.localeCompare(b.productCode,"ja"));
  },[salesResult]);
  async function submitCsv(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    const mode = String(form.get("mode"));
    if (!(file instanceof File) || !file.size) return setNotice("CSVファイルを選択してください。");
    setImportResult(null);
    setImportFilter("all");
    setNotice(mode === "apply" ? "CSVを取込中です…" : "CSVを検証中です…");
    try {
      const response = await fetch("/api/handheld-imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: file.name, content: await file.text(), mode })
      });
      const result = await response.json();
      if (!response.ok) return setNotice(`CSVを処理できませんでした: ${result.error}`);
      if (mode === "apply") {
        const rows: ImportOutcome[] = result.rows ?? [];
        setImportResult({ mode, rows, importId: result.importId });
        setImportFilter(result.errors ? "error" : "all");
        setNotice(`CSV取込完了：${result.applied}件登録、${result.errors}件エラー、${rows.filter(row => row.warnings?.length).length}件に確認事項があります。下の明細を確認してください。`);
        await loadLedger();
        void loadReconciliationBatches(result.importId);
      } else {
        const rows: ImportOutcome[] = (result.rows ?? []).map((row: { lineNumber: number; barcode: string; occurredOn: string; action: string; raw?: Record<string,string>; error: string | null }) => ({
          lineNumber: row.lineNumber, barcode: row.barcode, occurredOn: row.occurredOn,
          action: row.raw?.["処理区分"] ?? row.raw?.action ?? row.action ?? "",
          status: row.error ? "error" : "valid", error: row.error, warnings: (row as { warnings?: string[] }).warnings ?? []
        }));
        setImportResult({ mode, rows });
        setImportFilter(rows.some((row) => row.status === "error") ? "error" : "all");
        setNotice(`事前検証完了：有効 ${result.valid}件、エラー ${(result.errors ?? []).length}件、確認事項 ${rows.filter(row => row.warnings?.length).length}件。下の明細から確認できます。`);
      }
    } catch (error) {
      setNotice(`CSV処理中にエラーが発生しました: ${error instanceof Error ? error.message : "通信に失敗しました。"}`);
    }
  }

  return <div className="legacyShell"><NetworkActionFeedback/><header className="legacyHeader"><button className="brand" onClick={() => choosePage("home")}><span>松宮工材</span><strong>容器管理システム</strong></button><div className="headerMeta">業務日：2026年10月17日　／　ログイン済み <button className="signOutButton" onClick={() => void signOut()}>ログアウト</button></div></header><div className="legacyLayout"><aside className="legacySidebar"><button className={`homeButton ${page === "home" ? "selected" : ""}`} onClick={() => choosePage("home")}>業務メニュー</button>{menus.map((group) => <section key={group.heading}><h2>{group.heading}</h2>{group.items.map(([target, label], index) => <button className={page === target ? "selected" : ""} onClick={() => choosePage(target)} key={`${target}-${index}`}>{label}</button>)}</section>)}</aside><main className="legacyMain">
    {page === "home" && <><div className="crumb">業務メニュー</div><h1>容器管理　メインメニュー</h1><section className="legacyPanel"><h2>業務選択</h2><div className="menuGrid">{menus.flatMap((group) => group.items).map(([target, label], index) => <button key={`${target}-${index}`} onClick={() => choosePage(target)}><b>{label}</b><span>{target === "daily" ? "入荷・納品・回収" : target === "handheld" ? "CSV検証・取り込み" : target === "ledger" ? "瓶号・バーコード・所在を検索" : target === "masters" ? "容器・取引先・ガス種を登録" : "一覧・管理処理"}</span></button>)}</div></section><section className="legacyPanel"><h2>お知らせ</h2><p>現行システムの分類に合わせ、日常業務・照会・月次・マスタを左メニューへ集約しています。すべてのサンプルデータは <b>DEMO-</b> または「サンプル」表記です。</p></section></>}
    {page === "ledger" && <><Breadcrumb items={["照会", "容器台帳照会"]} /><h1>容器台帳照会</h1><section className="legacyPanel filters"><h2>検索条件</h2><label>瓶号・バーコード・ガス種・営業所・顧客<input value={query} onChange={(event) => setQuery(event.target.value)}  /></label><div><button className="actionButton" onClick={() => setQuery("")}>条件クリア</button><button className="subtleButton" onClick={() => void loadLedger()}>再読込</button></div></section><section className="legacyPanel"><div className="panelTitle"><h2>容器一覧</h2><span>{loading ? "読込中…" : `${filtered.length} 件`}</span></div><div className="tableWrap"><table className="legacyTable"><thead><tr><th>瓶号</th><th>管理番号 / バーコード</th><th>営業所・顧客</th><th>保有者</th><th>ガス種</th><th>容器形態</th><th>容量</th><th>耐圧期限</th><th>状態</th><th>履歴</th></tr></thead><tbody>{loading ? <tr><td colSpan={10}>読み込み中…</td></tr> : filtered.length === 0 ? <tr><td colSpan={10}>該当する容器はありません。</td></tr> : filtered.map((c) => <tr key={c.id}><td><b>{c.serial_number}</b></td><td>{c.management_number || "－"}<small>{c.barcode || "バーコード未登録"}</small></td><td>{c.branches?.name || c.customers?.name || "未設定"}</td><td>{c.container_owners?.name || "未設定"}</td><td>{c.gas_types?.name || c.container_type}</td><td>{c.container_form}</td><td>{c.capacity_value ? `${c.capacity_value}${c.capacity_unit ?? ""}` : "－"}</td><td>{c.pressure_test_due_month || "－"}</td><td><span className={`status ${c.status}`}>{statusLabel[c.status] ?? c.status}</span><small>{conditionLabel[c.condition] ?? c.condition}</small></td><td><button className="tableButton" onClick={() => openHistory(c.id)}>移動履歴</button></td></tr>)}</tbody></table></div></section></>}
    {page === "history" && <><Breadcrumb items={["照会", "容器移動履歴照会"]} /><h1>容器移動履歴照会</h1><section className="legacyPanel filters"><h2>検索条件</h2><p className="instruction">文字入力欄を選択すると候補が表示されます。入力して絞り込むこともできます。</p><label>容器<input value={historyContainerText} onChange={(event) => setHistoryContainerText(event.target.value)} list="container-options"  /></label><label>得意先<input value={historyCustomerText} onChange={(event) => setHistoryCustomerText(event.target.value)} list="customer-options"  /></label><label>仕入先<input value={historySupplierText} onChange={(event) => setHistorySupplierText(event.target.value)} list="supplier-options"  /></label><label>処理営業所<input value={historyBranchText} onChange={(event) => setHistoryBranchText(event.target.value)} list="branch-options"  /></label><div><button className="actionButton" onClick={() => void loadHistory()}>履歴を表示</button></div></section><section className="legacyPanel"><div className="panelTitle"><h2>移動履歴</h2><span>{historyResult ? `${historyResult.history.length} 件` : "条件を指定してください"}</span></div>{historyLoading ? <p className="instruction">読み込み中…</p> : !historyResult ? <p className="instruction">容器・得意先・仕入先・処理営業所を組み合わせて、移動履歴を照会できます。</p> : <div className="tableWrap"><table className="legacyTable"><thead><tr><th>瓶号</th><th>処理日</th><th>処理区分</th><th>移動元</th><th>移動先</th><th>得意先</th><th>仕入先</th><th>処理営業所</th><th>順序確認</th><th>同日順序訂正</th></tr></thead><tbody>{historyResult.history.length === 0 ? <tr><td colSpan={10}>該当する移動履歴はありません。</td></tr> : historyResult.history.map((item) => <tr key={item.id} className={item.sequenceError ? "sequenceError" : ""}><td><b>{item.containerSerialNumber}</b><small>{item.managementNumber || "－"}</small></td><td>{item.occurredOn}</td><td>{item.actionLabel}</td><td>{item.from}</td><td>{item.to}</td><td>{item.customer}</td><td>{item.supplier}</td><td>{item.handledBranch}</td><td>{item.sequenceError ? `エラー：${item.sequenceError}` : "正常"}{item.orderAdjusted && <small>表示順訂正済み</small>}</td><td><button type="button" className="subtleButton historyOrderButton" onClick={() => startHistoryOrderEdit(item)}>順序確認</button></td></tr>)}</tbody></table></div>}</section>{orderMessage && <section className="legacyPanel historyOrderMessage">{orderMessage}</section>}{orderEdit && <section className="legacyPanel historyOrderPanel"><h2>同日内の履歴表示順の訂正</h2><p className="instruction">対象日：{orderEdit.occurredOn}。上から古い順です。元の移動記録、容器所在、貸出・請求計算は変更しません。変更理由と操作担当者は監査記録に残ります。</p><div className="historyOrderRows">{orderEdit.orderedIds.map((id, index) => { const row = historyResult?.history.find(item => item.id === id); return <div key={id} className="historyOrderRow"><span>{index + 1}. {row?.actionLabel} ／ {row?.containerSerialNumber} ／ 履歴ID {id}</span><div><button type="button" onClick={() => moveHistoryOrder(index, -1)} disabled={index === 0}>上へ</button><button type="button" onClick={() => moveHistoryOrder(index, 1)} disabled={index === orderEdit.orderedIds.length - 1}>下へ</button></div></div>; })}</div><label className="historyOrderReason">訂正理由<textarea value={orderEdit.reason} onChange={event => setOrderEdit(current => current ? { ...current, reason: event.target.value } : null)} rows={2} /></label><div className="historyOrderActions"><button type="button" className="actionButton" disabled={orderSaving || orderEdit.reason.trim().length < 3} onClick={() => void saveHistoryOrder()}>{orderSaving ? "保存中…" : "訂正内容を保存"}</button><button type="button" className="subtleButton" onClick={() => setOrderEdit(null)}>キャンセル</button></div></section>}</>}
    {page === "daily" && <><Breadcrumb items={["日常業務", "入荷・出荷・回収・仕入れ返却"]} /><h1>入荷・出荷・回収・仕入れ返却入力</h1><div className="twoColumns"><section className="legacyPanel"><h2>容器移動入力</h2><p className="instruction">順序は「入荷 → 出荷 → 回収 → 仕入れ返却」です。入力欄から候補を選択できます。順番外の登録は自動でエラーになります。</p><form className="legacyForm" onSubmit={submitLifecycle}><label>容器番号<input name="containerText" value={containerText} onChange={(event) => setContainerText(event.target.value)} list="container-options"  /></label>{selected && <p className="selectedRow">選択容器：<b>{selected.serial_number}</b>　現在状態：{statusLabel[selected.status]}</p>}<label>処理区分<select name="action"><option value="received">入荷</option><option value="delivered">出荷</option><option value="recovered">回収</option><option value="supplier_return">仕入れ返却</option></select></label><label>処理日<input type="date" name="occurredOn" required /></label><label>得意先（直接入力）<input name="customerText" value={customerText} onChange={(event) => setCustomerText(event.target.value)} list="customer-options"  /></label><label>仕入先（直接入力）<input name="supplierText" value={supplierText} onChange={(event) => setSupplierText(event.target.value)} list="supplier-options"  /></label><label>処理営業所（直接入力）<input name="branchText" value={branchText} onChange={(event) => setBranchText(event.target.value)} list="branch-options"  /></label><button className="actionButton">登録</button></form></section></div></>}
    {page === "handheld" && <><Breadcrumb items={["日常業務", "ハンディ取り込み"]} /><h1>ハンディ取り込み</h1><div className="singleColumn"><section className="legacyPanel"><h2>ハンディデータ取込</h2><p className="instruction">処理日・処理区分・バーコード・営業所を含むCSVを取り込みます。</p><button className="subtleButton" onClick={downloadTemplate}>取込テンプレート出力</button><form className="legacyForm" onSubmit={submitCsv}><label>CSVファイル<input type="file" name="file" accept=".csv,text/csv,text/tab-separated-values" required /></label><label>実行内容<select name="mode"><option value="validate">事前検証（登録しない）</option><option value="apply">取込確定（監査履歴に保存）</option></select></label><button className="actionButton">CSV処理</button></form>{importResult && <section className="importDetails"><div className="importDetailsHeading"><h3>{importResult.mode === "apply" ? "取込結果の明細" : "事前検証の明細"}</h3><span>全{importResult.rows.length}件 ／ {importResult.rows.filter((row) => row.status === "applied" || row.status === "valid").length}件{importResult.mode === "apply" ? "登録成功" : "有効"} ／ {importResult.rows.filter((row) => row.status === "error").length}件エラー</span></div><p className="importHelp">CSVの行番号ごとに処理結果を表示しています。ガス種不一致はエラー、容量差異は確認事項として表示します。容量差異がある場合は実充填量を確認してください。成功済みの行を含む同じCSVの再取込は避けてください。</p>{importResult.importId && <p className="importId">取込ID：{importResult.importId}</p>}<div className="importFilters"><button type="button" className={importFilter === "all" ? "active" : ""} onClick={() => setImportFilter("all")}>すべて（{importResult.rows.length}）</button><button type="button" className={importFilter === "applied" ? "active" : ""} onClick={() => setImportFilter("applied")}>{importResult.mode === "apply" ? "登録成功" : "有効"}（{importResult.rows.filter((row) => row.status === "applied" || row.status === "valid").length}）</button><button type="button" className={importFilter === "error" ? "active" : ""} onClick={() => setImportFilter("error")}>エラー（{importResult.rows.filter((row) => row.status === "error").length}）</button></div><div className="tableWrap"><table className="importTable"><thead><tr><th>CSV行</th><th>処理日</th><th>処理区分</th><th>バーコード・容器番号</th><th>結果</th><th>エラー理由・確認事項</th></tr></thead><tbody>{importResult.rows.filter((row) => importFilter === "all" || (importFilter === "error" ? row.status === "error" : row.status === "applied" || row.status === "valid")).map((row) => <tr key={row.lineNumber}><td>{row.lineNumber}</td><td>{row.occurredOn}</td><td>{row.action}</td><td>{row.barcode}</td><td><span className={row.status === "error" ? "importStatus failed" : "importStatus passed"}>{row.status === "error" ? "エラー" : row.status === "valid" ? "有効" : "登録成功"}</span></td><td className="importError">{row.error && <div>{row.error}</div>}{row.warnings?.map((warning, index) => <div className="importWarning" key={index}>確認：{warning}</div>)}{!row.error && !row.warnings?.length && "—"}</td></tr>)}</tbody></table></div></section>}<small>対応区分：入荷、出荷、回収、仕入れ返却（英語表記も可）。任意列：ガス種・容量・容量単位・実充填量・実充填量単位。「容量」は容器の公称容量、「実充填量」は実際に充填されたガス量として区別します。実充填量と請求単位が一致する場合、伝票照合後の売上候補に自動反映します（保存・確定は担当者が行います）。容量の差異は台帳を自動上書きしません。</small></section>
<section className="legacyPanel reconciliationPanel"><div className="panelTitle"><h2>取込後の伝票照合・確定</h2><button type="button" className="subtleButton" disabled={reconciliationBusy} onClick={() => void loadReconciliationBatches()}>取込履歴を読み込む</button></div>
<p className="instruction">現在の簡易版は、ハンディ実績と紙の納品・回収伝票を担当者が確認する手動照合です。明細ごとの照合に加え、確認済みの明細を選択して一括照合できます。照合できない明細は保留にし、理由を残してください。照合確定は売上計上ではありません。管理者専用です。</p>
<p className="reconciliationFutureNotice"><strong>本開発での対応予定：伝票データとハンディ実績の自動照合</strong>（伝票番号・瓶号・日付・得意先等を照合し、不一致のみ担当者が確認する運用を想定）。現在は自動照合を実装していません。伝票データの取得方式と照合条件は今後の要件定義で確定します。</p>
{reconciliationBatches.length > 0 && <label className="reconciliationBatchPicker">対象取込<select value={reconciliationImportId} onChange={event => { setReconciliationMessage(""); void loadReconciliation(event.target.value).catch(error => setReconciliationMessage(error instanceof Error ? error.message : "照合データを読み込めませんでした。")); }}><option value="">取込履歴を選択</option>{reconciliationBatches.map(batch => <option key={batch.id} value={batch.id}>{new Date(batch.created_at).toLocaleString("ja-JP")} ／ {batch.source_filename} ／ 登録 {batch.applied_rows}件・エラー {batch.error_rows}件</option>)}</select></label>}
{reconciliationMessage && <p className="reconciliationMessage" role="status">{reconciliationMessage}</p>}
{reconciliationResult && <><div className="reconciliationCounts"><span>登録成功 {reconciliationResult.summary.applied}件</span><span>照合済 {reconciliationResult.summary.matched}件</span><span>保留 {reconciliationResult.summary.held}件</span><span>未照合 {reconciliationResult.summary.unreviewed}件</span><span>取込エラー {reconciliationResult.summary.errors}件</span></div>
{!reconciliationResult.finalized && <div className="reconciliationBulkPanel">
<div className="reconciliationBulkTop"><strong>紙伝票の一括照合（手動確認）</strong><span>一括対象：未照合・登録成功・差異なし {bulkEligibleRows.length}件</span></div>
<div className="reconciliationBulkButtons">
<button type="button" className="subtleButton" disabled={reconciliationBusy || bulkEligibleRows.length===0} onClick={() => {setBulkReconciliationSelected(bulkEligibleRows.map(row=>row.id));setBulkPaperSlipConfirmed(false);}}>照合対象をすべて選択</button>
<button type="button" className="subtleButton" disabled={reconciliationBusy || !bulkReconciliationSelected.length} onClick={() => {setBulkReconciliationSelected([]);setBulkPaperSlipConfirmed(false);}}>選択を解除</button>
<span>{bulkReconciliationSelected.length}件選択中</span></div>
<label className="reconciliationBulkAgreement"><input type="checkbox" checked={bulkPaperSlipConfirmed} disabled={reconciliationBusy || !bulkReconciliationSelected.length} onChange={e=>setBulkPaperSlipConfirmed(e.target.checked)}/> 選択したすべての明細について、紙伝票と突き合わせて一致を確認しました</label>
<button type="button" className="actionButton" disabled={reconciliationBusy || !bulkPaperSlipConfirmed || bulkReconciliationSelected.length===0} onClick={() => void reconcileSelectedRows()}>選択した {bulkReconciliationSelected.length}件を一括照合済みにする</button>
<p className="instruction">保留・取込エラー・台帳との差異がある明細は一括照合の対象外です。差異がある場合は明細ごとに備考を入力して確認してください。一括照合は最終確定とは別です。</p>
</div>}
{reconciliationResult.finalized && <p className="reconciliationSuccess">照合確定済：{new Date(reconciliationResult.finalized.finalized_at).toLocaleString("ja-JP")}。販売管理への登録・売上計上は未実施です。</p>}
<div className="tableWrap"><table className="legacyTable reconciliationTable"><thead><tr><th>一括選択</th><th>CSV行</th><th>伝票番号</th><th>処理日・区分</th><th>得意先・仕入先</th><th>瓶号／ガス種・容量</th><th>取込状態・確認事項</th><th>伝票照合</th></tr></thead><tbody>{reconciliationResult.rows.map(row => <tr key={row.id}><td>{!reconciliationResult.finalized && bulkEligibleRows.some(item=>item.id===row.id) ? <input type="checkbox" aria-label={`${row.lineNumber}行目を一括照合対象に選択`} checked={bulkReconciliationSelected.includes(row.id)} disabled={reconciliationBusy} onChange={e=>{setBulkReconciliationSelected(current=>e.target.checked?[...current,row.id]:current.filter(id=>id!==row.id));setBulkPaperSlipConfirmed(false);}}/> : "—"}</td><td>{row.lineNumber}</td><td>{row.referenceNumber || "—"}</td><td>{row.occurredOn}<small>{row.action === "delivered" ? "出荷" : row.action === "recovered" ? "回収" : row.action === "received" ? "入荷" : row.action === "supplier_return" ? "仕入先返却" : row.action || "—"}</small></td><td>{row.customer || row.supplier || "—"}<small>{row.branch}</small></td><td>{row.serialNumber}<small>{row.gasName || "ガス種未記録"} {row.capacity ? row.capacity + row.capacityUnit : ""}</small></td><td>{row.status === "applied" ? "登録済" : "取込エラー"}{row.error && <small className="reconciliationError">{row.error}</small>}{row.issues.map((issue, index) => <small className="reconciliationError" key={index}>要確認：{issue}</small>)}</td><td>{row.status !== "applied" ? "照合対象外" : <div className="reconciliationActions"><strong>{row.decision === "matched" ? "照合済" : row.decision === "hold" ? "保留" : "未照合"}</strong>{!reconciliationResult.finalized && <><label><input type="checkbox" checked={!!slipChecked[row.id]} onChange={event => setSlipChecked(current => ({ ...current, [row.id]: event.target.checked }))} /> 紙伝票と一致</label><textarea rows={2} value={reconciliationNotes[row.id] ?? ""} onChange={event => setReconciliationNotes(current => ({ ...current, [row.id]: event.target.value }))} placeholder="差異の確認内容・保留理由" /><div className="reconciliationRowButtons"><button type="button" disabled={reconciliationBusy || !slipChecked[row.id]} onClick={() => void reconcileRow(row, "matched")}>照合済にする</button><button type="button" disabled={reconciliationBusy || (reconciliationNotes[row.id] ?? "").trim().length < 3} onClick={() => void reconcileRow(row, "hold")}>保留する</button></div></>}</div>}</td></tr>)}</tbody></table></div>
<div className="reconciliationFooter"><button type="button" className="actionButton" disabled={reconciliationBusy || !!reconciliationResult.finalized || !reconciliationResult.summary.applied || !!reconciliationResult.summary.held || !!reconciliationResult.summary.unreviewed} onClick={() => void finalizeReconciliation()}>この取込の伝票照合を確定</button>{!!reconciliationResult.finalized && <button type="button" className="subtleButton" onClick={exportReconciledDeliveries}>確認済み出荷データCSV出力（売上未計上）</button>}</div><p className="instruction">取込エラー行は確定・出力対象外です。出荷データCSVには金額が含まれず、販売管理への連携には単価確認と売上確定処理が別途必要です。</p></>}
</section></div></>}
    {page === "inspection" && <><Breadcrumb items={["照会", "検査・保全"]} /><h1>検査・保全・棚卸管理</h1><div className="twoColumns"><section className="legacyPanel"><h2>耐圧検査 依頼・完了登録</h2><p className="instruction">依頼・完了は履歴として保存され、容器台帳の検査情報も更新します。</p><form className="legacyForm" onSubmit={submitOperation}><input type="hidden" name="action" value="inspection" /><label>容器<input name="containerId" list="container-options" required /></label><label>処理<select name="mode"><option value="sent">検査へ依頼</option><option value="completed">検査完了</option></select></label><label>検査日<input name="occurredOn" type="date" required /></label><label>検査先<input name="providerId" list="inspection-options" required /></label><label>次回期限（完了時）<input name="nextDueMonth" type="month" /></label><label>合格（完了時）<select name="passed"><option value="true">合格</option><option value="false">不合格</option></select></label><label className="wide">備考<input name="note" /></label><button className="actionButton">検査情報を登録</button></form></section><section className="legacyPanel"><h2>営業所 棚卸</h2><p className="instruction">営業所と棚卸日を指定して開始後、瓶号・バーコードを選択して読取登録します。</p><form className="legacyForm" onSubmit={submitOperation}><input type="hidden" name="action" value="startInventory" /><label>営業所<input name="branchId" list="branch-options" required /></label><label>棚卸日<input name="countedOn" type="date" required /></label><button className="actionButton">棚卸を開始</button></form>{inventorySessionId&&<form className="legacyForm" onSubmit={submitOperation}><input type="hidden" name="action" value="scanInventory" /><input type="hidden" name="sessionId" value={inventorySessionId}/><label>読取容器<input name="containerId" list="container-options" required /></label><button className="actionButton">読取登録</button></form>}<div className="workList"><WorkItem title="耐圧検査期限対象" detail="期限が入力済みの容器" count={`${inspectionDue} 本`} /><WorkItem title="棚卸状態" detail={inventorySessionId?"棚卸実施中。読取後に一覧で差異確認できます。":"棚卸日を指定して開始してください。"} count={inventorySessionId?"実施中":"未開始"} /></div></section></div></>}
    {page === "billing" && <><Breadcrumb items={["請求・月次", "使用料計算"]} /><h1>容器使用料計算</h1><section className="legacyPanel filters"><h2>対象月</h2><p className="instruction">93日間無料、94日目から31日あたり600円を日割り・月次切り捨てで計算します。回収日を含めて計算し、確定済みの再計算はできません。</p><label>対象年月<select className="billingMonthSelect" value={billingMonth} onChange={(event) => { setBillingMonth(event.target.value); setBillingResult(null); }}><option value="">対象年月を選択</option>{billingMonthOptions.map((month) => <option key={month.value} value={month.value}>{month.label}</option>)}</select></label><div><button className="actionButton" onClick={() => void loadBilling()} disabled={billingLoading}>使用料一覧を表示</button></div></section>{billingResult && <><div className="summaryGrid"><Summary label="対象貸出" value={`${billingResult.summary.count} 件`} detail="対象月に重なる貸出" /><Summary label="未確定" value={`${billingResult.summary.pending} 件`} detail="一括確定の対象" /><Summary label="確定済" value={`${billingResult.summary.calculated} 件`} detail="再計算不可" /><Summary label="使用料合計" value={`${billingResult.summary.amountYen.toLocaleString()} 円`} detail="確定済・未確定を含む" /></div><section className="legacyPanel"><div className="panelTitle"><h2>{billingResult.billingMonth.slice(0, 7)} 使用料明細</h2><span><button className="subtleButton" onClick={downloadBillingCsv}>CSV出力</button><button className="actionButton" onClick={() => void confirmBilling()} disabled={billingLoading || !billingResult.summary.pending}>未確定を一括確定</button></span></div><div className="tableWrap"><table className="legacyTable"><thead><tr><th>得意先</th><th>瓶号</th><th>納品日</th><th>回収日</th><th>課金日数</th><th>使用料</th><th>状態</th></tr></thead><tbody>{billingResult.items.length === 0 ? <tr><td colSpan={7}>この月の対象貸出はありません。</td></tr> : billingResult.items.map((item) => <tr key={item.loanId}><td>{item.customerName}</td><td><b>{item.containerSerialNumber}</b><small>{item.managementNumber || "－"}</small></td><td>{item.deliveredOn}</td><td>{item.recoveredOn || "貸出中"}</td><td>{item.billableDays} 日</td><td>{item.amountYen.toLocaleString()} 円</td><td><span className={`status ${item.calculated ? "recovered" : "on_loan"}`}>{item.calculated ? "確定済" : "未確定"}</span></td></tr>)}</tbody></table></div></section></>}</>}
    {page === "billing" && billingResult && <section className="legacyPanel demoPanel"><div className="panelTitle"><h2>請求・販売管理連携デモ</h2><span className="demoBadge">DEMO（外部連携は実行しません）</span></div><p className="instruction">明細を基に、得意先別の請求書プレビューと販売管理システムへ渡す形式のCSVを確認できます。</p><div className="demoActions"><button className="subtleButton" onClick={() => setShowInvoiceDemo((visible) => !visible)}>{showInvoiceDemo ? "請求書プレビューを閉じる" : "請求書プレビューを表示"}</button><button className="subtleButton" onClick={downloadSalesIntegrationDemo}>販売管理連携CSV（デモ）</button></div>{showInvoiceDemo && <div className="invoicePreview"><label className="invoiceCustomerPicker">請求先（取引先）<select value={invoiceCustomerId || billingCustomers[0]?.customerId || ""} onChange={(event) => setInvoiceCustomerId(event.target.value)}><option value="" disabled>取引先を選択</option>{billingCustomers.map((customer) => <option key={customer.customerId} value={customer.customerId}>{customer.customerName}</option>)}</select></label>{billingCustomers.length === 0 ? <p className="instruction">この対象月に請求対象の取引先はありません。</p> : billingCustomers.filter((customer) => customer.customerId === (invoiceCustomerId || billingCustomers[0]?.customerId)).map((customer) => <div key={customer.customerId}><div className="invoiceHeader"><span>松宮工材株式会社</span><b>容器使用料 ご請求書（デモ）</b><span>{billingResult.billingMonth.slice(0, 7)} 対象</span></div><div className="invoiceRecipient"><b>{customer.customerName} 御中</b><span>対象容器：{customer.count}本 ／ {customer.confirmed === customer.count ? "全件確定済" : `未確定を含む（${customer.confirmed}/${customer.count}件確定）`}</span></div><div className="tableWrap"><table className="legacyTable invoiceItemsTable"><thead><tr><th>瓶号</th><th>納品日</th><th>回収日</th><th>課金日数</th><th>使用料金</th><th>状態</th></tr></thead><tbody>{billingResult.items.filter((item) => item.customerId === customer.customerId).map((item) => <tr key={item.loanId}><td>{item.containerSerialNumber}</td><td>{item.deliveredOn}</td><td>{item.recoveredOn || "貸出中"}</td><td>{item.billableDays}日</td><td>{item.amountYen.toLocaleString()}円</td><td>{item.calculated ? "確定済" : "未確定"}</td></tr>)}<tr className="invoiceTotal"><td colSpan={4}>ご請求金額（{customer.customerName}）</td><td>{customer.amountYen.toLocaleString()}円</td><td>デモ</td></tr></tbody></table></div></div>)}<small>※ 取引先ごとに独立した請求書プレビューです。請求書の発行・送付、外部販売管理システムへの登録は行いません。金額は使用料明細から算出した税処理前のデモ金額です。</small></div>}</section>}
    {page === "sales" && <><Breadcrumb items={["請求・月次","売上候補確認"]}/><h1>売上候補確認・販売管理連携CSV</h1>
<section className="legacyPanel salesCandidatePanel"><div className="panelTitle"><h2>伝票照合済み出荷から売上候補を作成</h2><button type="button" className="subtleButton" onClick={()=>void fetchSalesBatches()} disabled={salesBusy}>確定済み取込を読み込む</button></div>
<p className="instruction">伝票照合を確定した取込の「照合済み・出荷」の明細だけが対象です。容器番号・納品先・ガス種を引き継ぎます。ハンディCSVに「実充填量・実充填量単位」があり、請求単位と一致する場合は実充填量を数量候補に自動反映し、標準換算との差異を表示します。実充填量がない場合は数量換算マスタを参照します。担当者が内容を確認・保存して確定します。一致するマスタがない場合は手動入力してください。売上の自動計上は行いません。</p>
{salesBatches.length>0 && <label className="salesBatchSelect">対象の取込履歴<select value={salesImportId} onChange={event=>void fetchSalesCandidates(event.target.value)}><option value="">取込履歴を選択</option>{salesBatches.map(batch=><option key={batch.id} value={batch.id}>{new Date(batch.finalizedAt).toLocaleString("ja-JP")} 確定 ／ {batch.source_filename??batch.id}</option>)}</select></label>}
{salesMessage && <p className="reconciliationMessage" role="status">{salesMessage}</p>}
{salesResult && <><div className="reconciliationCounts"><span>出荷候補 {salesResult.summary.total}件</span><span>確認済み {salesResult.summary.confirmed}件</span><span>未確認 {salesResult.summary.pending}件</span><span>確認済み売上合計 {salesResult.summary.totalSalesYen.toLocaleString("ja-JP")}円（税抜・仮）</span></div>
<div className="tableWrap"><table className="legacyTable salesCandidateTable"><thead><tr><th>伝票／出荷日</th><th>得意先</th><th>瓶号・ガス</th><th>商品コード・商品名</th><th>仕入先</th><th>数量・単位</th><th>売上単価／仕入単価</th><th>確認</th></tr></thead><tbody>{salesResult.candidates.length===0?<tr><td colSpan={8}>この取込に、照合済みの出荷明細はありません。</td></tr>:salesResult.candidates.map(row=><tr key={row.id}><td>{row.referenceNumber||"—"}<small>{row.deliveredOn}</small></td><td>{row.customer||"未設定"}</td><td>{row.serialNumber}<small>{row.gasName||"未設定"}</small></td><td>{row.confirmed?(row.productCode||"未設定"):(row.suggestion?.productCode??"商品マスタ未登録")}<small>{row.confirmed?(row.productName||"未設定"):(row.suggestion?.productName??"対応商品を登録してください")}</small>{!row.confirmed&&row.suggestion&&<small className="salesCandidateSuggestionLabel">マスタ候補・未確定</small>}</td><td>{row.confirmed?(row.supplier||"未設定"):(row.suggestion?.supplier||row.supplier||"仕入先未設定")}{!row.confirmed&&row.suggestion?.supplier&&<small className="salesCandidateSuggestionLabel">マスタ候補・未確定</small>}</td><td>{row.confirmed?`${row.quantity} ${row.unit}`:(row.actualFillSuggestion?`${row.actualFillSuggestion.quantity} ${row.actualFillSuggestion.unit}`:(row.quantitySuggestion?`${row.quantitySuggestion.quantity} ${row.quantitySuggestion.unit}`:`${row.quantity} ${row.unit}`))}{!row.confirmed&&row.actualFillSuggestion&&<small className="salesCandidateSuggestionLabel">ハンディ実充填量・未確定{row.actualFillSuggestion.differsFromStandard?"（標準換算と差異あり）":""}</small>}
{!row.confirmed&&!row.actualFillSuggestion&&row.quantitySuggestion&&<small className="salesCandidateSuggestionLabel">換算ルール候補・未確定</small>}</td><td>{(row.confirmed?row.saleUnitPrice:row.suggestion?.saleUnitPrice) == null?"未設定":Number(row.confirmed?row.saleUnitPrice:row.suggestion?.saleUnitPrice).toLocaleString("ja-JP")+"円"}<small>仕入：{(row.confirmed?row.purchaseUnitPrice:row.suggestion?.purchaseUnitPrice) == null?"未設定":Number(row.confirmed?row.purchaseUnitPrice:row.suggestion?.purchaseUnitPrice).toLocaleString("ja-JP")+"円"}</small>{!row.confirmed&&row.suggestion&&<small className="salesCandidateSuggestionLabel">マスタ候補・未確定</small>}</td><td><text>{row.confirmed?"確認済み":"要確認"}</text><button type="button" className="subtleButton" onClick={()=>editSalesCandidate(row)}>{row.confirmed?"再確認":"入力・確認"}</button></td></tr>)}</tbody></table></div>
{salesDraftId!==null && <section className="salesEditPanel"><h3>売上候補の入力・確認（明細ID {salesDraftId}）</h3><div className="salesEditGrid">
{salesPriceHistoryNote&&<div className="salesSuggestion"><b>同じ得意先・商品の過去の確認記録（参照用）</b><p className="instruction">{salesPriceHistoryNote}</p>{salesPriceHistory.length?<div className="tableWrap"><table className="legacyTable"><thead><tr><th>出荷日</th><th>数量</th><th>確認時の売上単価</th><th>確認時の仕入単価</th></tr></thead><tbody>{salesPriceHistory.map((item,index)=><tr key={index}><td>{item.date}</td><td>{item.quantity} {item.unit}</td><td>{item.salePrice.toLocaleString("ja-JP")}円</td><td>{item.purchasePrice.toLocaleString("ja-JP")}円</td></tr>)}</tbody></table></div>:<p>該当する過去の確認記録はありません。</p>}</div>}
{salesResult?.candidates.find(item=>item.id===salesDraftId)?.suggestion && <div className="salesSuggestion"><b>商品・単価マスタ候補</b><p>{salesResult.candidates.find(item=>item.id===salesDraftId)?.suggestion?.productCode} ／ {salesResult.candidates.find(item=>item.id===salesDraftId)?.suggestion?.productName}</p><p>売上単価：{salesResult.candidates.find(item=>item.id===salesDraftId)?.suggestion?.saleUnitPrice??"未設定"}円 ／ 仕入単価：{salesResult.candidates.find(item=>item.id===salesDraftId)?.suggestion?.purchaseUnitPrice??"未設定"}円</p>{salesResult.candidates.find(item=>item.id===salesDraftId)?.suggestion?.warnings.map((warning,index)=><p className="salesWarning" key={index}>{warning}</p>)}<button type="button" className="subtleButton" onClick={applySalesSuggestion}>候補を入力欄に反映（未確定）</button></div>}
<label>商品コード<input value={salesDraft.productCode} onChange={e=>setSalesDraft(v=>({...v,productCode:e.target.value}))}/></label>
<label>商品名<input value={salesDraft.productName} onChange={e=>setSalesDraft(v=>({...v,productName:e.target.value}))}/></label>
<label>仕入先<input value={salesDraft.supplier} onChange={e=>setSalesDraft(v=>({...v,supplier:e.target.value}))}/></label>
{salesResult?.candidates.find(item=>item.id===salesDraftId)?.actualFillSuggestion && <div className="salesSuggestion">
<b>ハンディ実充填量（自動反映候補）</b>
<p>{salesResult.candidates.find(item=>item.id===salesDraftId)?.actualFillSuggestion?.quantity} {salesResult.candidates.find(item=>item.id===salesDraftId)?.actualFillSuggestion?.unit} ／ {salesResult.candidates.find(item=>item.id===salesDraftId)?.actualFillSuggestion?.source}</p>
{salesResult.candidates.find(item=>item.id===salesDraftId)?.actualFillSuggestion?.standardQuantity!=null && <p>標準換算：{salesResult.candidates.find(item=>item.id===salesDraftId)?.actualFillSuggestion?.standardQuantity} {salesResult.candidates.find(item=>item.id===salesDraftId)?.actualFillSuggestion?.unit} ／ {salesResult.candidates.find(item=>item.id===salesDraftId)?.actualFillSuggestion?.differsFromStandard?"差異あり・実充填量を確認":"標準換算と一致"}</p>}
<p className="instruction">入力欄に実充填量を反映済みです。保存するまでは未確定です。</p>
<button type="button" className="subtleButton" onClick={applyActualFillSuggestion}>実充填量を再反映</button></div>}
{salesResult?.candidates.find(item=>item.id===salesDraftId)?.actualFillWarning && <p className="salesWarning">{salesResult.candidates.find(item=>item.id===salesDraftId)?.actualFillWarning}</p>}
{salesResult?.candidates.find(item=>item.id===salesDraftId)?.quantitySuggestion && <div className="salesSuggestion"><b>得意先別の換算ルール</b><p>{salesResult.candidates.find(item=>item.id===salesDraftId)?.quantitySuggestion?.quantity} {salesResult.candidates.find(item=>item.id===salesDraftId)?.quantitySuggestion?.unit} ／ 容器1本（登録済みルール）</p><button type="button" className="subtleButton" onClick={applyQuantitySuggestion}>換算数量を反映（要確認）</button></div>}
<label>数量<input type="number" min="0.001" step="0.001" value={salesDraft.quantity} onChange={e=>setSalesDraft(v=>({...v,quantity:e.target.value,quantitySource:"manual",quantityRuleId:null}))}/></label>
<label>単位<input value={salesDraft.unit} onChange={e=>setSalesDraft(v=>({...v,unit:e.target.value,quantitySource:"manual",quantityRuleId:null}))}/></label>
<label>数量の根拠<select value={salesDraft.quantitySource} onChange={e=>setSalesDraft(v=>({...v,quantitySource:e.target.value as "rule"|"actual_fill"|"manual",quantityRuleId:e.target.value==="rule"?v.quantityRuleId:null}))}><option value="manual">手動補正</option><option value="actual_fill" disabled={!salesResult?.candidates.find(item=>item.id===salesDraftId)?.actualFillSuggestion}>ハンディ実充填量を確認</option>{salesDraft.quantityRuleId&&<option value="rule">登録済み換算ルール</option>}</select></label>
{salesDraft.quantitySource!=="rule"&&<label className="salesQuantityReason">数量の根拠・補正理由（必須）<textarea rows={2} value={salesDraft.quantityReason} onChange={e=>setSalesDraft(v=>({...v,quantityReason:e.target.value}))}/></label>}
<label>売上単価（円／単位）<input type="number" min="0" step="0.01" value={salesDraft.saleUnitPrice} onChange={e=>setSalesDraft(v=>({...v,saleUnitPrice:e.target.value}))}/></label>
<label>仕入単価（円／単位）<input type="number" min="0" step="0.01" value={salesDraft.purchaseUnitPrice} onChange={e=>setSalesDraft(v=>({...v,purchaseUnitPrice:e.target.value}))}/></label>
<label>確認メモ<input value={salesDraft.note} onChange={e=>setSalesDraft(v=>({...v,note:e.target.value}))}/></label></div>
<p className="instruction">数量の初期値「1本」は出荷容器1本を表します。得意先別の換算ルールがある場合は候補を反映できます。実充填量や手動変更は、確認した根拠・修正理由の記録が必須です。容量からの自動推定は行いません。</p>
<div className="reconciliationFooter"><button type="button" className="actionButton" disabled={salesBusy} onClick={()=>void confirmSalesCandidate()}>内容を確認して保存</button><button type="button" className="subtleButton" onClick={()=>setSalesDraftId(null)}>キャンセル</button></div></section>}
{salesGroupTotals.length>0 && <section className="salesGroupSection"><h3>取引先・商品別の確認済み集計</h3><div className="tableWrap"><table className="legacyTable"><thead><tr><th>得意先</th><th>商品コード</th><th>商品名</th><th>確認行数</th><th>数量</th><th>売上金額（税抜・仮）</th></tr></thead><tbody>{salesGroupTotals.map((item,index)=><tr key={index}><td>{item.customer}</td><td>{item.productCode}</td><td>{item.productName}</td><td>{item.count}行</td><td>{item.quantity} {item.unit}</td><td>{item.total.toLocaleString("ja-JP")}円</td></tr>)}</tbody></table></div></section>}
<div className="reconciliationFooter"><button type="button" className="actionButton" disabled={salesBusy||!salesResult.summary.total||!!salesResult.summary.pending} onClick={()=>void exportSalesCandidates()}>全明細確認済みの売上候補CSVを出力</button></div>
<p className="instruction">CSV出力は販売管理への正式な送信ではありません。実際の販売管理システムへの取込形式・売上計上仕様は別途確認が必要です。エラー・回収・保留・未照合の明細は候補に含まれません。</p></>}</section>
<section className="legacyPanel salesCandidatePanel"><div className="panelTitle"><h2>商品・単価マスタ登録</h2><button type="button" className="subtleButton" disabled={salesBusy} onClick={()=>void fetchSalesMasters().catch(error=>setSalesMasterMessage(error instanceof Error?error.message:"取得できませんでした。"))}>マスタ再読込</button></div>
<p className="instruction">商品・単価は適用期間を管理し、出荷日時点で有効なマスタを候補に表示します。得意先・商品別に登録された換算ルールに基づき、容器1本あたりの請求数量（㎥・kgなど）を自動算出し、候補として表示します。確定には担当者の確認・保存が必要です。ハンディCSVに実充填量が記録され、請求単位と一致する場合は数量候補に自動反映します。</p>
<div className="monthlyTabs"><button className={salesMasterTab==="product"?"selected":""} type="button" onClick={()=>setSalesMasterTab("product")}>商品コード・商品マスタ</button><button className={salesMasterTab==="price"?"selected":""} type="button" onClick={()=>setSalesMasterTab("price")}>得意先別・仕入先別単価</button><button className={salesMasterTab==="quantity"?"selected":""} type="button" onClick={()=>setSalesMasterTab("quantity")}>得意先別の数量換算</button></div>
{salesMasterMessage&&<p className="reconciliationMessage" role="status">{salesMasterMessage}</p>}
{!salesMasters?<p className="instruction">「確定済み取込を読み込む」または「マスタ再読込」で登録画面を準備してください。</p>:
<>
<datalist id="sales-gas-suggest">{salesMasters.gases.map(x=><option key={x.id} value={x.code?`${x.code} — ${x.name}`:x.name}/>)}</datalist>
<datalist id="sales-supplier-suggest">{salesMasters.suppliers.map(x=><option key={x.id} value={x.code?`${x.code} — ${x.name}`:x.name}/>)}</datalist>
<datalist id="sales-owner-suggest">{salesMasters.owners.map(x=><option key={x.id} value={x.code?`${x.code} — ${x.name}`:x.name}/>)}</datalist>
<datalist id="sales-customer-suggest">{salesMasters.customers.map(x=><option key={x.id} value={x.name}/>)}</datalist>
<datalist id="sales-product-suggest">{salesMasters.products.map(x=><option key={x.id} value={`${x.product_code} — ${x.product_name}`}/>)}</datalist>
{salesMasterTab==="quantity"?<div className="salesEditPanel"><h3>得意先別の請求数量・単位</h3><div className="salesEditGrid">
<label>得意先<input list="sales-customer-suggest" value={quantityMasterForm.customer} onChange={e=>setQuantityMasterForm(v=>({...v,customer:e.target.value}))}/></label>
<label>商品<input list="sales-product-suggest" value={quantityMasterForm.product} onChange={e=>setQuantityMasterForm(v=>({...v,product:e.target.value}))}/></label>
<label>請求単位（本・㎥・kgなど）<input value={quantityMasterForm.unit} onChange={e=>setQuantityMasterForm(v=>({...v,unit:e.target.value}))}/></label>
<label>容器1本あたりの請求数量<input type="number" min="0.001" step="0.001" value={quantityMasterForm.perContainer} onChange={e=>setQuantityMasterForm(v=>({...v,perContainer:e.target.value}))}/></label>
<label>適用開始日<input type="date" value={quantityMasterForm.from} onChange={e=>setQuantityMasterForm(v=>({...v,from:e.target.value}))}/></label>
<label>適用終了日（任意）<input type="date" value={quantityMasterForm.until} onChange={e=>setQuantityMasterForm(v=>({...v,until:e.target.value}))}/></label>
</div><p className="instruction">換算例：1本＝7㎥など、取引先と確認済みの値のみ登録してください。実充填量が異なる場合は売上候補画面で個別に補正します。</p><button type="button" className="actionButton" disabled={salesBusy} onClick={()=>void saveSalesMaster()}>数量換算ルールを登録</button></div>:salesMasterTab==="product"?<div className="salesEditPanel"><div className="salesEditGrid">
<label>ガス種<input list="sales-gas-suggest" value={productMasterForm.gas} onChange={e=>setProductMasterForm(v=>({...v,gas:e.target.value}))}/></label>
<label>仕入先（任意）<input list="sales-supplier-suggest" value={productMasterForm.supplier} onChange={e=>setProductMasterForm(v=>({...v,supplier:e.target.value}))}/></label>
<label>容器保有者（任意）<input list="sales-owner-suggest" value={productMasterForm.owner} onChange={e=>setProductMasterForm(v=>({...v,owner:e.target.value}))}/></label>
<label>商品コード<input value={productMasterForm.code} onChange={e=>setProductMasterForm(v=>({...v,code:e.target.value}))}/></label>
<label>商品名<input value={productMasterForm.name} onChange={e=>setProductMasterForm(v=>({...v,name:e.target.value}))}/></label>
<label>販売単位<input value={productMasterForm.unit} onChange={e=>setProductMasterForm(v=>({...v,unit:e.target.value}))}/></label>
</div><button type="button" className="actionButton" disabled={salesBusy} onClick={()=>void saveSalesMaster()}>商品マスタを登録</button></div>:
<div className="salesEditPanel"><div className="monthlyTabs"><button type="button" className={priceMasterForm.kind==="sale"?"selected":""} onClick={()=>setPriceMasterForm(v=>({...v,kind:"sale"}))}>販売単価</button><button type="button" className={priceMasterForm.kind==="purchase"?"selected":""} onClick={()=>setPriceMasterForm(v=>({...v,kind:"purchase"}))}>仕入単価</button></div><div className="salesEditGrid">
<label>商品<input list="sales-product-suggest" value={priceMasterForm.product} onChange={e=>setPriceMasterForm(v=>({...v,product:e.target.value}))}/></label>
{priceMasterForm.kind==="sale"?<label>得意先<input list="sales-customer-suggest" value={priceMasterForm.customer} onChange={e=>setPriceMasterForm(v=>({...v,customer:e.target.value}))}/></label>:
<><label>仕入先<input list="sales-supplier-suggest" value={priceMasterForm.supplier} onChange={e=>setPriceMasterForm(v=>({...v,supplier:e.target.value}))}/></label><label>容器保有者（任意）<input list="sales-owner-suggest" value={priceMasterForm.owner} onChange={e=>setPriceMasterForm(v=>({...v,owner:e.target.value}))}/></label></>}
<label>単価（円／商品単位）<input type="number" step="0.01" min="0" value={priceMasterForm.price} onChange={e=>setPriceMasterForm(v=>({...v,price:e.target.value}))}/></label>
<label>適用開始日<input type="date" value={priceMasterForm.from} onChange={e=>setPriceMasterForm(v=>({...v,from:e.target.value}))}/></label>
<label>適用終了日（任意）<input type="date" value={priceMasterForm.until} onChange={e=>setPriceMasterForm(v=>({...v,until:e.target.value}))}/></label>
</div><button type="button" className="actionButton" disabled={salesBusy} onClick={()=>void saveSalesMaster()}>単価ルールを登録</button></div>}
<div className="salesGroupSection"><h3>登録済み商品・単価ルール</h3><p className="instruction">商品マスタ：{salesMasters.products.length}件 ／ 単価ルール：{salesMasters.prices.length}件 ／ 得意先別換算ルール：{salesMasters.quantities.length}件。価格の適用条件が重複する場合は候補を自動採用しません。</p><div className="tableWrap"><table className="legacyTable"><thead><tr><th>商品コード</th><th>商品名</th><th>ガス種</th><th>単位</th><th>単価ルール</th></tr></thead><tbody>{salesMasters.products.length?salesMasters.products.map(p=>{
  const matchedPrices=salesMasters.prices.filter(rule=>rule.product_mapping_id===p.id);
  const matchedQuantities=salesMasters.quantities.filter(rule=>rule.product_mapping_id===p.id);
  const expanded=expandedSalesMasterId===p.id;
  return <Fragment key={p.id}><tr><td>{p.product_code}</td><td>{p.product_name}</td><td>{salesMasters.gases.find(g=>g.id===p.gas_type_id)?.name??"—"}</td><td>{p.unit}</td><td><button type="button" className="salesRuleDetailToggle" aria-expanded={expanded} aria-controls={`sales-master-details-${p.id}`} onClick={()=>setExpandedSalesMasterId(current=>current===p.id?null:p.id)}>{matchedPrices.length}件 <span aria-hidden="true">{expanded?"▲":"▼"}</span><span className="salesRuleToggleLabel">{expanded?"詳細を閉じる":"詳細を見る"}</span></button></td></tr>
  {expanded&&<tr className="salesRuleDetailRow"><td colSpan={5}><div id={`sales-master-details-${p.id}`} className="salesRuleDetailPanel">
  <h4>単価ルール詳細（{matchedPrices.length}件）</h4>
  {matchedPrices.length?<div className="tableWrap"><table className="legacyTable salesRuleNestedTable"><thead><tr><th>区分</th><th>対象取引先</th><th>容器保有者</th><th>単価</th><th>適用開始日</th><th>適用終了日</th></tr></thead><tbody>{matchedPrices.map(rule=><tr key={rule.id}><td>{rule.price_kind==="sale"?"販売単価":"仕入単価"}</td><td>{rule.price_kind==="sale"?(salesMasters.customers.find(c=>c.id===rule.customer_id)?.name??"未設定"):(salesMasters.suppliers.find(v=>v.id===rule.supplier_id)?.name??"未設定")}</td><td>{rule.owner_id?(salesMasters.owners.find(o=>o.id===rule.owner_id)?.name??"未設定"):"指定なし"}</td><td>{Number(rule.unit_price).toLocaleString("ja-JP")}円／{p.unit}</td><td>{rule.effective_from}</td><td>{rule.effective_until??"無期限"}</td></tr>)}</tbody></table></div>:<p>登録されている単価ルールはありません。</p>}
  <h4>得意先別の数量換算ルール（{matchedQuantities.length}件）</h4>
  {matchedQuantities.length?<div className="tableWrap"><table className="legacyTable salesRuleNestedTable"><thead><tr><th>得意先</th><th>1本あたりの請求数量</th><th>適用開始日</th><th>適用終了日</th></tr></thead><tbody>{matchedQuantities.map(rule=><tr key={rule.id}><td>{salesMasters.customers.find(c=>c.id===rule.customer_id)?.name??"未設定"}</td><td>{Number(rule.quantity_per_container).toLocaleString("ja-JP")} {rule.billing_unit}／本</td><td>{rule.effective_from}</td><td>{rule.effective_until??"無期限"}</td></tr>)}</tbody></table></div>:<p>登録されている数量換算ルールはありません。</p>}
  <p className="instruction">登録済みのマスタデータを表示しています。適用条件・単価は登録内容をご確認ください。</p>
  </div></td></tr>}</Fragment>;
}):<tr><td colSpan={5}>商品マスタはまだありません。</td></tr>}</tbody></table></div></div>
</>}</section></>}
    {page === "monthly" && <><Breadcrumb items={["請求・月次", "月次処理・帳票"]} /><h1>月次処理・帳票</h1>
      <section className="legacyPanel"><h2>月次業務の対象年月</h2><div className="monthlyControls"><label>対象年月<select value={monthlyMonth} onChange={event => { setMonthlyMonth(event.target.value); setMonthlyReport(null); setMonthlyError(""); }}>{billingMonthOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button type="button" className="actionButton" disabled={monthlyLoading} onClick={() => void loadMonthlyReport()}>{monthlyLoading ? "読み込み中…" : "月次データを表示"}</button></div>{monthlyError && <p className="monthlyError" role="alert">{monthlyError}</p>}</section>
      <section className="legacyPanel"><h2>月次業務メニュー</h2><div className="monthlyTabs">{([["inventory", "保有者別在庫"], ["inspection", "耐圧期限アラート"], ["stocktake", "容器棚卸"], ["sales", "販売管理連携"]] as const).map(([tab, label]) => <button type="button" key={tab} className={monthlyTab === tab ? "selected" : ""} onClick={() => setMonthlyTab(tab)}>{label}</button>)}</div>
      {!monthlyReport && !monthlyLoading && <p className="instruction">対象年月を選び「月次データを表示」を押してください。</p>}
      {monthlyLoading && <p className="instruction">月次データを読み込んでいます…</p>}
      {monthlyReport && <><p className="monthlyNotice">{monthlyReport.snapshotNote}</p>
      {monthlyTab === "inventory" && <div className="monthlySection"><div className="monthlySectionHead"><h3>保有者・営業所・ガス種別在庫（合計 {monthlyReport.inventoryTotal} 本）</h3><button type="button" className="subtleButton" onClick={() => exportMonthlyCsv("inventory")}>在庫CSV出力</button></div><div className="tableWrap"><table className="legacyTable monthlyTable"><thead><tr><th>保有者</th><th>営業所</th><th>ガス種</th><th>在庫本数</th></tr></thead><tbody>{monthlyReport.inventory.length ? monthlyReport.inventory.map((item, index) => <tr key={index}><td>{item.owner}</td><td>{item.branch}</td><td>{item.gas}</td><td>{item.count} 本</td></tr>) : <tr><td colSpan={4}>在庫データはありません。</td></tr>}</tbody></table></div></div>}
      {monthlyTab === "inspection" && <div className="monthlySection"><div className="monthlySectionHead"><h3>耐圧検査の期限到来・3か月以内（{monthlyReport.alerts.length} 本）</h3><button type="button" className="subtleButton" onClick={() => exportMonthlyCsv("inspection")}>期限CSV出力</button></div><div className="tableWrap"><table className="legacyTable monthlyTable"><thead><tr><th>瓶号</th><th>管理番号</th><th>所在地</th><th>耐圧期限</th><th>判定</th></tr></thead><tbody>{monthlyReport.alerts.length ? monthlyReport.alerts.map((item, index) => <tr key={index}><td>{item.serialNumber}</td><td>{item.managementNumber || "—"}</td><td>{item.branch}</td><td>{item.due}</td><td>{item.kind}</td></tr>) : <tr><td colSpan={5}>期限対象の容器はありません。</td></tr>}</tbody></table></div></div>}
      {monthlyTab === "stocktake" && <div className="monthlySection"><div className="monthlySectionHead"><h3>対象月の棚卸実施状況</h3><button type="button" className="subtleButton" onClick={() => exportMonthlyCsv("stocktake")}>棚卸CSV出力</button></div><div className="tableWrap"><table className="legacyTable monthlyTable"><thead><tr><th>棚卸日</th><th>営業所</th><th>状態</th><th>帳簿在庫</th><th>読取済</th><th>未読取</th><th>帳簿外</th></tr></thead><tbody>{monthlyReport.inventorySessions.length ? monthlyReport.inventorySessions.map(item => <tr key={item.id}><td>{item.countedOn}</td><td>{item.branch}</td><td>{item.status === "closed" ? "確定済" : "実施中"}</td><td>{item.expected}</td><td>{item.scanned}</td><td>{item.missing}</td><td>{item.unexpected}</td></tr>) : <tr><td colSpan={7}>この月の棚卸実績はありません。</td></tr>}</tbody></table></div><p className="instruction">棚卸開始・読取登録は「検査・保全照会」ページから実行できます。</p><button type="button" className="subtleButton" onClick={() => choosePage("inspection")}>棚卸登録画面へ</button></div>}
      {monthlyTab === "sales" && <div className="monthlySection"><h3>使用料確定・取引先別請求・販売管理連携</h3><p className="instruction">請求対象の確認、使用料確定、得意先別請求書プレビュー、販売管理連携CSV（デモ）は「使用料計算」画面で行います。実システムへの自動送信は未実装です。</p><button type="button" className="actionButton" onClick={openMonthlyBilling}>選択月の使用料計算へ</button></div>}
      </>}</section></>}
    {page === "masters" && <><Breadcrumb items={["マスタ・設定", "マスタ登録"]} /><h1>マスタ登録</h1><section className="legacyPanel"><h2>登録対象</h2><div className="masterTabs">{(Object.keys(masterLabels) as MasterKind[]).map((kind) => <button className={masterKind === kind ? "selected" : ""} key={kind} onClick={() => setMasterKind(kind)}>{masterLabels[kind]}</button>)}</div><form className="masterForm" onSubmit={submitMaster}>{masterKind === "container" ? <><label>瓶号<input name="serialNumber" required /></label><label>容器種別<input name="containerType" required  /></label><label>管理番号<input name="managementNumber" /></label><label>バーコード<input name="barcode" /></label><label>保有者<input name="ownerId" list="owner-options" /></label><label>ガス種<input name="gasTypeId" list="gas-options" /></label><label>初期営業所<input name="branchId" list="branch-options" /></label><label>容器形態<select name="containerForm"><option value="single">単瓶</option><option value="valve_equipped">弁付き</option><option value="lgc">LGC</option><option value="cardle">カードル</option><option value="cardle_assembly">カードル組立</option><option value="cardle_product">カードル製品</option><option value="cardle_frame">カードル枠</option></select></label><label>容量<input name="capacityValue" type="number" min="0" step="0.01" /></label><label>容量単位<input name="capacityUnit"  /></label><label>耐圧検査期限<input name="pressureTestDueMonth" type="month" /></label><label className="wide">備考<input name="notes" /></label></> : <><label>{masterKind === "branch" ? "営業所名" : masterKind === "customer" ? "得意先名" : masterKind === "supplier" ? "仕入先名" : masterKind === "owner" ? "保有者名" : masterKind === "gas" ? "ガス種名" : "検査先名"}<input name="name" required /></label>{["supplier", "owner", "gas", "inspection"].includes(masterKind) && <label>コード<input name="code" required /></label>}{masterKind === "owner" && <label>保有者区分<select name="ownerKind"><option value="self">自社</option><option value="manufacturer">メーカー</option><option value="user">ユーザー</option><option value="other">その他</option></select></label>}{masterKind === "gas" && <label>基本単位<input name="basicUnit" defaultValue="本" /></label>}{masterKind === "inspection" && <label>電話番号<input name="phone" /></label>}</>}<button className="actionButton wide">{masterLabels[masterKind]}を登録</button></form></section><section className="legacyPanel"><h2>マスタ件数</h2><div className="summaryGrid small"><Summary label="営業所" value={`${masters.branches.length} 件`} detail="" /><Summary label="得意先" value={`${masters.customers.length} 件`} detail="" /><Summary label="仕入先" value={`${masters.suppliers.length} 件`} detail="" /><Summary label="ガス種" value={`${masters.gases.length} 件`} detail="" /></div></section></>}
    <datalist id="container-options">{containers.map((item) => <option key={item.id} value={item.serial_number}>{[item.management_number, item.barcode].filter(Boolean).join(" / ")}</option>)}</datalist>
    <datalist id="customer-options">{masters.customers.map((item) => <option key={item.id} value={item.name} />)}</datalist>
    <datalist id="supplier-options">{masters.suppliers.map((item) => <option key={item.id} value={item.name}>{item.code}</option>)}</datalist>
    <datalist id="branch-options">{masters.branches.map((item) => <option key={item.id} value={item.name} />)}</datalist><datalist id="owner-options">{masters.owners.map((item) => <option key={item.id} value={item.name} />)}</datalist><datalist id="gas-options">{masters.gases.map((item) => <option key={item.id} value={item.name} />)}</datalist><datalist id="inspection-options">{masters.inspections.map((item) => <option key={item.id} value={item.name} />)}</datalist>
    {page === "inspection" && inventorySessionId && <section className="legacyPanel"><div className="panelTitle"><h2>棚卸差異</h2><button type="button" className="subtleButton" onClick={() => void loadInventoryDifference()}>差異を更新</button></div>{inventoryDifference ? <><p className="instruction">帳簿在庫 {inventoryDifference.expected} 本 ／ 読取済 {inventoryDifference.scanned} 本 ／ 未読取 {inventoryDifference.missing.length} 本 ／ 帳簿外読取 {inventoryDifference.unexpected.length} 本</p><div className="tableWrap"><table className="legacyTable"><thead><tr><th>区分</th><th>瓶号</th><th>管理番号</th></tr></thead><tbody>{inventoryDifference.missing.length === 0 && inventoryDifference.unexpected.length === 0 ? <tr><td colSpan={3}>差異はありません。</td></tr> : <>{inventoryDifference.missing.map((item) => <tr key={`missing-${item.id}`}><td>未読取（帳簿在庫）</td><td>{item.serial_number}</td><td>{item.management_number || "－"}</td></tr>)}{inventoryDifference.unexpected.map((item) => <tr key={`unexpected-${item.container_id}`} className="sequenceError"><td>帳簿外読取</td><td>{item.containers?.serial_number || "不明"}</td><td>{item.containers?.management_number || "－"}</td></tr>)}</>}</tbody></table></div></> : <p className="instruction">読取後に「差異を更新」を押すと、帳簿在庫との照合結果を表示します。</p>}<form className="legacyForm" onSubmit={submitOperation}><input type="hidden" name="action" value="closeInventory" /><input type="hidden" name="sessionId" value={inventorySessionId}/><button className="subtleButton">棚卸を確定</button></form></section>}
    <p className="notice" role="status">{notice}</p>
  </main></div></div>;
}

/**
 * Shared feedback for server operations across all screens. It attaches to existing
 * buttons without changing their business logic and follows request completion.
 */
function NetworkActionFeedback() {
  const [pending, setPending] = useState(0);
  const [actionLabel, setActionLabel] = useState("データを読み込み中");
  useEffect(() => {
    const originalFetch = window.fetch;
    let lastAction: HTMLButtonElement | null = null;
    let clickExpiry = 0;
    let inFlight = 0;
    let mounted = true;
    const buttonCounts = new Map<HTMLButtonElement, { count: number; disabled: boolean }>();
    const captureClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest("button");
      if (!(button instanceof HTMLButtonElement) || button.disabled) return;
      lastAction = button;
      clickExpiry = Date.now() + 750;
    };
    const captureSubmit = (event: SubmitEvent) => {
      const button = event.submitter;
      if (!(button instanceof HTMLButtonElement)) return;
      lastAction = button;
      clickExpiry = Date.now() + 750;
    };
    document.addEventListener("click", captureClick, true);
    document.addEventListener("submit", captureSubmit, true);
    const trackedFetch: typeof fetch = (input, init) => {
      const button = Date.now() <= clickExpiry ? lastAction : null;
      const label = button?.textContent?.replace(/\s+/g, " ").trim() || "データを読み込み中";
      inFlight += 1;
      if (mounted) {
        setPending(inFlight);
        setActionLabel(label);
      }
      if (button) {
        const existing = buttonCounts.get(button);
        if (existing) existing.count++;
        else {
          buttonCounts.set(button, { count: 1, disabled: button.disabled });
          button.classList.add("networkButtonBusy");
          button.setAttribute("aria-busy", "true");
          button.disabled = true;
        }
      }
      let promise: Promise<Response>;
      try {
        promise = originalFetch.call(window, input, init);
      } catch (error) {
        promise = Promise.reject(error);
      }
      return promise.finally(() => {
        inFlight = Math.max(0, inFlight - 1);
        if (mounted) setPending(inFlight);
        if (!button) return;
        const state = buttonCounts.get(button);
        if (!state) return;
        state.count--;
        if (state.count === 0) {
          button.disabled = state.disabled;
          button.classList.remove("networkButtonBusy");
          button.removeAttribute("aria-busy");
          buttonCounts.delete(button);
        }
      });
    };
    window.fetch = trackedFetch;
    return () => {
      mounted = false;
      document.removeEventListener("click", captureClick, true);
      document.removeEventListener("submit", captureSubmit, true);
      if (window.fetch === trackedFetch) window.fetch = originalFetch;
      for (const [button, state] of buttonCounts) {
        button.disabled = state.disabled;
        button.classList.remove("networkButtonBusy");
        button.removeAttribute("aria-busy");
      }
    };
  }, []);
  if (!pending) return null;
  return <div className="networkActivityIndicator" role="status" aria-live="polite">
    <span className="networkActivitySpinner" aria-hidden="true"/>
    <span>{actionLabel === "データを読み込み中" ? actionLabel : `${actionLabel}：処理中…`}</span>
    <span className="networkActivityProgress" aria-hidden="true"/>
  </div>;
}

function Breadcrumb({ items }: { items: string[] }) { return <div className="crumb">業務メニュー　&gt;　{items.join("　&gt;　")}</div>; }
function Summary({ label, value, detail }: { label: string; value: string; detail: string }) { return <article className="summaryCard"><span>{label}</span><b>{value}</b>{detail && <small>{detail}</small>}</article>; }
function MenuButton({ title, detail }: { title: string; detail: string }) { return <article><b>{title}</b><span>{detail}</span></article>; }
function WorkItem({ title, detail, count }: { title: string; detail: string; count: string }) { return <article><div><b>{title}</b><span>{detail}</span></div><em>{count}</em></article>; }
