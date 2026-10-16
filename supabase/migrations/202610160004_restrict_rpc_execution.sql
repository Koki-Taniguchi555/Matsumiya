-- Supabase projects can grant EXECUTE directly to API roles by default.
-- Revoke both inherited and explicit grants; the server-side service role is the only caller.
revoke all on function public.record_container_lifecycle(uuid, public.lifecycle_action, date, uuid, uuid, uuid) from anon, authenticated;
revoke all on function public.calculate_monthly_usage_charge(uuid, date) from anon, authenticated;
revoke all on function public.prevent_audit_change() from anon, authenticated;
