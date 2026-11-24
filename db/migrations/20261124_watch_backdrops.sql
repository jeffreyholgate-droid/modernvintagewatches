-- Apply after 20261124_watch_photos.sql. Existing gallery records remain readable.
begin;
create or replace function public.mvw_valid_watch_mask(p_mask jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_outline jsonb;
  v_point jsonb;
  v_dimension jsonb;
  v_coordinate jsonb;
  v_value numeric;
  v_first jsonb;
  v_previous jsonb;
  v_area integer;
begin
  if jsonb_typeof(p_mask) is distinct from 'object'
    or jsonb_typeof(p_mask->'outlines') is distinct from 'array' then return false; end if;
  foreach v_dimension in array array[p_mask->'width', p_mask->'height'] loop
    if jsonb_typeof(v_dimension) is distinct from 'number' then return false; end if;
    v_value := (v_dimension #>> '{}')::numeric;
    if v_value < 1 or v_value > 16000 or trunc(v_value) <> v_value then return false; end if;
  end loop;
  if jsonb_array_length(p_mask->'outlines') not between 1 and 8 then return false; end if;
  for v_outline in select value from jsonb_array_elements(p_mask->'outlines') loop
    if jsonb_typeof(v_outline) is distinct from 'array' then return false; end if;
    if jsonb_array_length(v_outline) not between 3 and 160 then return false; end if;
    v_first := v_outline->0;
    v_previous := null;
    v_area := 0;
    for v_point in select value from jsonb_array_elements(v_outline) loop
      if jsonb_typeof(v_point) is distinct from 'array' then return false; end if;
      if jsonb_array_length(v_point) <> 2 then return false; end if;
      for v_coordinate in select value from jsonb_array_elements(v_point) loop
        if jsonb_typeof(v_coordinate) is distinct from 'number' then return false; end if;
        v_value := (v_coordinate #>> '{}')::numeric;
        if v_value < 0 or v_value > 1000 or trunc(v_value) <> v_value then return false; end if;
      end loop;
      if v_previous is not null then
        v_area := v_area + (v_previous->>0)::numeric * (v_point->>1)::numeric
          - (v_point->>0)::numeric * (v_previous->>1)::numeric;
      end if;
      v_previous := v_point;
    end loop;
    v_area := v_area + (v_previous->>0)::numeric * (v_first->>1)::numeric
      - (v_first->>0)::numeric * (v_previous->>1)::numeric;
    if abs(v_area) < 16 then return false; end if;
  end loop;
  return true;
end;
$$;

create or replace function public.mvw_guard_watch_backdrop()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.publish_state is distinct from 'PUBLISHED' then return new; end if;
  if tg_op = 'UPDATE' then
    if old.publish_state = 'PUBLISHED' and new.photo_review is not distinct from old.photo_review then
      return new;
    end if;
  end if;
  if jsonb_typeof(new.photo_review) is distinct from 'array' then
    raise exception 'PHOTO_BACKDROP_REQUIRED';
  end if;
  if jsonb_array_length(new.photo_review) = 0 or exists (
    select 1 from jsonb_array_elements(new.photo_review) as photo(value)
    where not public.mvw_valid_watch_mask(photo.value->'mask')
  ) then
    raise exception 'PHOTO_BACKDROP_REQUIRED';
  end if;
  return new;
end;
$$;

-- PostgreSQL invokes before triggers by name. Run after mvw_watch_gallery_guard
-- has cleared the review and returned changed source images to draft.
drop trigger if exists mvw_watch_studio_guard on public.items;
create trigger mvw_watch_studio_guard before insert or update on public.items
for each row execute function public.mvw_guard_watch_backdrop();
revoke all on function public.mvw_guard_watch_backdrop() from public, anon, authenticated;
revoke all on function public.mvw_valid_watch_mask(jsonb) from public, anon, authenticated;
grant execute on function public.mvw_valid_watch_mask(jsonb) to service_role;
commit;
