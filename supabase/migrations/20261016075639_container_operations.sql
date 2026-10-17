-- Reference data and attributes required to operate a cylinder ledger.
create type public.container_owner_kind as enum ('self', 'manufacturer', 'user', 'other');
create type public.container_form as enum ('single', 'valve_equipped', 'lgc', 'cardle', 'cardle_assembly', 'cardle_product', 'cardle_frame');
create type public.container_condition as enum ('normal', 'stopped', 'lost', 'damaged', 'disposed');
create type public.container_movement_kind as enum ('received', 'delivered', 'recovered', 'warehouse_transfer', 'inspection_sent', 'inspection_completed', 'disposed', 'inventory_adjustment');

create table public.container_owners (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  kind public.container_owner_kind not null,
  created_at timestamptz not null default now()
);

create table public.gas_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  name_kana text,
  basic_unit text not null default '本',
  alternate_unit text,
  contents_volume_l numeric(12,2),
  filling_pressure_mpa numeric(8,3),
  return_due_months integer,
  consumption_due_months integer,
  inbound_alert_months integer,
  outbound_alert_months integer,
  created_at timestamptz not null default now(),
  check (return_due_months is null or return_due_months >= 0),
  check (consumption_due_months is null or consumption_due_months >= 0)
);

create table public.inspection_providers (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  phone text,
  created_at timestamptz not null default now()
);

alter table public.containers
  add column if not exists management_number text,
  add column if not exists barcode text unique,
  add column if not exists rfid_epc text unique,
  add column if not exists gas_type_id uuid references public.gas_types,
  add column if not exists owner_id uuid references public.container_owners,
  add column if not exists container_form public.container_form not null default 'single',
  add column if not exists condition public.container_condition not null default 'normal',
  add column if not exists condition_changed_on date,
  add column if not exists manufacture_month date,
  add column if not exists purchased_on date,
  add column if not exists inspection_provider_id uuid references public.inspection_providers,
  add column if not exists pressure_tested_month date,
  add column if not exists pressure_test_due_month date,
  add column if not exists pressure_test_passed boolean,
  add column if not exists inspection_consigned_on date,
  add column if not exists capacity_value numeric(12,2),
  add column if not exists capacity_unit text,
  add column if not exists content_volume_l numeric(12,2),
  add column if not exists parent_container_id uuid references public.containers,
  add column if not exists notes text;

create table public.container_movements (
  id uuid primary key default gen_random_uuid(),
  container_id uuid not null references public.containers,
  kind public.container_movement_kind not null,
  occurred_on date not null,
  from_branch_id uuid references public.branches,
  to_branch_id uuid references public.branches,
  customer_id uuid references public.customers,
  reference_number text,
  source text not null default 'manual' check (source in ('manual', 'barcode', 'handheld', 'import')),
  note text,
  created_at timestamptz not null default now()
);

create index container_movements_container_occurred_idx on public.container_movements (container_id, occurred_on desc, created_at desc);
create index containers_lookup_idx on public.containers (current_branch_id, status, condition);
create index containers_pressure_test_due_idx on public.containers (pressure_test_due_month) where pressure_test_due_month is not null;
create index containers_owner_gas_idx on public.containers (owner_id, gas_type_id);

alter table public.container_owners enable row level security;
alter table public.gas_types enable row level security;
alter table public.inspection_providers enable row level security;
alter table public.container_movements enable row level security;

revoke all on public.container_owners, public.gas_types, public.inspection_providers, public.container_movements from anon, authenticated;
grant all on public.container_owners, public.gas_types, public.inspection_providers, public.container_movements to service_role;
