-- MVW read-only database audit. Run in the intended Supabase project's SQL editor.
-- This script does not apply migrations, change roles/settings, create functions,
-- or select customer, order, inventory, or log records. It returns schema metadata
-- and aggregate counts only. Review each result set separately in the SQL editor.
-- Exact COUNT(*) can scan large tables; counts describe rows visible to the
-- current SQL role. In Supabase SQL editor, use the normal administrative role
-- when checking whole-table totals. Missing tables/roles/functions are reported.

-- 1. Database engine and the audit role's RLS visibility (no credentials).
select current_setting('server_version') as server_version,
       current_user as audit_role,
       r.rolsuper as audit_role_is_superuser,
       r.rolbypassrls as audit_role_bypasses_rls
from pg_catalog.pg_roles r
where r.rolname = current_user;

-- 2. Required tables, RLS, and exact visible row counts. Only existing ordinary
-- or partitioned tables with SELECT permission are counted. query_to_xml runs
-- one SELECT COUNT(*) per allowlisted table; it never selects stored row fields.
with expected(table_name) as (
  values ('items'), ('settings'), ('logs'), ('orders'), ('order_lines'),
         ('inventory_reservations'), ('stripe_events')
), relations as (
  select e.table_name, c.oid, c.relkind, c.relrowsecurity, c.relforcerowsecurity
  from expected e
  left join pg_catalog.pg_namespace n on n.nspname = 'public'
  left join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = e.table_name
)
select table_name,
       oid is not null as present,
       case relkind when 'r' then 'table' when 'p' then 'partitioned table'
         when 'v' then 'view (not counted)' when 'm' then 'materialized view (not counted)'
         else relkind::text end as relation_kind,
       relrowsecurity as rls_enabled,
       relforcerowsecurity as rls_forced,
       case
         when oid is null then 'missing'
         when relkind not in ('r', 'p') then 'unexpected relation kind'
         when not pg_catalog.has_table_privilege(current_user, oid, 'SELECT') then 'no SELECT permission'
         else 'exact count of rows visible to audit role'
       end as count_scope,
       case when oid is not null and relkind in ('r', 'p')
         and pg_catalog.has_table_privilege(current_user, oid, 'SELECT') then
         (xpath('/table/row/n/text()', query_to_xml(
           format('select count(*) as n from %I.%I', 'public', table_name),
           false, false, ''
         )))[1]::text::bigint
         else null
       end as exact_visible_rows
from relations
order by table_name;

-- 3. Every required column, its actual type, and nullability. Missing columns
-- appear explicitly; no column values or default expressions are retrieved.
with expected(table_name, columns) as (
  values
    ('items', array['id','ebay_item_id','url','title_raw','title_boutique','description',
      'price_gbp','shipping_gbp','seller_name','seller_feedback_percent','seller_feedback_score',
      'category','location_country','image_urls','status','last_seen_at','first_seen_at',
      'publish_state','score','created_at','updated_at']),
    ('settings', array['id','data','updated_at']),
    ('logs', array['id','ts','level','message']),
    ('orders', array['id','checkout_key','checkout_origin','status','total_pence','currency',
      'stripe_session_id','created_at','updated_at']),
    ('order_lines', array['order_id','item_id','title','amount_pence','source_url','ebay_item_id']),
    ('inventory_reservations', array['item_id','order_id','created_at']),
    ('stripe_events', array['event_id','event_type','order_id','session_id','amount_total',
      'currency','payment_status','livemode','created_at'])
), required as (
  select e.table_name, unnest(e.columns) as column_name from expected e
)
select r.table_name, r.column_name,
       a.attnum is not null as present,
       case when a.attnum is not null then pg_catalog.format_type(a.atttypid, a.atttypmod) end as actual_type,
       case when a.attnum is not null then not a.attnotnull end as is_nullable
from required r
left join pg_catalog.pg_namespace n on n.nspname = 'public'
left join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = r.table_name
left join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = r.column_name
  and a.attnum > 0 and not a.attisdropped
order by r.table_name, r.column_name;

-- 4. Effective table privileges, including inherited/PUBLIC grants. Expected:
-- anon/authenticated have none; service_role has catalogue/settings/log CRUD,
-- but only SELECT on order tables (order mutations use the transaction RPCs).
with expected(table_name) as (
  values ('items'), ('settings'), ('logs'), ('orders'), ('order_lines'),
         ('inventory_reservations'), ('stripe_events')
), expected_roles(role_name) as (values ('anon'), ('authenticated'), ('service_role'))
select e.table_name, er.role_name,
       c.oid is not null as table_present, r.oid is not null as role_present,
       c.relrowsecurity as rls_enabled, r.rolbypassrls as role_bypasses_rls,
       case when c.oid is not null and r.oid is not null then pg_catalog.has_table_privilege(r.oid,c.oid,'SELECT') end as can_select,
       case when c.oid is not null and r.oid is not null then pg_catalog.has_table_privilege(r.oid,c.oid,'INSERT') end as can_insert,
       case when c.oid is not null and r.oid is not null then pg_catalog.has_table_privilege(r.oid,c.oid,'UPDATE') end as can_update,
       case when c.oid is not null and r.oid is not null then pg_catalog.has_table_privilege(r.oid,c.oid,'DELETE') end as can_delete
from expected e cross join expected_roles er
left join pg_catalog.pg_namespace n on n.nspname = 'public'
left join pg_catalog.pg_class c on c.relnamespace = n.oid and c.relname = e.table_name
left join pg_catalog.pg_roles r on r.rolname = er.role_name
order by e.table_name, er.role_name;

-- 5. RLS policy summary. Expressions are intentionally omitted: policies can
-- contain user-specific literals. No policies on an RLS table means default-deny
-- for non-bypass roles; privileges and RLS must both permit access.
select schemaname as schema_name, tablename as table_name, policyname,
       permissive, roles, cmd as command,
       qual is not null as has_using_expression,
       with_check is not null as has_check_expression
from pg_catalog.pg_policies
where schemaname = 'public'
  and tablename in ('items','settings','logs','orders','order_lines','inventory_reservations','stripe_events')
order by tablename, policyname;

-- 6. Expected RPC signatures and function security. Lookup only: none is called.
-- The recovery migration defines all of these as SECURITY DEFINER with an empty
-- search_path and grants execution only to service_role.
with expected(signature) as (
  values
    ('public.mvw_order_json(uuid)'),
    ('public.mvw_get_order_by_checkout_key(uuid)'),
    ('public.mvw_get_order_by_id(uuid)'),
    ('public.mvw_list_recent_orders(integer)'),
    ('public.mvw_reserve_order(uuid,text,jsonb)'),
    ('public.mvw_attach_checkout_session(uuid,text)'),
    ('public.mvw_apply_stripe_event(text,text,uuid,text,bigint,text,text,boolean)')
)
select e.signature as expected_signature,
       p.oid is not null as present,
       case when p.oid is not null then pg_catalog.pg_get_function_identity_arguments(p.oid) end as actual_arguments,
       case when p.oid is not null then pg_catalog.pg_get_function_result(p.oid) end as result_type,
       p.prosecdef as security_definer,
       (select cfg from unnest(p.proconfig) cfg where cfg like 'search_path=%' limit 1) as search_path_setting
from expected e
left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(e.signature)
order by e.signature;

-- 7. Effective RPC execution privileges. Any anon/authenticated true value
-- needs investigation before checkout is enabled.
with expected(signature) as (
  values
    ('public.mvw_order_json(uuid)'),
    ('public.mvw_get_order_by_checkout_key(uuid)'),
    ('public.mvw_get_order_by_id(uuid)'),
    ('public.mvw_list_recent_orders(integer)'),
    ('public.mvw_reserve_order(uuid,text,jsonb)'),
    ('public.mvw_attach_checkout_session(uuid,text)'),
    ('public.mvw_apply_stripe_event(text,text,uuid,text,bigint,text,text,boolean)')
), expected_roles(role_name) as (values ('anon'), ('authenticated'), ('service_role'))
select e.signature as expected_signature, er.role_name,
       p.oid is not null as function_present, r.oid is not null as role_present,
       case when p.oid is not null and r.oid is not null then pg_catalog.has_function_privilege(r.oid,p.oid,'EXECUTE') end as can_execute
from expected e cross join expected_roles er
left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(e.signature)
left join pg_catalog.pg_roles r on r.rolname = er.role_name
order by e.signature, er.role_name;
