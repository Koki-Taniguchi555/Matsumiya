-- Kept in its own migration: PostgreSQL makes a newly-added enum value
-- available to later transactions only.
alter type public.lifecycle_action add value if not exists 'supplier_return';
alter type public.container_status add value if not exists 'returned_to_supplier';
