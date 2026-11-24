-- Apply after 20261124_watch_backdrops.sql.
begin;

alter table public.items add column if not exists oak_photo_review jsonb not null default '[]';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mvw-oak-study', 'mvw-oak-study', false, 4300000, array['image/png'])
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from storage.buckets where id = 'mvw-oak-study'
      and not public and file_size_limit = 4300000 and allowed_mime_types = array['image/png']
  ) then raise exception 'OAK_STUDIO_STORAGE_MISMATCH'; end if;
end;
$$;

create or replace function public.mvw_guard_watch_backdrop()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_legacy boolean := false;
  v_unchanged boolean := false;
  v_photo jsonb;
begin
  if tg_op = 'UPDATE' then
    if new.image_urls is distinct from old.image_urls then
      new.oak_photo_review := '[]';
    end if;
    v_legacy := old.publish_state = 'PUBLISHED' and
      not coalesce(old.photo_review @? '$[*].oak', false);
    v_unchanged := old.publish_state = 'PUBLISHED' and new.photo_review is not distinct from old.photo_review;
  end if;
  if jsonb_typeof(new.oak_photo_review) is distinct from 'array' then
    raise exception 'OAK_STUDIO_REVIEW_REQUIRED';
  end if;
  if new.publish_state is distinct from 'PUBLISHED' or v_unchanged then return new; end if;

  -- The preceding gallery trigger verifies exact source coverage and unique URLs.
  if jsonb_typeof(new.photo_review) is distinct from 'array' or jsonb_array_length(new.photo_review) = 0 then
    raise exception 'OAK_STUDIO_REVIEW_REQUIRED';
  end if;
  for v_photo in select value from jsonb_array_elements(new.photo_review) loop
    if v_legacy and not (new.photo_review @? '$[*].oak') then
      if not public.mvw_valid_watch_mask(v_photo->'mask') then
        raise exception 'PHOTO_BACKDROP_REQUIRED';
      end if;
    elsif v_photo->'oak'->>'itemId' is distinct from new.id
      or coalesce(v_photo->'oak'->>'outputSha256', '') !~ '^[a-f0-9]{64}$'
      or coalesce(v_photo->'oak'->>'sourceSha256', '') !~ '^[a-f0-9]{64}$'
      or v_photo->>'tone' is distinct from 'original'
      or v_photo ? 'mask'
      or not (new.oak_photo_review @> jsonb_build_array(v_photo)) then
      raise exception 'OAK_STUDIO_REVIEW_REQUIRED';
    end if;
  end loop;
  return new;
end;
$$;

commit;
