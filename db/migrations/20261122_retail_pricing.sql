-- Apply after 20261122_orders.sql. Additive: historical order amounts and Stripe
-- parameters remain unchanged. No source costs are invented for historical lines.
begin;

alter table public.order_lines add column if not exists pricing_snapshot jsonb;

-- SQL twin of api/_lib/pricing.ts, covered by parity tests. All amounts are pence;
-- target gross margin is before estimated payment fees and other overheads.
create or replace function public.mvw_pricing_quote(
  p_source_price numeric, p_source_shipping numeric, p_category text, p_settings jsonb
) returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  v_policy jsonb;
  v_margins jsonb;
  v_margin numeric;
  v_margin_bps bigint;
  v_source bigint;
  v_shipping bigint;
  v_delivery bigint;
  v_fee_bps bigint;
  v_fee_fixed bigint;
  v_rounding bigint;
  v_cost bigint;
  v_retail bigint;
  v_fee bigint;
  v_name text;
begin
  if jsonb_typeof(p_settings) is distinct from 'object'
    or p_category is null or p_category not in ('WATCH','HANDBAG','JEWELLERY') then
    raise exception 'INVALID_PRICING_SETTINGS';
  end if;
  -- Match normalizeSettings: only absent maps/categories acquire the 20% default.
  -- Explicit nulls, malformed maps, unknown categories and invalid values fail closed.
  v_margins := case when p_settings ? 'marginPercent' then p_settings->'marginPercent' else '{}'::jsonb end;
  if jsonb_typeof(v_margins) is distinct from 'object' then
    raise exception 'INVALID_PRICING_SETTINGS';
  end if;
  if exists(select 1 from jsonb_object_keys(v_margins) k where k not in ('WATCH','HANDBAG','JEWELLERY')) then
    raise exception 'INVALID_PRICING_SETTINGS';
  end if;
  foreach v_name in array array['WATCH','HANDBAG','JEWELLERY'] loop
    if v_margins ? v_name then
      if jsonb_typeof(v_margins->v_name) is distinct from 'number' then raise exception 'INVALID_PRICING_SETTINGS'; end if;
      v_margin := (v_margins->>v_name)::numeric;
      if v_margin not between 5 and 60 or abs(round(v_margin * 100) - v_margin * 100) > 0.0000001 then
        raise exception 'INVALID_PRICING_SETTINGS';
      end if;
    end if;
  end loop;
  v_margin := case when v_margins ? p_category then (v_margins->>p_category)::numeric else 20 end;
  v_margin_bps := round(v_margin * 100)::bigint;
  if not (p_settings ? 'pricingPolicy') then
    v_policy := '{"version":"mvw-pricing-v1","deliveryAllowancePence":5000,"feeAllowanceBps":350,"feeFixedPence":20,"roundingPence":500,"vatMode":"NOT_REGISTERED"}'::jsonb;
  else
    v_policy := p_settings->'pricingPolicy';
  end if;
  if jsonb_typeof(v_policy) is distinct from 'object'
    or v_policy->>'version' is distinct from 'mvw-pricing-v1'
    or v_policy->>'vatMode' is distinct from 'NOT_REGISTERED' then
    raise exception 'INVALID_PRICING_SETTINGS';
  end if;
  foreach v_name in array array['deliveryAllowancePence','feeAllowanceBps','feeFixedPence','roundingPence'] loop
    if jsonb_typeof(v_policy->v_name) is distinct from 'number'
      or (v_policy->>v_name)::numeric <> trunc((v_policy->>v_name)::numeric) then
      raise exception 'INVALID_PRICING_SETTINGS';
    end if;
  end loop;
  if (v_policy->>'deliveryAllowancePence')::numeric not between 0 and 25000
    or (v_policy->>'feeAllowanceBps')::numeric not between 0 and 1000
    or (v_policy->>'feeFixedPence')::numeric not between 0 and 500
    or (v_policy->>'roundingPence')::numeric not in (100,500,1000) then
    raise exception 'INVALID_PRICING_SETTINGS';
  end if;
  v_delivery := (v_policy->>'deliveryAllowancePence')::bigint;
  v_fee_bps := (v_policy->>'feeAllowanceBps')::bigint;
  v_fee_fixed := (v_policy->>'feeFixedPence')::bigint;
  v_rounding := (v_policy->>'roundingPence')::bigint;
  if p_source_price is null or p_source_shipping is null
    or round(p_source_price * 100) not between 50 and 99999999
    or round(p_source_shipping * 100) not between 0 and 99999999
    or abs(round(p_source_price * 100) / 100 - p_source_price) > 0.0000001
    or abs(round(p_source_shipping * 100) / 100 - p_source_shipping) > 0.0000001 then
    raise exception 'ITEM_UNAVAILABLE';
  end if;
  v_source := round(p_source_price * 100)::bigint;
  v_shipping := round(p_source_shipping * 100)::bigint;
  v_cost := v_source + v_shipping + v_delivery;
  v_retail := ceil(v_cost::numeric * 10000 / ((10000 - v_margin_bps) * v_rounding))::bigint * v_rounding;
  if v_retail not between 50 and 99999999 then raise exception 'ITEM_UNAVAILABLE'; end if;
  v_fee := ceil(v_retail::numeric * v_fee_bps / 10000)::bigint + v_fee_fixed;
  return jsonb_build_object(
    'policyVersion','mvw-pricing-v1','retailPricePence',v_retail,'deliveryIncluded',true,
    'deliveryRegion','GB','vatMode','NOT_REGISTERED','sourceItemPence',v_source,
    'sourceShippingPence',v_shipping,'deliveryAllowancePence',v_delivery,'costBasisPence',v_cost,
    'marginBps',v_margin_bps,'feeAllowanceBps',v_fee_bps,'feeFixedPence',v_fee_fixed,
    'roundingPence',v_rounding,'estimatedFeePence',v_fee,'grossProfitPence',v_retail-v_cost,
    'estimatedContributionPence',v_retail-v_cost-v_fee
  );
end;
$$;

create or replace function public.mvw_order_json(p_order_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id',o.id,'checkoutKey',o.checkout_key,'checkoutOrigin',o.checkout_origin,
    'status',o.status,'totalPence',o.total_pence,'currency',o.currency,
    'stripeSessionId',o.stripe_session_id,'createdAt',o.created_at,
    'lines',coalesce((select jsonb_agg(jsonb_build_object(
      'itemId',l.item_id,'title',l.title,'amountPence',l.amount_pence,
      'sourceUrl',l.source_url,'ebayItemId',l.ebay_item_id,'pricing',l.pricing_snapshot
    ) order by l.item_id) from public.order_lines l where l.order_id=o.id),'[]'::jsonb)
  ) from public.orders o where o.id=p_order_id;
$$;

create or replace function public.mvw_reserve_order(p_checkout_key uuid,p_checkout_origin text,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_line jsonb;
  v_item public.items%rowtype;
  v_order public.orders%rowtype;
  v_requested_ids text[];
  v_saved_ids text[];
  v_settings jsonb;
  v_pricing jsonb;
  v_quotes jsonb := '{}'::jsonb;
  v_total bigint := 0;
  v_count integer := 0;
  v_order_id uuid;
begin
  if p_checkout_key is null or p_checkout_origin is null or length(p_checkout_origin)>2048
    or p_checkout_origin !~ '^https?://[^/[:space:]?#@]+$'
    or jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'INVALID_ORDER'; end if;
  if jsonb_array_length(p_lines) not between 1 and 20 then raise exception 'INVALID_ORDER'; end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) is distinct from 'object'
      or jsonb_typeof(v_line->'itemId') is distinct from 'string'
      or length(v_line->>'itemId') not between 1 and 200
      or (v_line->>'itemId') <> btrim(v_line->>'itemId') or (v_line->>'itemId') ~ '[[:cntrl:]]'
      or jsonb_typeof(v_line->'amountPence') is distinct from 'number'
      or (v_line->>'amountPence')::numeric <> trunc((v_line->>'amountPence')::numeric)
      or (v_line->>'amountPence')::numeric not between 50 and 99999999 then
      raise exception 'INVALID_ORDER';
    end if;
  end loop;
  select array_agg(x->>'itemId' order by x->>'itemId') into v_requested_ids from jsonb_array_elements(p_lines) x;
  if (select count(distinct x->>'itemId') from jsonb_array_elements(p_lines) x) <> cardinality(v_requested_ids) then
    raise exception 'INVALID_ORDER';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('mvw-checkout:' || p_checkout_key::text,0));
  select * into v_order from public.orders where checkout_key=p_checkout_key for update;
  if found then
    select array_agg(item_id order by item_id) into v_saved_ids from public.order_lines where order_id=v_order.id;
    if v_saved_ids is distinct from v_requested_ids then raise exception 'CHECKOUT_KEY_REUSED'; end if;
    -- Crucial for existing orders, including legacy orders with no pricing snapshot:
    -- retries never reprice, re-read policy, or alter existing Stripe parameters.
    return public.mvw_order_json(v_order.id);
  end if;
  -- Hold the policy stable across all item reservations, blocking concurrent settings writes.
  select data into v_settings from public.settings where id='default' for share;
  if not found then raise exception 'INVALID_PRICING_SETTINGS'; end if;
  for v_item in select i.* from public.items i where i.id=any(v_requested_ids) order by i.id for update loop
    v_count := v_count+1;
    if v_item.status <> 'ACTIVE' or v_item.publish_state <> 'PUBLISHED'
      or exists(select 1 from public.inventory_reservations r where r.item_id=v_item.id) then
      raise exception 'ITEM_UNAVAILABLE';
    end if;
    select x into v_line from jsonb_array_elements(p_lines) x where x->>'itemId'=v_item.id;
    if jsonb_typeof(v_line->'pricing') is distinct from 'object' then raise exception 'PRICE_CHANGED'; end if;
    v_pricing := public.mvw_pricing_quote(v_item.price_gbp,v_item.shipping_gbp,v_item.category,v_settings);
    if v_line->'pricing'->'sourceItemPence' is distinct from v_pricing->'sourceItemPence'
      or v_line->'pricing'->'sourceShippingPence' is distinct from v_pricing->'sourceShippingPence' then
      raise exception 'ITEM_CHANGED';
    end if;
    if v_line->'pricing' is distinct from v_pricing
      or (v_line->>'amountPence')::bigint <> (v_pricing->>'retailPricePence')::bigint then
      raise exception 'PRICE_CHANGED';
    end if;
    v_total := v_total+(v_pricing->>'retailPricePence')::bigint;
    v_quotes := v_quotes || jsonb_build_object(v_item.id,v_pricing);
  end loop;
  if v_count <> cardinality(v_requested_ids) then raise exception 'ITEM_UNAVAILABLE'; end if;
  if v_total not between 50 and 99999999 then raise exception 'INVALID_ORDER'; end if;
  insert into public.orders(checkout_key,checkout_origin,total_pence)
    values(p_checkout_key,p_checkout_origin,v_total) returning id into v_order_id;
  insert into public.order_lines(order_id,item_id,title,amount_pence,source_url,ebay_item_id,pricing_snapshot)
    select v_order_id,i.id,coalesce(nullif(btrim(i.title_boutique),''),i.title_raw),
      (v_quotes->i.id->>'retailPricePence')::bigint,i.url,i.ebay_item_id,v_quotes->i.id
    from public.items i where i.id=any(v_requested_ids);
  insert into public.inventory_reservations(item_id,order_id) select unnest(v_requested_ids),v_order_id;
  update public.items set status='RESERVED',updated_at=now() where id=any(v_requested_ids);
  return public.mvw_order_json(v_order_id);
end;
$$;

revoke all on function public.mvw_pricing_quote(numeric,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.mvw_pricing_quote(numeric,numeric,text,jsonb) to service_role;
-- CREATE OR REPLACE preserves the existing service-only ACLs on the order RPCs.
commit;
