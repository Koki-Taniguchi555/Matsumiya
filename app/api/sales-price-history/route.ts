import { NextRequest, NextResponse } from "next/server";
import { requireAuthorizedUser, canManageMasters } from "@/lib/auth";
import { adminClient } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  try {
    const user=await requireAuthorizedUser();
    if(!user)return NextResponse.json({error:"ログインが必要です。"},{status:401});
    if(!canManageMasters(user))return NextResponse.json({error:"管理者のみ参照できます。"},{status:403});
    const customer=request.nextUrl.searchParams.get("customer")?.trim()??"";
    const product=request.nextUrl.searchParams.get("productCode")?.trim()??"";
    if(!customer||!product||customer.length>200||product.length>80)throw new Error("得意先と商品コードが必要です。");
    const db=adminClient();
    const reviews=await db.from("sales_candidate_reviews")
      .select("import_row_id,sale_unit_price,purchase_unit_price,quantity,unit,confirmed_at")
      .eq("product_code",product).order("confirmed_at",{ascending:false}).limit(200);
    if(reviews.error)throw new Error(reviews.error.message);
    const ids=(reviews.data??[]).map(item=>item.import_row_id);
    if(!ids.length)return NextResponse.json({history:[]},{headers:{"cache-control":"no-store"}});
    const rows=await db.from("handheld_import_rows")
      .select("id,occurred_on,raw_row,action,status").in("id",ids);
    if(rows.error)throw new Error(rows.error.message);
    const map=new Map((rows.data??[]).map(row=>[row.id,row]));
    const history=(reviews.data??[]).flatMap(review=>{
      const row=map.get(review.import_row_id);
      const raw=row?.raw_row as Record<string,string>|null;
      const rowCustomer=String(raw?.customerName??raw?.["顧客"]??"").trim();
      if(!row||row.status!=="applied"||row.action!=="delivered"||rowCustomer!==customer)return [];
      return [{
        date:row.occurred_on,quantity:Number(review.quantity),unit:review.unit,
        salePrice:Number(review.sale_unit_price),purchasePrice:Number(review.purchase_unit_price),
        reviewedAt:review.confirmed_at
      }];
    }).sort((a,b)=>(b.date??"").localeCompare(a.date??"")||b.reviewedAt.localeCompare(a.reviewedAt)).slice(0,5);
    return NextResponse.json({history,note:"過去に確認した売上候補の記録であり、販売管理システムで確定した売上実績ではありません。"},{headers:{"cache-control":"no-store"}});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:"過去の単価記録を取得できませんでした。"},{status:400});
  }
}
