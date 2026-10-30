create type public.inspection_log_action as enum ('sent', 'completed');

create table public.container_inspection_logs (
  id uuid primary key default gen_random_uuid(),
  container_id uuid not null references public.containers,
  action public.inspection_log_action not null,
  occurred_on date not null,
  inspection_provider_id uuid references public.inspection_providers,
  passed boolean,
  next_due_month date,
  note text,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create index container_inspection_logs_container_idx on public.container_inspection_logs(container_id, occurred_on desc);

create table public.inventory_sessions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches,
  counted_on date not null,
  status text not null default 'open' check (status in ('open', 'closed')),
  started_by uuid,
  closed_by uuid,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(branch_id, counted_on)
);
create table public.inventory_scan_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.inventory_sessions on delete cascade,
  container_id uuid not null references public.containers,
  scanned_at timestamptz not null default now(),
  scanned_by uuid,
  unique(session_id, container_id)
);
create index inventory_scan_items_session_idx on public.inventory_scan_items(session_id);

alter table public.container_inspection_logs enable row level security;
alter table public.inventory_sessions enable row level security;
alter table public.inventory_scan_items enable row level security;
revoke all on public.container_inspection_logs, public.inventory_sessions, public.inventory_scan_items from anon, authenticated;
grant all on public.container_inspection_logs, public.inventory_sessions, public.inventory_scan_items to service_role;

create or replace function public.prevent_inspection_log_change() returns trigger language plpgsql set search_path = public as $$ begin raise exception '検査履歴は変更・削除できません'; end $$;
create trigger inspection_log_immutable before update or delete on public.container_inspection_logs for each row execute function public.prevent_inspection_log_change();
