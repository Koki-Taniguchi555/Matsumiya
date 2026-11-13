import { NextRequest, NextResponse } from "next/server";
import { requireAuthorizedUser, canManageMasters } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";

const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
const trim = (value: unknown) => typeof value === "string" ? value.trim() : "";
async function gate() {
  const user = await requireAuthorizedUser();
  if (!user) return { user: null, error: NextResponse.json({ error: "ログインが必要です。" }, { status: 401 }) };
  if (!canManageMasters(user)) return { user: null, error: NextResponse.json({ error: "商品・単価マスタの操作は管理者のみ可能です。" }, { status: 403 }) };
  return { user, error: null };
}
export async function GET() {
  try {
    const auth = await gate();
    if (auth.error) return auth.error;
    const db = adminClient();
    const [gases, customers, suppliers, owners, products, prices, quantities] = await Promise.all([
      db.from("gas_types").select("id,code,name").order("name"),
      db.from("customers").select("id,name").order("name"),
      db.from("suppliers").select("id,code,name").order("name"),
      db.from("container_owners").select("id,code,name").order("name"),
      db.from("sales_product_mappings").select("id,gas_type_id,supplier_id,owner_id,product_code,product_name,unit").order("product_code"),
      db.from("sales_price_rules").select("id,product_mapping_id,price_kind,customer_id,supplier_id,owner_id,unit_price,effective_from,effective_until").order("effective_from",{ascending:false}),
      db.from("sales_customer_quantity_rules").select("id,customer_id,product_mapping_id,billing_unit,quantity_per_container,effective_from,effective_until").order("effective_from",{ascending:false})
    ]);
    const bad=[gases,customers,suppliers,owners,products,prices,quantities].find(v=>v.error);
    if(bad?.error)throw new Error(bad.error.message);
    return NextResponse.json({
      gases:gases.data??[],customers:customers.data??[],suppliers:suppliers.data??[],
      owners:owners.data??[],products:products.data??[],prices:prices.data??[],quantities:quantities.data??[]
    },{headers:{"cache-control":"no-store"}});
  } catch(error) {
    return NextResponse.json({error:error instanceof Error?error.message:"マスタ取得に失敗しました。"},{status:400});
  }
}
export async function POST(request: NextRequest) {
  try {
    const auth=await gate();
    if(auth.error||!auth.user)return auth.error;
    const body=await request.json() as Record<string,unknown>;
    const db=adminClient();
    if(body.kind==="product") {
      if(!uuid(body.gasTypeId))throw new Error("ガス種を指定してください。");
      if(body.supplierId && !uuid(body.supplierId))throw new Error("仕入先IDが不正です。");
      if(body.ownerId && !uuid(body.ownerId))throw new Error("保有者IDが不正です。");
      const code=trim(body.productCode), name=trim(body.productName),unit=trim(body.unit)||"本";
      if(!code||code.length>80||!name||name.length>200||unit.length>30)throw new Error("商品コード・商品名・単位を確認してください。");
      const gas=await db.from("gas_types").select("id").eq("id",body.gasTypeId).maybeSingle();
      if(gas.error||!gas.data)throw new Error("指定されたガス種が存在しません。");
      const existing=await db.from("sales_product_mappings").select("id,supplier_id,owner_id").eq("gas_type_id",body.gasTypeId)
        .eq("product_code",code);
      if(existing.error)throw new Error(existing.error.message);
      const duplicate=(existing.data??[]).some(row=>row.supplier_id===(body.supplierId||null)&&row.owner_id===(body.ownerId||null));
      if(duplicate)throw new Error("同じガス種・仕入先・保有者の商品コードは登録済みです。");
      const result=await db.from("sales_product_mappings").insert({
        gas_type_id:body.gasTypeId,supplier_id:body.supplierId||null,owner_id:body.ownerId||null,
        product_code:code,product_name:name,unit,created_by:auth.user.id
      }).select("id").single();
      if(result.error)throw new Error(result.error.message);
      return NextResponse.json({ok:true,id:result.data.id},{status:201});
    }
    if(body.kind==="price") {
      if(!uuid(body.productMappingId))throw new Error("商品を指定してください。");
      const priceKind=body.priceKind;
      if(priceKind!=="sale"&&priceKind!=="purchase")throw new Error("単価の区分が不正です。");
      if(!date(body.effectiveFrom)|| (body.effectiveUntil&&!date(body.effectiveUntil)))throw new Error("適用期間が不正です。");
      if(body.effectiveUntil&&String(body.effectiveUntil)<String(body.effectiveFrom))throw new Error("終了日は開始日以降にしてください。");
      if(typeof body.unitPrice!=="number"||!Number.isFinite(body.unitPrice)||body.unitPrice<0||body.unitPrice>9999999999||Math.abs(Math.round(body.unitPrice*100)-body.unitPrice*100)>0.00001)throw new Error("単価は0以上、小数2桁以内で指定してください。");
      if(priceKind==="sale"&&!uuid(body.customerId))throw new Error("販売単価には得意先が必要です。");
      if(priceKind==="purchase"&&!uuid(body.supplierId))throw new Error("仕入単価には仕入先が必要です。");
      if(body.ownerId&&!uuid(body.ownerId))throw new Error("保有者IDが不正です。");
      const product=await db.from("sales_product_mappings").select("id").eq("id",body.productMappingId).maybeSingle();
      if(product.error||!product.data)throw new Error("指定された商品がありません。");
      const rule={
        product_mapping_id:body.productMappingId,price_kind:priceKind,unit_price:body.unitPrice,
        customer_id:priceKind==="sale"?body.customerId:null,
        supplier_id:priceKind==="purchase"?body.supplierId:null,
        owner_id:priceKind==="purchase"?(body.ownerId||null):null,
        effective_from:body.effectiveFrom,effective_until:body.effectiveUntil||null,created_by:auth.user.id
      };
      const result=await db.from("sales_price_rules").insert(rule).select("id").single();
      if(result.error)throw new Error(result.error.message);
      return NextResponse.json({ok:true,id:result.data.id},{status:201});
    }
    if(body.kind==="quantity"){
      if(!uuid(body.customerId)||!uuid(body.productMappingId))throw new Error("得意先・商品を選択してください。");
      const unit=trim(body.billingUnit);
      if(!unit||unit.length>30)throw new Error("請求単位は30文字以内で入力してください。");
      if(typeof body.quantityPerContainer!=="number"||!Number.isFinite(body.quantityPerContainer)||
         body.quantityPerContainer<=0||body.quantityPerContainer>999999999||
         Math.abs(Math.round(body.quantityPerContainer*1000)-body.quantityPerContainer*1000)>0.0001)throw new Error("1本あたり数量は0より大きい数値、小数3桁以内で指定してください。");
      if(!date(body.effectiveFrom)||(body.effectiveUntil&&!date(body.effectiveUntil))||
         (body.effectiveUntil&&String(body.effectiveUntil)<String(body.effectiveFrom)))throw new Error("適用開始日・終了日を確認してください。");
      const [customer, product]=await Promise.all([
        db.from("customers").select("id").eq("id",body.customerId).maybeSingle(),
        db.from("sales_product_mappings").select("id,unit").eq("id",body.productMappingId).maybeSingle()
      ]);
      if(customer.error||product.error||!customer.data||!product.data)throw new Error("得意先または商品が存在しません。");
      const existing=await db.from("sales_customer_quantity_rules").select("id,effective_from,effective_until")
        .eq("customer_id",body.customerId).eq("product_mapping_id",body.productMappingId);
      if(existing.error)throw new Error(existing.error.message);
      const begin=String(body.effectiveFrom), end=String(body.effectiveUntil||"9999-12-31");
      if((existing.data??[]).some(r=>r.effective_from<=end&&(r.effective_until??"9999-12-31")>=begin)){
        throw new Error("同じ得意先・商品の換算ルールに適用期間の重複があります。既存ルールの期間を確認してください。");
      }
      const added=await db.from("sales_customer_quantity_rules").insert({
        customer_id:body.customerId,product_mapping_id:body.productMappingId,
        billing_unit:unit,quantity_per_container:body.quantityPerContainer,
        effective_from:body.effectiveFrom,effective_until:body.effectiveUntil||null,
        created_by:auth.user.id
      }).select("id").single();
      if(added.error)throw new Error(added.error.message);
      return NextResponse.json({ok:true,id:added.data.id},{status:201});
    }
    throw new Error("登録区分が不正です。");
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"マスタ登録に失敗しました。"},{status:400});
  }
}
