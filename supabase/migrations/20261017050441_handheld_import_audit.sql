-- Import audit trail for generic handheld/CSV data. Browser roles remain blocked;
-- only the server-side service role can read or write these operational records.
create table public.handheld_imports (
  id uuid primary key default gen_random_uuid(),
  source_filename text not null,
  format_version text not null default 'matsumiya-handheld-v1',
  status text not null default 'validated' check (status in ('validated', 'applied', 'partially_applied', 'rejected')),
  total_rows integer not null default 0 check (total_rows >= 0),
  applied_rows integer not null default 0 check (applied_rows >= 0),
  error_rows integer not null default 0 check (error_rows >= 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.handheld_import_rows (
  id bigint generated always as identity primary key,
  import_id uuid not null references public.handheld_imports on delete restrict,
  line_number integer not null check (line_number > 0),
  raw_row jsonb not null,
  action public.lifecycle_action,
  barcode text,
  container_id uuid references public.containers,
  occurred_on date,
  status text not null default 'validated' check (status in ('validated', 'applied', 'error')),
  error_message text,
  created_at timestamptz not null default now(),
  unique (import_id, line_number)
);

create index handheld_import_rows_import_idx on public.handheld_import_rows (import_id, line_number);
create index handheld_import_rows_container_idx on public.handheld_import_rows (container_id, occurred_on desc);

alter table public.handheld_imports enable row level security;
alter table public.handheld_import_rows enable row level security;
revoke all on public.handheld_imports, public.handheld_import_rows from anon, authenticated;
grant all on public.handheld_imports, public.handheld_import_rows to service_role;
