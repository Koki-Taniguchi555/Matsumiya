-- Normalize the first demo-data batch, which used space padding in format().
update public.containers
set serial_number = 'HIST-DEMO-' || lpad(trim(substr(serial_number, length('HIST-DEMO-') + 1))::integer::text, 3, '0'),
    management_number = 'HIST-M-' || lpad(trim(substr(management_number, length('HIST-M-') + 1))::integer::text, 3, '0'),
    barcode = 'HIST-BC-' || lpad(trim(substr(barcode, length('HIST-BC-') + 1))::integer::text, 3, '0')
where serial_number like 'HIST-DEMO-%';

update public.suppliers
set code = 'SUP-' || lpad(trim(substr(code, length('SUP-') + 1))::integer::text, 3, '0'),
    name = 'サンプル 仕入先' || lpad(trim(substr(name, length('サンプル 仕入先') + 1))::integer::text, 3, '0')
where code like 'SUP-%';
