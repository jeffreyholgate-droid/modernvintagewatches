-- Apply after the order and pricing migrations. Preserve existing published watches.
begin;
alter table public.items add column if not exists photo_review jsonb;

create or replace function public.mvw_guard_watch_gallery()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_reviewed_urls jsonb;
  v_source_urls jsonb;
  v_needs_review boolean;
begin
  if tg_op = 'UPDATE' then
    if new.image_urls is distinct from old.image_urls then
      new.photo_review := null;
      if new.publish_state = 'PUBLISHED' then new.publish_state := 'DRAFT'; end if;
    end if;
    v_needs_review := new.publish_state = 'PUBLISHED' and
      (old.publish_state is distinct from 'PUBLISHED' or new.photo_review is distinct from old.photo_review);
  else
    v_needs_review := new.publish_state = 'PUBLISHED';
  end if;
  if v_needs_review or new.photo_review is not null then
    if new.category is distinct from 'WATCH'
      or jsonb_typeof(new.photo_review) is distinct from 'array'
      or jsonb_typeof(new.image_urls) is distinct from 'array' then
      raise exception 'PHOTO_REVIEW_REQUIRED';
    end if;
    select jsonb_agg(src.url order by src.url) into v_source_urls from (
      select distinct url
      from jsonb_array_elements_text(new.image_urls) as source(url)
    ) src;
    select jsonb_agg(photo->>'url' order by photo->>'url') into v_reviewed_urls
      from jsonb_array_elements(new.photo_review) as reviewed(photo)
      where photo->>'url' ~ '^https://[^/@[:space:]]+'
        and length(photo->>'url') <= 2048
        and photo->>'tone' in ('original', 'soft-light', 'soft-highlights');
    if v_source_urls is null or v_reviewed_urls is distinct from v_source_urls
      or jsonb_array_length(new.photo_review) <> jsonb_array_length(v_source_urls) then
      raise exception 'PHOTO_REVIEW_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.mvw_guard_watch_gallery() from public, anon, authenticated;
drop trigger if exists mvw_watch_gallery_guard on public.items;
create trigger mvw_watch_gallery_guard
before insert or update on public.items
for each row execute function public.mvw_guard_watch_gallery();
commit;
