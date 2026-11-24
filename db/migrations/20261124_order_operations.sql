-- Apply after the order and retail-pricing migrations.
begin;

create table public.order_operations (
  order_id uuid not null references public.orders(id),
  revision integer not null check (revision > 0),
  state text not null check (state in (
    'purchase_in_progress', 'awaiting_source', 'sourced', 'inspected', 'dispatched', 'refund_requested', 'refunded'
  )),
  refund_reason text check (refund_reason in ('source_unavailable', 'cost_changed', 'customer_cancelled', 'other')),
  created_at timestamptz not null default now(),
  primary key (order_id, revision),
  check ((refund_reason is not null) = (state = 'refund_requested'))
);

alter table public.order_operations enable row level security;
revoke all on public.order_operations from public, anon, authenticated, service_role;

create function public.mvw_order_operations(p_order_ids uuid[])
returns table (order_id uuid, revision integer, state text, refund_reason text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select distinct on (e.order_id) e.order_id, e.revision, e.state, e.refund_reason, e.created_at
  from public.order_operations e
  where e.order_id = any(p_order_ids)
  order by e.order_id, e.revision desc;
$$;

create function public.mvw_record_order_operation(
  p_order_id uuid, p_revision integer, p_state text, p_refund_reason text
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_payment_status text;
  v_previous public.order_operations%rowtype;
  v_next public.order_operations%rowtype;
  v_state text;
begin
  -- Serialize operations with each other and with checkout payment transitions.
  select status into v_payment_status from public.orders where id = p_order_id for update;
  if v_payment_status is distinct from 'paid_awaiting_source' then
    raise exception 'OPERATION_NOT_ALLOWED';
  end if;
  select * into v_previous from public.order_operations e
    where e.order_id = p_order_id order by e.revision desc limit 1;
  v_state := coalesce(v_previous.state, 'awaiting_source');

  if p_revision is distinct from coalesce(v_previous.revision, 0) then
    raise exception 'OPERATION_CHANGED';
  end if;

  if (case v_state
    when 'awaiting_source' then p_state in ('purchase_in_progress', 'refund_requested')
    when 'purchase_in_progress' then p_state in ('awaiting_source', 'sourced')
    when 'sourced' then p_state = 'inspected'
    when 'inspected' then p_state = 'dispatched'
    when 'refund_requested' then p_state = 'refunded'
    else false
  end) is not true then
    raise exception 'OPERATION_NOT_ALLOWED';
  end if;

  insert into public.order_operations (order_id, revision, state, refund_reason)
  values (p_order_id, p_revision + 1, p_state, p_refund_reason)
  returning * into v_next;
  return to_jsonb(v_next);
end;
$$;

revoke all on function public.mvw_order_operations(uuid[]),
  public.mvw_record_order_operation(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.mvw_order_operations(uuid[]),
  public.mvw_record_order_operation(uuid, integer, text, text) to service_role;
commit;
