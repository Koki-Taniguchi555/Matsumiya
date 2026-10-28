-- Application users are managed by Supabase Auth.  This table deliberately
-- contains only authorization metadata; credentials remain in auth.users.
create type public.app_role as enum ('admin', 'branch_operator', 'viewer');

create table public.app_user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role public.app_role not null default 'viewer',
  branch_id uuid references public.branches,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((role <> 'branch_operator') or branch_id is not null)
);

create table public.app_access_audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in ('login', 'login_rejected', 'role_assigned')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index app_user_profiles_branch_id_idx on public.app_user_profiles(branch_id);
create index app_access_audit_logs_user_created_at_idx on public.app_access_audit_logs(user_id, created_at desc);

alter table public.app_user_profiles enable row level security;
alter table public.app_access_audit_logs enable row level security;

-- Browser clients never access authorization records directly.  All checks
-- occur in the server-side application with the service-role client.
revoke all on table public.app_user_profiles, public.app_access_audit_logs from anon, authenticated;
grant all on table public.app_user_profiles, public.app_access_audit_logs to service_role;

create or replace function public.prevent_access_audit_change() returns trigger language plpgsql as $$
begin
  raise exception 'アクセス監査履歴は変更・削除できません';
end;
$$;

create trigger access_audit_log_immutable
before update or delete on public.app_access_audit_logs
for each row execute function public.prevent_access_audit_change();

revoke all on function public.prevent_access_audit_change() from public;
