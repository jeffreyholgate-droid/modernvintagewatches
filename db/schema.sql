-- Supabase / Postgres schema for Chronos Fine Timepieces
-- Run this in Supabase SQL editor.

-- Enable useful extension for UUIDs (usually already enabled on Supabase)
create extension if not exists pgcrypto;

create table if not exists public.items (
  id text primary key,
  ebay_item_id text unique not null,
  url text not null,
  title_raw text not null,
  title_boutique text null,
  description text null,
  price_gbp numeric not null,
  shipping_gbp numeric not null default 0,
  seller_name text not null,
  seller_feedback_percent numeric not null,
  seller_feedback_score int not null,
  category text not null,
  location_country text not null,
  image_urls jsonb not null default '[]'::jsonb,
  status text not null,
  last_seen_at timestamptz not null,
  first_seen_at timestamptz not null,
  publish_state text not null,
  score int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists items_publish_state_idx on public.items (publish_state);
create index if not exists items_last_seen_at_idx on public.items (last_seen_at desc);

create table if not exists public.settings (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.logs (
  id bigserial primary key,
  ts timestamptz not null,
  level text not null,
  message text not null
);

create index if not exists logs_ts_idx on public.logs (ts desc);
