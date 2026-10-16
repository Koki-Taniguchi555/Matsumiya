-- The application invokes lifecycle functions only from its server-side service-role client.
-- Keep those privileged functions out of the public Data API surface.
alter function public.record_container_lifecycle(uuid, public.lifecycle_action, date, uuid, uuid, uuid)
  set search_path = public, pg_temp;
alter function public.calculate_monthly_usage_charge(uuid, date)
  set search_path = public, pg_temp;

revoke all on function public.record_container_lifecycle(uuid, public.lifecycle_action, date, uuid, uuid, uuid) from public;
revoke all on function public.calculate_monthly_usage_charge(uuid, date) from public;
revoke all on function public.prevent_audit_change() from public;
grant execute on function public.record_container_lifecycle(uuid, public.lifecycle_action, date, uuid, uuid, uuid) to service_role;
grant execute on function public.calculate_monthly_usage_charge(uuid, date) to service_role;

alter table public.branches enable row level security;
alter table public.customers enable row level security;

-- Direct browser access is not part of this MVP. Access goes through Next.js APIs.
revoke all on table public.branches, public.customers, public.containers, public.container_loans, public.container_audit_logs, public.usage_charges from anon, authenticated;

create index container_loans_customer_id_idx on public.container_loans(customer_id);
create index container_loans_delivered_on_idx on public.container_loans(delivered_on);
create index container_audit_logs_container_occurred_on_idx on public.container_audit_logs(container_id, occurred_on desc);
create index usage_charges_billing_month_idx on public.usage_charges(billing_month);
