-- Suppliers are maintained separately from customers so that inbound and
-- return-to-supplier history can be searched without overloading a customer.
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

alter table public.container_audit_logs
  add column if not exists handled_branch_id uuid references public.branches,
  add column if not exists customer_id uuid references public.customers,
  add column if not exists supplier_id uuid references public.suppliers;

create index if not exists container_audit_logs_customer_occurred_idx
  on public.container_audit_logs (customer_id, occurred_on desc, id desc)
  where customer_id is not null;
create index if not exists container_audit_logs_supplier_occurred_idx
  on public.container_audit_logs (supplier_id, occurred_on desc, id desc)
  where supplier_id is not null;
create index if not exists container_audit_logs_handled_branch_occurred_idx
  on public.container_audit_logs (handled_branch_id, occurred_on desc, id desc)
  where handled_branch_id is not null;

alter table public.suppliers enable row level security;
revoke all on public.suppliers from anon, authenticated;
grant all on public.suppliers to service_role;

-- The lifecycle function is the authoritative state machine.  Its state
-- transitions are: returned_to_supplier -> received -> in_stock -> delivered
-- -> on_loan -> recovered -> in_stock -> supplier_return -> returned_to_supplier.
create or replace function public.record_container_lifecycle(
  p_container_id uuid,
  p_action public.lifecycle_action,
  p_occurred_on date,
  p_customer_id uuid default null,
  p_handled_branch_id uuid default null,
  p_actor_id uuid default null,
  p_supplier_id uuid default null
) returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_container public.containers%rowtype;
  v_loan public.container_loans%rowtype;
  v_before jsonb;
  v_customer_id uuid;
begin
  select * into v_container from public.containers where id = p_container_id for update;
  if not found then raise exception '容器が見つかりません'; end if;
  if p_handled_branch_id is null then raise exception '処理営業所が必要です'; end if;
  if p_occurred_on is null then raise exception '処理日が必要です'; end if;
  v_before := to_jsonb(v_container);

  if p_action = 'received' then
    if v_container.status not in ('returned_to_supplier', 'recovered') then
      raise exception '入荷は仕入れ先返却済みの容器のみ登録できます（現在：%）', v_container.status;
    end if;
    if p_supplier_id is null then raise exception '入荷には仕入れ先が必要です'; end if;
    update public.containers
      set status = 'in_stock', current_branch_id = p_handled_branch_id, current_customer_id = null
      where id = p_container_id;

  elsif p_action = 'delivered' then
    if v_container.status <> 'in_stock' then
      raise exception '出荷は在庫中の容器のみ登録できます（現在：%）', v_container.status;
    end if;
    if v_container.current_branch_id is distinct from p_handled_branch_id then
      raise exception '出荷営業所は容器の現在営業所と一致させてください';
    end if;
    if p_customer_id is null then raise exception '出荷には得意先が必要です'; end if;
    insert into public.container_loans(container_id, customer_id, delivered_on)
      values (p_container_id, p_customer_id, p_occurred_on);
    update public.containers
      set status = 'on_loan', current_customer_id = p_customer_id, current_branch_id = null
      where id = p_container_id;

  elsif p_action = 'recovered' then
    if v_container.status <> 'on_loan' then
      raise exception '回収は出荷中の容器のみ登録できます（現在：%）', v_container.status;
    end if;
    select * into v_loan from public.container_loans
      where container_id = p_container_id and recovered_on is null for update;
    if not found then raise exception '回収対象の未完了出荷が見つかりません'; end if;
    if p_occurred_on < v_loan.delivered_on then raise exception '回収日は出荷日より前にできません'; end if;
    v_customer_id := v_loan.customer_id;
    update public.container_loans set recovered_on = p_occurred_on where id = v_loan.id;
    update public.containers
      set status = 'in_stock', current_branch_id = p_handled_branch_id, current_customer_id = null
      where id = p_container_id;

  elsif p_action = 'supplier_return' then
    if v_container.status <> 'in_stock' then
      raise exception '仕入れ返却は在庫中の容器のみ登録できます（現在：%）', v_container.status;
    end if;
    if v_container.current_branch_id is distinct from p_handled_branch_id then
      raise exception '返却営業所は容器の現在営業所と一致させてください';
    end if;
    if p_supplier_id is null then raise exception '仕入れ返却には仕入れ先が必要です'; end if;
    update public.containers
      set status = 'returned_to_supplier', current_branch_id = null, current_customer_id = null
      where id = p_container_id;

  else
    raise exception '処理区分が不正です';
  end if;

  insert into public.container_audit_logs(
    container_id, action, occurred_on, actor_id, before_state, after_state,
    handled_branch_id, customer_id, supplier_id
  )
  select p_container_id, p_action, p_occurred_on, p_actor_id, v_before, to_jsonb(c),
    p_handled_branch_id,
    case when p_action = 'recovered' then v_customer_id else p_customer_id end,
    p_supplier_id
  from public.containers c where c.id = p_container_id;
end;
$$;

revoke all on function public.record_container_lifecycle(uuid, public.lifecycle_action, date, uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_container_lifecycle(uuid, public.lifecycle_action, date, uuid, uuid, uuid, uuid) to service_role;

-- Demo data: 100 containers have correct, chronologically ordered histories.
-- A mix of open and completed cycles makes every search pattern demonstrable.
insert into public.suppliers(code, name)
select 'SUP-' || lpad(n::text, 3, '0'), 'サンプル 仕入先' || lpad(n::text, 3, '0')
from generate_series(1, 20) n
on conflict (code) do nothing;

insert into public.containers(serial_number, container_type, management_number, barcode, status)
select 'HIST-DEMO-' || lpad(n::text, 3, '0'), 'サンプル高圧ガス容器', 'HIST-M-' || lpad(n::text, 3, '0'), 'HIST-BC-' || lpad(n::text, 3, '0'), 'returned_to_supplier'
from generate_series(1, 100) n
on conflict (serial_number) do nothing;

do $$
declare
  v_container uuid;
  v_branch uuid;
  v_customer uuid;
  v_supplier uuid;
  n integer;
begin
  for n in 1..100 loop
    select id into v_container from public.containers where serial_number = 'HIST-DEMO-' || lpad(n::text, 3, '0');
    select id into v_branch from public.branches order by name offset ((n - 1) % 5) limit 1;
    select id into v_customer from public.customers order by name offset ((n - 1) % 200) limit 1;
    select id into v_supplier from public.suppliers order by code offset ((n - 1) % 20) limit 1;

    if not exists (select 1 from public.container_audit_logs where container_id = v_container) then
      perform public.record_container_lifecycle(v_container, 'received', date '2026-01-01' + n, null, v_branch, null, v_supplier);
      if n % 4 <> 0 then
        perform public.record_container_lifecycle(v_container, 'delivered', date '2026-02-01' + n, v_customer, v_branch, null, null);
      end if;
      if n % 4 in (2, 3) then
        perform public.record_container_lifecycle(v_container, 'recovered', date '2026-03-01' + n, null, v_branch, null, null);
      end if;
      if n % 4 = 3 then
        perform public.record_container_lifecycle(v_container, 'supplier_return', date '2026-04-01' + n, null, v_branch, null, v_supplier);
      end if;
    end if;
  end loop;
end;
$$;
