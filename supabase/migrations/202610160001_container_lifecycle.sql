create type public.container_status as enum ('in_stock', 'on_loan', 'recovered');
create type public.lifecycle_action as enum ('received', 'delivered', 'recovered');

create table public.branches (id uuid primary key default gen_random_uuid(), name text not null unique, created_at timestamptz not null default now());
create table public.customers (id uuid primary key default gen_random_uuid(), name text not null, created_at timestamptz not null default now());
create table public.containers (id uuid primary key default gen_random_uuid(), serial_number text not null unique, container_type text not null, status public.container_status not null default 'in_stock', current_branch_id uuid references public.branches, current_customer_id uuid references public.customers, created_at timestamptz not null default now());
create table public.container_loans (id uuid primary key default gen_random_uuid(), container_id uuid not null references public.containers, customer_id uuid not null references public.customers, delivered_on date not null, recovered_on date, created_at timestamptz not null default now(), check (recovered_on is null or recovered_on >= delivered_on));
create unique index one_open_loan_per_container on public.container_loans(container_id) where recovered_on is null;
create table public.container_audit_logs (id bigint generated always as identity primary key, container_id uuid not null references public.containers, action public.lifecycle_action not null, occurred_on date not null, actor_id uuid, before_state jsonb not null, after_state jsonb not null, created_at timestamptz not null default now());
create table public.usage_charges (id uuid primary key default gen_random_uuid(), loan_id uuid not null references public.container_loans, billing_month date not null, billable_days integer not null check (billable_days >= 0), amount_yen integer not null check (amount_yen >= 0), calculated_at timestamptz not null default now(), unique (loan_id, billing_month));

create or replace function public.record_container_lifecycle(p_container_id uuid, p_action public.lifecycle_action, p_occurred_on date, p_customer_id uuid default null, p_branch_id uuid default null, p_actor_id uuid default null) returns void language plpgsql security definer as $$
declare v_container public.containers%rowtype; v_loan_id uuid; v_before jsonb;
begin
  select * into v_container from public.containers where id = p_container_id for update;
  if not found then raise exception '容器が見つかりません'; end if;
  v_before := to_jsonb(v_container);
  if p_action = 'received' then
    if v_container.status = 'on_loan' then raise exception '貸出中の容器は入荷登録できません'; end if;
    update public.containers set status='in_stock', current_branch_id=p_branch_id, current_customer_id=null where id=p_container_id;
  elsif p_action = 'delivered' then
    if v_container.status <> 'in_stock' then raise exception '在庫中の容器のみ納品できます'; end if;
    if p_customer_id is null then raise exception '納品には顧客が必要です'; end if;
    insert into public.container_loans(container_id, customer_id, delivered_on) values (p_container_id, p_customer_id, p_occurred_on);
    update public.containers set status='on_loan', current_customer_id=p_customer_id, current_branch_id=null where id=p_container_id;
  else
    if v_container.status <> 'on_loan' then raise exception '貸出中の容器のみ回収できます'; end if;
    select id into v_loan_id from public.container_loans where container_id=p_container_id and recovered_on is null for update;
    update public.container_loans set recovered_on=p_occurred_on where id=v_loan_id;
    update public.containers set status='recovered', current_customer_id=null where id=p_container_id;
  end if;
  insert into public.container_audit_logs(container_id, action, occurred_on, actor_id, before_state, after_state) select p_container_id, p_action, p_occurred_on, p_actor_id, v_before, to_jsonb(c) from public.containers c where id=p_container_id;
end $$;

create or replace function public.calculate_monthly_usage_charge(p_loan_id uuid, p_billing_month date) returns public.usage_charges language plpgsql security definer as $$
declare v_loan public.container_loans%rowtype; v_start date; v_end date; v_held integer; v_billable integer; v_charge public.usage_charges;
begin
  select * into v_loan from public.container_loans where id=p_loan_id; if not found then raise exception '貸出が見つかりません'; end if;
  if exists(select 1 from public.usage_charges where loan_id=p_loan_id and billing_month=p_billing_month) then raise exception 'この対象月はすでに計算済みです'; end if;
  v_start := greatest(v_loan.delivered_on + 93, date_trunc('month', p_billing_month)::date);
  v_end := least(coalesce(v_loan.recovered_on, (date_trunc('month', p_billing_month) + interval '1 month - 1 day')::date), (date_trunc('month', p_billing_month) + interval '1 month - 1 day')::date);
  v_billable := greatest(0, v_end - v_start + 1);
  insert into public.usage_charges(loan_id, billing_month, billable_days, amount_yen) values (p_loan_id, date_trunc('month', p_billing_month)::date, v_billable, floor(v_billable * 600.0 / 31)::integer) returning * into v_charge;
  return v_charge;
end $$;

create or replace function public.prevent_audit_change() returns trigger language plpgsql as $$ begin raise exception '監査履歴は変更・削除できません'; end $$;
create trigger audit_log_immutable before update or delete on public.container_audit_logs for each row execute function public.prevent_audit_change();
alter table public.containers enable row level security; alter table public.container_loans enable row level security; alter table public.usage_charges enable row level security; alter table public.container_audit_logs enable row level security;
