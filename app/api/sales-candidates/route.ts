import { NextRequest, NextResponse } from "next/server";
import { requireAuthorizedUser, canManageMasters } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";

type SourceRow = {
  id: number; line_number: number; action: string | null; status: string;
  occurred_on: string | null; container_id: string | null;
  barcode: string | null; raw_row: Record<string,string> | null;
};
type Review = {
  import_row_id: number; product_code: string; product_name: string; supplier_name: string;
  quantity: number; unit: string; sale_unit_price: number; purchase_unit_price: number;
  note: string; confirmed_at: string; quantity_source: "rule" | "actual_fill" | "manual"; quantity_reason: string; quantity_rule_id: string | null;
};
type Candidate = {
  id: number; lineNumber: number; deliveredOn: string; referenceNumber: string; customer: string;
  branch: string; serialNumber: string; gasName: string; quantity: number; unit: string;
  productCode: string; productName: string; supplier: string; saleUnitPrice: number | null;
  purchaseUnitPrice: number | null; note: string; confirmed: boolean; confirmedAt: string | null;
  quantitySource: "rule" | "actual_fill" | "manual"; quantityReason: string; quantityRuleId: string | null;
  quantitySuggestion: { ruleId: string; quantity: number; unit: string; explanation: string } | null;
  actualFillSuggestion: { quantity: number; unit: string; source: string; standardQuantity: number | null; differsFromStandard: boolean } | null;
  actualFillWarning: string | null;
  suggestion: { productCode: string; productName: string; supplier: string; unit: string; saleUnitPrice: number | null; purchaseUnitPrice: number | null; source: string; warnings: string[] } | null;
};
const validUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const rawText = (raw: Record<string,string> | null, key: string, alternative: string) => String(raw?.[key] ?? raw?.[alternative] ?? "").trim();

async function authorized() {
  const user = await requireAuthorizedUser();
  if (!user) return { user: null, error: NextResponse.json({ error: "ログインが必要です。" }, { status: 401 }) };
  if (!canManageMasters(user)) return { user: null, error: NextResponse.json({ error: "売上候補の確認は管理者のみ実行できます。" }, { status: 403 }) };
  return { user, error: null };
}
async function loadCandidates(importId: string) {
  const db = adminClient();
  const [batch, finalization, rows] = await Promise.all([
    db.from("handheld_imports").select("id,source_filename,created_at,total_rows,applied_rows,error_rows").eq("id", importId).maybeSingle(),
    db.from("handheld_reconciliation_finalizations").select("import_id").eq("import_id",importId).maybeSingle(),
    db.from("handheld_import_rows").select("id,line_number,action,status,occurred_on,container_id,barcode,raw_row")
      .eq("import_id",importId).eq("status","applied").eq("action","delivered").order("line_number")
  ]);
  const failure = [batch, finalization, rows].find(result => result.error);
  if (failure?.error) throw new Error(failure.error.message);
  if (!batch.data) throw new Error("対象の取込履歴が見つかりません。");
  if (!finalization.data) throw new Error("伝票照合が未確定です。まずハンディ取込ページで照合を確定してください。");
  const source = (rows.data ?? []) as SourceRow[];
  if (!source.length) return { batch: batch.data, candidates: [] as Candidate[], summary: { total: 0, confirmed: 0, pending: 0, totalSalesYen: 0 } };
  const ids = source.map(item => item.id);
  const containerIds = [...new Set(source.map(item => item.container_id).filter((v): v is string => !!v))];
  const [checks, reviews, containers] = await Promise.all([
    db.from("handheld_reconciliation_checks").select("import_row_id,decision").in("import_row_id",ids),
    db.from("sales_candidate_reviews").select("import_row_id,product_code,product_name,supplier_name,quantity,unit,sale_unit_price,purchase_unit_price,note,confirmed_at,quantity_source,quantity_reason,quantity_rule_id").in("import_row_id",ids),
    containerIds.length ? db.from("containers").select("id,serial_number,capacity_value,capacity_unit,gas_type_id,owner_id,gas_types(name)").in("id",containerIds) : Promise.resolve({ data: [], error: null })
  ]);
  const err = [checks,reviews,containers].find(item => item.error);
  if (err?.error) throw new Error(err.error.message);
  const matching = new Set((checks.data ?? []).filter(item => item.decision === "matched").map(item => item.import_row_id));
  const reviewMap = new Map((reviews.data ?? []).map(item => [item.import_row_id, item as Review]));
  const containerMap = new Map((containers.data ?? []).map(item => [item.id,item]));
  const [productsResult, pricesResult, customersResult, suppliersResult, quantityRulesResult] = await Promise.all([
    db.from("sales_product_mappings").select("id,gas_type_id,supplier_id,owner_id,product_code,product_name,unit"),
    db.from("sales_price_rules").select("id,product_mapping_id,price_kind,customer_id,supplier_id,owner_id,unit_price,effective_from,effective_until"),
    db.from("customers").select("id,name"),
    db.from("suppliers").select("id,name"),
    db.from("sales_customer_quantity_rules").select("id,customer_id,product_mapping_id,billing_unit,quantity_per_container,effective_from,effective_until")
  ]);
  const failed = [productsResult,pricesResult,customersResult,suppliersResult,quantityRulesResult].find(item=>item.error);
  if(failed?.error)throw new Error(failed.error.message);
  const products=productsResult.data??[], prices=pricesResult.data??[], quantityRules=quantityRulesResult.data??[];
  const customerIds=new Map((customersResult.data??[]).map(item=>[item.name,item.id]));
  const supplierNames=new Map((suppliersResult.data??[]).map(item=>[item.id,item.name]));
  const supplierIds=new Map((suppliersResult.data??[]).map(item=>[item.name,item.id]));
  function findPrice(productId: string, kind: "sale"|"purchase", targetId: string|null, ownerId: string|null, on: string) {
    if(!targetId||!on)return {price:null as number|null,warning:"単価の照合条件が不足しています。"};
    const options=prices.filter(price=>price.product_mapping_id===productId&&price.price_kind===kind&&
      (kind==="sale"?price.customer_id===targetId:price.supplier_id===targetId)&&
      (kind==="sale"||!price.owner_id||price.owner_id===ownerId)&&
      price.effective_from<=on&&(!price.effective_until||price.effective_until>=on));
    if(kind==="purchase"){
      const specific=options.filter(price=>price.owner_id===ownerId&&!!ownerId);
      if(specific.length)options.splice(0,options.length,...specific);
      else options.splice(0,options.length,...options.filter(price=>!price.owner_id));
    }
    options.sort((a,b)=>b.effective_from.localeCompare(a.effective_from));
    if(!options.length)return {price:null as number|null,warning:"該当日付に適用できる単価マスタがありません。"};
    if(options.length>1&&options[0].effective_from===options[1].effective_from)return {price:null as number|null,warning:"同一適用日の単価が複数登録されています。"};
    return {price:Number(options[0].unit_price),warning:""};
  }
  const eligible = source.filter(item => matching.has(item.id));
  const candidates: Candidate[] = eligible.map(item => {
    const raw = item.raw_row;
    const container = containerMap.get(item.container_id ?? "");
    const review = reviewMap.get(item.id);
    const gasJoin = container?.gas_types as { name?: string } | { name?: string }[] | null;
    const gasName = Array.isArray(gasJoin) ? gasJoin[0]?.name ?? "" : gasJoin?.name ?? "";
    const customer = rawText(raw,"customerName","顧客");
    const gasId=container?.gas_type_id ?? null;
    const ownerId=container?.owner_id ?? null;
    const inputSupplier=rawText(raw,"supplierName","仕入先");
    const supplierId=inputSupplier ? supplierIds.get(inputSupplier)??null:null;
    const productOptions=products.filter(p=>p.gas_type_id===gasId&&
      (!p.owner_id||p.owner_id===ownerId)&&(!p.supplier_id||!supplierId||p.supplier_id===supplierId));
    const specificOwner=productOptions.filter(p=>p.owner_id===ownerId&&!!ownerId);
    const ownerFiltered=specificOwner.length?specificOwner:productOptions.filter(p=>!p.owner_id);
    const supplierSpecific=ownerFiltered.filter(p=>p.supplier_id===supplierId&&!!supplierId);
    const candidates=supplierSpecific.length?supplierSpecific:ownerFiltered.filter(p=>!p.supplier_id||!supplierId);
    const match=candidates.length===1?candidates[0]:null;
    const warnings:string[]=[];
    if(!match)warnings.push(candidates.length>1?"商品候補が複数あります。商品コードを確認してください。":"対応する商品マスタがありません。");
    const inferredSupplier=match?.supplier_id ? supplierNames.get(match.supplier_id)??"" : inputSupplier;
    const salesPrice=match?findPrice(match.id,"sale",customerIds.get(customer)??null,ownerId,item.occurred_on??""):null;
    const purchasePrice=match?findPrice(match.id,"purchase",match.supplier_id??supplierId,ownerId,item.occurred_on??""):null;
    if(salesPrice?.warning)warnings.push("売上："+salesPrice.warning);
    if(purchasePrice?.warning)warnings.push("仕入："+purchasePrice.warning);
    if(match&&match.unit!=="本")warnings.push("請求単位が本数以外です。換算数量を手動確認してください。");
    const applicableRules = match && item.occurred_on ? quantityRules.filter(rule =>
      rule.customer_id === customerIds.get(customer) && rule.product_mapping_id === match.id &&
      rule.effective_from <= item.occurred_on! && (!rule.effective_until || rule.effective_until >= item.occurred_on!)
    ) : [];
    const quantityRule = applicableRules.length === 1 ? applicableRules[0] : null;
    const quantitySuggestion = quantityRule ? {
      ruleId: quantityRule.id, quantity: Number(quantityRule.quantity_per_container),
      unit: quantityRule.billing_unit, explanation: "得意先・商品別の1本あたり数量換算ルール"
    } : null;
    if (match && match.unit !== "本" && !quantityRule)
      warnings.push(applicableRules.length > 1 ? "換算ルールが複数あります。" : "得意先別の数量換算ルールがありません。");
    // Only explicit "actual fill" CSV fields are authoritative. The generic capacity
    // columns describe cylinder nominal capacity and must never be auto-billed.
    const fillText=rawText(raw,"actualFillValue","実充填量");
    const fillUnitRaw=rawText(raw,"actualFillUnit","実充填量単位");
    const fillUnit=fillUnitRaw==="㎥"?"m3":fillUnitRaw;
    const fillNumber=Number(fillText);
    const targetUnit=quantitySuggestion?.unit??match?.unit??null;
    const actualFillValid=!!fillText&&/^\d+(?:\.\d{1,3})?$/.test(fillText)&&
      Number.isFinite(fillNumber)&&fillNumber>0&&fillNumber<=9999999 &&
      !!fillUnit&&fillUnit===targetUnit;
    const actualFillSuggestion=actualFillValid?{
      quantity:fillNumber,unit:fillUnit,source:"ハンディCSVの実充填量",
      standardQuantity:quantitySuggestion?.quantity??null,
      differsFromStandard:!!quantitySuggestion&&Math.abs(fillNumber-quantitySuggestion.quantity)>0.000001
    }:null;
    const actualFillWarning=fillText||fillUnitRaw
      ? (actualFillValid?null:!fillText||!fillUnitRaw?"実充填量と単位の両方を入力してください。":!targetUnit?"商品・換算マスタが未設定のため実充填量を反映できません。":fillUnit!==targetUnit?"実充填量の単位が請求単位と一致しません。単位換算は自動実行しません。":"実充填量が不正です。")
      :null;
    if(actualFillWarning)warnings.push(actualFillWarning);
    const suggestion=match?{
      productCode:match.product_code,productName:match.product_name,supplier:inferredSupplier,
      unit:match.unit,saleUnitPrice:salesPrice?.price??null,purchaseUnitPrice:purchasePrice?.price??null,
      source:"有効期間内の登録済み商品・単価マスタ",warnings
    }:null;

    return {
      id: item.id, lineNumber: item.line_number, deliveredOn: item.occurred_on ?? "",
      referenceNumber: rawText(raw,"referenceNumber","伝票番号"), customer,
      branch: rawText(raw,"branchName","営業所"),
      serialNumber: container?.serial_number ?? item.barcode ?? "",
      gasName: rawText(raw,"gasName","ガス種") || gasName,
      quantity: review ? Number(review.quantity) : (actualFillSuggestion?.quantity??quantitySuggestion?.quantity??1),
      unit: review?.unit ?? (actualFillSuggestion?.unit??quantitySuggestion?.unit??"本"),
      productCode: review?.product_code ?? "", productName: review?.product_name ?? "",
      supplier: review?.supplier_name ?? rawText(raw,"supplierName","仕入先"),
      saleUnitPrice: review ? Number(review.sale_unit_price) : null,
      purchaseUnitPrice: review ? Number(review.purchase_unit_price) : null,
      note: review?.note ?? "", confirmed: !!review,
      confirmedAt: review?.confirmed_at ?? null, suggestion, quantitySuggestion, actualFillSuggestion, actualFillWarning,
      quantitySource: review?.quantity_source ?? (actualFillSuggestion?"actual_fill":quantitySuggestion?"rule":"manual"),
      quantityReason: review?.quantity_reason ?? (actualFillSuggestion?"ハンディCSVの実充填量を採用（要確認）":""),
      quantityRuleId: review?.quantity_rule_id ?? (actualFillSuggestion?null:quantitySuggestion?.ruleId??null)
    };
  });
  return {
    batch: batch.data, candidates,
    summary: {
      total: candidates.length, confirmed: candidates.filter(item => item.confirmed).length,
      pending: candidates.filter(item => !item.confirmed).length,
      totalSalesYen: candidates.reduce((sum,item) => sum + (item.saleUnitPrice === null ? 0 : Math.round(item.quantity * item.saleUnitPrice * 100) / 100),0)
    }
  };
}
function csvSafe(input: string | number) {
  const value = String(input);
  const safe = /^[\s]*[=+@\-\t\r]/.test(value) ? "'" + value : value;
  return '"' + safe.replaceAll('"','""') + '"';
}
export async function GET(request: NextRequest) {
  try {
    const auth = await authorized();
    if (auth.error) return auth.error;
    const db = adminClient();
    const importId = request.nextUrl.searchParams.get("importId");
    if (!importId) {
      const [finalizations, imports] = await Promise.all([
        db.from("handheld_reconciliation_finalizations").select("import_id,finalized_at").order("finalized_at",{ascending:false}).limit(100),
        db.from("handheld_imports").select("id,source_filename,created_at,total_rows,applied_rows,error_rows").order("created_at",{ascending:false}).limit(200)
      ]);
      if (finalizations.error || imports.error) throw new Error(finalizations.error?.message ?? imports.error?.message);
      const batchMap = new Map((imports.data ?? []).map(item => [item.id,item]));
      return NextResponse.json({ batches: (finalizations.data ?? []).map(item => ({ ...batchMap.get(item.import_id), id: item.import_id, finalizedAt: item.finalized_at })) });
    }
    if (!validUuid(importId)) throw new Error("取込IDが不正です。");
    const result = await loadCandidates(importId);
    if (request.nextUrl.searchParams.get("format") !== "csv") return NextResponse.json(result);
    if (!result.summary.total) throw new Error("売上候補がありません。");
    if (result.summary.pending) throw new Error("未確認の売上候補があります。すべての明細を確認してください。");
    if (result.candidates.some(item => !item.customer || !item.productCode || !item.supplier || item.saleUnitPrice === null || item.purchaseUnitPrice === null)) {
      throw new Error("未設定項目があります。出力前に明細を確認してください。");
    }
    const header = ["取込ID","行ID","出荷日","伝票番号","得意先","瓶号","ガス種","商品コード","商品名","仕入先","数量","単位","売上単価","仕入単価","売上金額","数量決定方法","数量根拠・補正理由","確認状態","連携状態"];
    const lines: (string | number)[][] = [header,...result.candidates.map(item => [
      importId,item.id,item.deliveredOn,item.referenceNumber,item.customer,item.serialNumber,item.gasName,
      item.productCode,item.productName,item.supplier,item.quantity,item.unit,item.saleUnitPrice!,
      item.purchaseUnitPrice!,Math.round(item.quantity * item.saleUnitPrice! * 100) / 100,
      item.quantitySource==="rule"?"換算マスタ":item.quantitySource==="actual_fill"?"実充填量":"手動補正",item.quantityReason,
      "確認済み","未連携・売上未計上"
    ])];
    const csv = "\uFEFF" + lines.map(row => row.map(csvSafe).join(",")).join("\r\n");
    const audit = await db.from("sales_candidate_review_events").insert(result.candidates.map(item => ({
      import_row_id:item.id,event_type:"csv_exported",performed_by:auth.user!.id,
      details: { importId, target:"sales_candidate_csv", posted:false }
    })));
    if (audit.error) throw new Error("出力監査記録の保存に失敗しました：" + audit.error.message);
    return new NextResponse(csv,{ headers: {
      "content-type":"text/csv; charset=utf-8",
      "content-disposition":`attachment; filename="sales_candidates_${importId.slice(0,8)}.csv"`,
      "cache-control":"no-store"
    }});
  } catch (error) {
    return NextResponse.json({error:error instanceof Error?error.message:"売上候補を取得できませんでした。"},{status:400});
  }
}
export async function POST(request: NextRequest) {
  try {
    const auth = await authorized();
    if (auth.error || !auth.user) return auth.error;
    const body = await request.json() as {
      importId?:string; rowId?:number; productCode?:string; productName?:string; supplier?:string;
      quantity?:number; unit?:string; saleUnitPrice?:number; purchaseUnitPrice?:number; note?:string;
      quantitySource?: "rule" | "actual_fill" | "manual"; quantityReason?: string; quantityRuleId?: string | null;
    };
    if (!body.importId || !validUuid(body.importId) || !Number.isSafeInteger(body.rowId)) throw new Error("取込・明細IDを確認してください。");
    const dataset = await loadCandidates(body.importId);
    const row = dataset.candidates.find(item => item.id === body.rowId);
    if (!row) throw new Error("売上候補の対象外です。伝票照合済み出荷のみ確認できます。");
    if (!row.customer.trim() || !row.deliveredOn) throw new Error("得意先または出荷日が未設定です。元の出荷実績を確認してください。");
    const productCode = String(body.productCode ?? "").trim();
    const productName = String(body.productName ?? "").trim();
    const supplier = String(body.supplier ?? "").trim();
    const unit = String(body.unit ?? "").trim();
    const note = String(body.note ?? "").trim();
    if (!productCode || productCode.length>80 || !productName || productName.length>200 || !supplier || supplier.length>200 || !unit || unit.length>30 || note.length>1000) {
      throw new Error("商品コード・商品名・仕入先・単位を入力してください。文字数上限も確認してください。");
    }
    if (![body.quantity,body.saleUnitPrice,body.purchaseUnitPrice].every(v => typeof v === "number" && Number.isFinite(v))) throw new Error("数量・売上単価・仕入単価は数値で指定してください。");
    const quantity=body.quantity!, sale=body.saleUnitPrice!, purchase=body.purchaseUnitPrice!;
    if (quantity<=0 || quantity>9999999 || sale<0 || sale>9999999999 || purchase<0 || purchase>9999999999) throw new Error("数量または単価が範囲外です。");
    if (Math.round(quantity*1000)!==quantity*1000 || Math.round(sale*100)!==sale*100 || Math.round(purchase*100)!==purchase*100) throw new Error("数量は小数3桁、単価は小数2桁までにしてください。");
    const quantitySource=body.quantitySource??"manual";
    if (!["rule","actual_fill","manual"].includes(quantitySource)) throw new Error("数量の入力区分が不正です。");
    let quantityRuleId: string | null = null;
    let quantityReason=String(body.quantityReason??"").trim();
    if (quantityReason.length>1000) throw new Error("数量補正理由は1000文字以内で入力してください。");
    if (quantitySource==="rule") {
      const expected=row.quantitySuggestion;
      if (!expected || expected.ruleId!==body.quantityRuleId || Math.abs(expected.quantity-quantity)>0.000001 || expected.unit!==unit)
        throw new Error("換算ルールの数量と一致しません。ルールを再適用するか、手動補正の理由を入力してください。");
      quantityRuleId=expected.ruleId;
      quantityReason="";
    } else if (quantitySource==="actual_fill" && (
      row.actualFillSuggestion && (
        Math.abs(row.actualFillSuggestion.quantity-quantity)>0.000001 ||
        row.actualFillSuggestion.unit!==unit
      )
    )) {
      throw new Error("ハンディ実充填量の候補と一致しません。実充填量を再適用するか、手動補正を選択してください。");
    } else if (quantityReason.length<3) {
      throw new Error("実充填量・手動補正の数量根拠を3文字以上入力してください。");
    }
    const db=adminClient();
    const saved=await db.from("sales_candidate_reviews").upsert({
      import_row_id:row.id,product_code:productCode,product_name:productName,supplier_name:supplier,
      quantity,unit,sale_unit_price:sale,purchase_unit_price:purchase,note,
      quantity_source:quantitySource,quantity_reason:quantityReason,quantity_rule_id:quantityRuleId,
      confirmed_by:auth.user.id,confirmed_at:new Date().toISOString()
    },{onConflict:"import_row_id"});
    if(saved.error)throw new Error(saved.error.message);
    const audit=await db.from("sales_candidate_review_events").insert({
      import_row_id:row.id,event_type:row.confirmed?"reconfirmed":"confirmed",performed_by:auth.user.id,
      details:{productCode,productName,supplier,quantity,unit,sale,purchase,note,quantitySource,quantityReason,quantityRuleId,posted:false}
    });
    if(audit.error)throw new Error(audit.error.message);
    return NextResponse.json({ok:true,result:await loadCandidates(body.importId)});
  } catch(error) {
    return NextResponse.json({error:error instanceof Error?error.message:"売上候補の保存に失敗しました。"},{status:400});
  }
}
