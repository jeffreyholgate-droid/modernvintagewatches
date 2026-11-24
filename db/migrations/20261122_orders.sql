-- Apply after db/schema.sql. Test-payment recovery only; this does not enable live checkout.
-- Reservations are released ONLY by a verified Stripe expiry, never by wall-clock time.
begin;

-- The browser reads inventory through the app's filtered API. Its Supabase
-- anon/authenticated roles must not alter catalogue, settings, or audit records.
alter table public.items enable row level security;
alter table public.settings enable row level security;
alter table public.logs enable row level security;
revoke all on public.items, public.settings, public.logs from public, anon, authenticated;
grant select, insert, update, delete on public.items, public.settings, public.logs to service_role;
revoke all on sequence public.logs_id_seq from public, anon, authenticated;
grant usage, select on sequence public.logs_id_seq to service_role;
drop policy if exists mvw_server_access on public.items;
create policy mvw_server_access on public.items for all to service_role using (true) with check (true);
drop policy if exists mvw_server_access on public.settings;
create policy mvw_server_access on public.settings for all to service_role using (true) with check (true);
drop policy if exists mvw_server_access on public.logs;
create policy mvw_server_access on public.logs for all to service_role using (true) with check (true);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  checkout_key uuid unique not null,
  checkout_origin text not null,
  -- payment_review can mean money was already paid. It is never safe to
  -- automatically release stock or retry charging an order in that state.
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid_awaiting_source', 'expired', 'payment_review')),
  total_pence bigint not null check (total_pence between 50 and 99999999),
  currency text not null default 'gbp' check (currency = 'gbp'),
  stripe_session_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_lines (
  order_id uuid not null references public.orders(id),
  item_id text not null references public.items(id),
  title text not null,
  amount_pence bigint not null check (amount_pence between 50 and 99999999),
  source_url text not null,
  ebay_item_id text not null,
  primary key (order_id, item_id)
);

create table if not exists public.inventory_reservations (
  item_id text primary key references public.items(id),
  order_id uuid not null references public.orders(id),
  created_at timestamptz not null default now()
);
create index if not exists inventory_reservations_order_idx on public.inventory_reservations(order_id);
create index if not exists orders_created_at_idx on public.orders(created_at desc);

create table if not exists public.stripe_events (
  event_id text primary key,
  event_type text not null,
  order_id uuid not null references public.orders(id),
  session_id text not null,
  amount_total bigint,
  currency text,
  payment_status text,
  livemode boolean not null check (livemode = false),
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;
alter table public.order_lines enable row level security;
alter table public.inventory_reservations enable row level security;
alter table public.stripe_events enable row level security;
revoke all on public.orders, public.order_lines, public.inventory_reservations, public.stripe_events from public, anon, authenticated, service_role;
-- Server access uses the atomic functions below, not direct table mutations.
grant select on public.orders, public.order_lines, public.inventory_reservations, public.stripe_events to service_role;

create or replace function public.mvw_order_json(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', o.id, 'checkoutKey', o.checkout_key, 'checkoutOrigin', o.checkout_origin,
    'status', o.status, 'totalPence', o.total_pence, 'currency', o.currency,
    'stripeSessionId', o.stripe_session_id, 'createdAt', o.created_at,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
      'itemId', l.item_id, 'title', l.title, 'amountPence', l.amount_pence,
      'sourceUrl', l.source_url, 'ebayItemId', l.ebay_item_id
    ) order by l.item_id) from public.order_lines l where l.order_id = o.id), '[]'::jsonb)
  ) from public.orders o where o.id = p_order_id;
$$;

create or replace function public.mvw_get_order_by_checkout_key(p_checkout_key uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.mvw_order_json(o.id) from public.orders o where o.checkout_key = p_checkout_key;
$$;

create or replace function public.mvw_get_order_by_id(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select public.mvw_order_json(p_order_id);
$$;

create or replace function public.mvw_list_recent_orders(p_limit integer default 50)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(recent.body order by recent.created_at desc), '[]'::jsonb)
  from (
    select public.mvw_order_json(o.id) - 'checkoutKey' as body, o.created_at
    from public.orders o order by o.created_at desc limit least(greatest(p_limit, 1), 100)
  ) recent;
$$;

create or replace function public.mvw_reserve_order(p_checkout_key uuid, p_checkout_origin text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_line jsonb;
  v_item public.items%rowtype;
  v_order public.orders%rowtype;
  v_requested_ids text[];
  v_saved_ids text[];
  v_expected bigint;
  v_amount bigint;
  v_total bigint := 0;
  v_count integer := 0;
  v_order_id uuid;
begin
  if p_checkout_key is null or p_checkout_origin is null or length(p_checkout_origin) > 2048
    or p_checkout_origin !~ '^https?://[^/[:space:]?#@]+$'
    or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'INVALID_ORDER';
  end if;
  if jsonb_array_length(p_lines) not between 1 and 20 then
    raise exception 'INVALID_ORDER';
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) is distinct from 'object'
      or jsonb_typeof(v_line->'itemId') is distinct from 'string'
      or length(v_line->>'itemId') not between 1 and 200
      or (v_line->>'itemId') <> btrim(v_line->>'itemId')
      or (v_line->>'itemId') ~ '[[:cntrl:]]'
      or jsonb_typeof(v_line->'amountPence') is distinct from 'number'
      or (v_line->>'amountPence') !~ '^[0-9]+$' then
      raise exception 'INVALID_ORDER';
    end if;
    if (v_line->>'amountPence')::numeric not between 50 and 99999999 then
      raise exception 'INVALID_ORDER';
    end if;
  end loop;
  select array_agg(x->>'itemId' order by x->>'itemId') into v_requested_ids from jsonb_array_elements(p_lines) x;
  if (select count(distinct x->>'itemId') from jsonb_array_elements(p_lines) x) <> cardinality(v_requested_ids) then
    raise exception 'INVALID_ORDER';
  end if;

  -- Serialize requests for one checkout key, including before its order exists.
  perform pg_advisory_xact_lock(hashtextextended('mvw-checkout:' || p_checkout_key::text, 0));
  select * into v_order from public.orders where checkout_key = p_checkout_key for update;
  if found then
    select array_agg(item_id order by item_id) into v_saved_ids from public.order_lines where order_id = v_order.id;
    if v_saved_ids is distinct from v_requested_ids then raise exception 'CHECKOUT_KEY_REUSED'; end if;
    -- Retry reuses immutable snapshots and origin even after prices/config change.
    return public.mvw_order_json(v_order.id);
  end if;

  -- Always acquire inventory locks in the same order to avoid basket deadlocks.
  for v_item in
    select i.* from public.items i where i.id = any(v_requested_ids) order by i.id for update
  loop
    v_count := v_count + 1;
    if v_item.status <> 'ACTIVE' or v_item.publish_state <> 'PUBLISHED'
      or exists(select 1 from public.inventory_reservations r where r.item_id = v_item.id) then
      raise exception 'ITEM_UNAVAILABLE';
    end if;
    if v_item.price_gbp not between 0.50 and 999999.99 then raise exception 'ITEM_UNAVAILABLE'; end if;
    v_amount := round(v_item.price_gbp * 100)::bigint;
    select (x->>'amountPence')::bigint into v_expected
      from jsonb_array_elements(p_lines) x where x->>'itemId' = v_item.id;
    if v_amount <> v_expected then raise exception 'ITEM_CHANGED'; end if;
    v_total := v_total + v_amount;
  end loop;
  if v_count <> cardinality(v_requested_ids) then raise exception 'ITEM_UNAVAILABLE'; end if;
  if v_total not between 50 and 99999999 then raise exception 'INVALID_ORDER'; end if;

  insert into public.orders(checkout_key, checkout_origin, total_pence)
    values(p_checkout_key, p_checkout_origin, v_total) returning id into v_order_id;
  insert into public.order_lines(order_id, item_id, title, amount_pence, source_url, ebay_item_id)
    select v_order_id, i.id, coalesce(nullif(btrim(i.title_boutique), ''), i.title_raw),
      round(i.price_gbp * 100)::bigint, i.url, i.ebay_item_id
    from public.items i where i.id = any(v_requested_ids);
  insert into public.inventory_reservations(item_id, order_id)
    select unnest(v_requested_ids), v_order_id;
  update public.items set status = 'RESERVED', updated_at = now() where id = any(v_requested_ids);
  return public.mvw_order_json(v_order_id);
end;
$$;

create or replace function public.mvw_attach_checkout_session(p_order_id uuid, p_session_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype;
begin
  if p_order_id is null or p_session_id is null or length(p_session_id) > 256
    or p_session_id !~ '^cs_test_[A-Za-z0-9]+$' then raise exception 'INVALID_ORDER'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.stripe_session_id = p_session_id then return public.mvw_order_json(p_order_id); end if;
  if v_order.stripe_session_id is not null then raise exception 'SESSION_CONFLICT'; end if;
  if v_order.status <> 'pending_payment' then raise exception 'ORDER_UNAVAILABLE'; end if;
  begin
    update public.orders set stripe_session_id = p_session_id, updated_at = now() where id = p_order_id;
  exception when unique_violation then raise exception 'SESSION_CONFLICT'; end;
  return public.mvw_order_json(p_order_id);
end;
$$;

create or replace function public.mvw_apply_stripe_event(
  p_event_id text, p_type text, p_order_id uuid, p_session_id text,
  p_amount_total bigint, p_currency text, p_payment_status text, p_livemode boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders%rowtype;
  v_event public.stripe_events%rowtype;
  v_line_count integer;
  v_owned_count integer;
begin
  if p_event_id is null or length(p_event_id) > 256 or p_event_id !~ '^evt_[A-Za-z0-9]+$'
    or p_order_id is null or p_session_id is null or length(p_session_id) > 256
    or p_session_id !~ '^cs_test_[A-Za-z0-9]+$' or p_livemode is distinct from false
    or p_type is null or p_type not in ('checkout.session.completed', 'checkout.session.async_payment_succeeded',
      'checkout.session.expired', 'checkout.session.async_payment_failed') then
    raise exception 'INVALID_EVENT';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mvw-stripe:' || p_event_id, 0));
  select * into v_event from public.stripe_events where event_id = p_event_id;
  if found then
    if v_event.order_id is distinct from p_order_id or v_event.session_id is distinct from p_session_id
      or v_event.event_type is distinct from p_type or v_event.amount_total is distinct from p_amount_total
      or v_event.currency is distinct from p_currency or v_event.payment_status is distinct from p_payment_status then
      raise exception 'INVALID_EVENT';
    end if;
    return jsonb_build_object('order', public.mvw_order_json(v_event.order_id), 'duplicate', true);
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  -- Stripe can deliver before the create-session response was attached. Retry it.
  if v_order.stripe_session_id is null then raise exception 'ORDER_SESSION_PENDING'; end if;
  insert into public.stripe_events(event_id, event_type, order_id, session_id, amount_total, currency, payment_status, livemode)
    values(p_event_id, p_type, p_order_id, p_session_id, p_amount_total, p_currency, p_payment_status, false);

  if v_order.status = 'payment_review'
    or (v_order.status = 'paid_awaiting_source' and p_type in ('checkout.session.expired', 'checkout.session.async_payment_failed')) then
    return jsonb_build_object('order', public.mvw_order_json(p_order_id), 'duplicate', false);
  end if;

  if v_order.stripe_session_id <> p_session_id or v_order.total_pence is distinct from p_amount_total
    or p_currency is distinct from 'gbp' then
    update public.orders set status = 'payment_review', updated_at = now() where id = p_order_id;
    return jsonb_build_object('order', public.mvw_order_json(p_order_id), 'duplicate', false);
  end if;

  if p_type in ('checkout.session.completed', 'checkout.session.async_payment_succeeded') and p_payment_status = 'paid' then
    if v_order.status = 'paid_awaiting_source' then
      return jsonb_build_object('order', public.mvw_order_json(p_order_id), 'duplicate', false);
    end if;
    if v_order.status <> 'pending_payment' then
      update public.orders set status = 'payment_review', updated_at = now() where id = p_order_id;
      return jsonb_build_object('order', public.mvw_order_json(p_order_id), 'duplicate', false);
    end if;
  elsif p_type = 'checkout.session.expired' then
    if v_order.status = 'expired' then
      return jsonb_build_object('order', public.mvw_order_json(p_order_id), 'duplicate', false);
    end if;
    if p_payment_status is distinct from 'unpaid' then
      update public.orders set status = 'payment_review', updated_at = now() where id = p_order_id;
      return jsonb_build_object('order', public.mvw_order_json(p_order_id), 'duplicate', false);
    end if;
  else
    -- Completed-unpaid and asynchronous failure do not release a still-payable session.
    return jsonb_build_object('order', public.mvw_order_json(p_order_id), 'duplicate', false);
  end if;

  perform i.id from public.items i join public.order_lines l on l.item_id = i.id
    where l.order_id = p_order_id order by i.id for update of i;
  select count(*) into v_line_count from public.order_lines where order_id = p_order_id;
  select count(*) into v_owned_count from public.inventory_reservations r
    join public.items i on i.id = r.item_id
    join public.order_lines l on l.item_id = r.item_id and l.order_id = p_order_id
    where r.order_id = p_order_id and i.status = 'RESERVED';
  if v_line_count = 0 or v_owned_count <> v_line_count then
    update public.orders set status = 'payment_review', updated_at = now() where id = p_order_id;
    return jsonb_build_object('order', public.mvw_order_json(p_order_id), 'duplicate', false);
  end if;

  if p_type = 'checkout.session.expired' then
    update public.items i set status = 'ACTIVE', updated_at = now()
      from public.inventory_reservations r where r.item_id = i.id and r.order_id = p_order_id and i.status = 'RESERVED';
    update public.orders set status = 'expired', updated_at = now() where id = p_order_id;
  else
    update public.items i set status = 'SOLD', publish_state = 'UNPUBLISHED', updated_at = now()
      from public.inventory_reservations r where r.item_id = i.id and r.order_id = p_order_id and i.status = 'RESERVED';
    update public.orders set status = 'paid_awaiting_source', updated_at = now() where id = p_order_id;
  end if;
  delete from public.inventory_reservations where order_id = p_order_id;
  return jsonb_build_object('order', public.mvw_order_json(p_order_id), 'duplicate', false);
end;
$$;

revoke all on function public.mvw_order_json(uuid) from public, anon, authenticated;
revoke all on function public.mvw_get_order_by_checkout_key(uuid) from public, anon, authenticated;
revoke all on function public.mvw_get_order_by_id(uuid) from public, anon, authenticated;
revoke all on function public.mvw_list_recent_orders(integer) from public, anon, authenticated;
revoke all on function public.mvw_reserve_order(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.mvw_attach_checkout_session(uuid, text) from public, anon, authenticated;
revoke all on function public.mvw_apply_stripe_event(text, text, uuid, text, bigint, text, text, boolean) from public, anon, authenticated;
grant execute on function public.mvw_order_json(uuid), public.mvw_get_order_by_checkout_key(uuid),
  public.mvw_get_order_by_id(uuid), public.mvw_list_recent_orders(integer),
  public.mvw_reserve_order(uuid, text, jsonb), public.mvw_attach_checkout_session(uuid, text),
  public.mvw_apply_stripe_event(text, text, uuid, text, bigint, text, text, boolean) to service_role;

commit;
