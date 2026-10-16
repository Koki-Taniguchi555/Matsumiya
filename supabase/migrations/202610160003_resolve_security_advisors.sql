-- The Next.js server uses the service_role key, which already bypasses RLS.
-- SECURITY INVOKER avoids exposing a privileged RPC endpoint through the Data API.
alter function public.record_container_lifecycle(uuid, public.lifecycle_action, date, uuid, uuid, uuid)
  security invoker;
alter function public.calculate_monthly_usage_charge(uuid, date)
  security invoker;
alter function public.prevent_audit_change()
  set search_path = public, pg_temp;

create index containers_current_branch_id_idx on public.containers(current_branch_id);
create index containers_current_customer_id_idx on public.containers(current_customer_id);
