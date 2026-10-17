create index container_movements_customer_id_idx on public.container_movements (customer_id);
create index container_movements_from_branch_id_idx on public.container_movements (from_branch_id);
create index container_movements_to_branch_id_idx on public.container_movements (to_branch_id);
create index containers_gas_type_id_idx on public.containers (gas_type_id);
create index containers_inspection_provider_id_idx on public.containers (inspection_provider_id);
create index containers_parent_container_id_idx on public.containers (parent_container_id);
