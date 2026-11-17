-- studywithducnh GĐ8. Chạy một lần trong SQL Editor bằng chủ project.
-- Mọi bảng riêng tư được bảo vệ bằng RLS. Chỉ các RPC dưới đây ghi dữ liệu đồng bộ.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null default '' check (char_length(display_name) <= 60),
  avatar_id text not null default 'moon' check (avatar_id in ('moon','sun','leaf','star','wave','book')),
  timezone text not null default 'Asia/Ho_Chi_Minh' check (char_length(timezone) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.create_profile_for_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name',''), 60))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created_studywithducnh on auth.users;
create trigger on_auth_user_created_studywithducnh after insert on auth.users
for each row execute function public.create_profile_for_auth_user();

create table if not exists public.records (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'task','subtask','subject','textbook','event','session','note','goal','exam',
    'settings','theme','scene','video','mood','sleep','mistake','question','journal',
    'schedule','priority','review','audio','rewards','weather','layout','scratch',
    'timer','thought','profile'
  )),
  entity_id text not null check (char_length(entity_id) between 1 and 160),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 262144),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, kind, entity_id)
);
create index if not exists records_user_cursor_idx on public.records(user_id, updated_at, id);
create index if not exists records_user_deleted_idx on public.records(user_id, deleted_at) where deleted_at is not null;

create or replace function public.stamp_record()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists records_stamp on public.records;
create trigger records_stamp before update on public.records
for each row execute function public.stamp_record();

create table if not exists public.operation_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  op_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, op_id)
);
create index if not exists operation_receipts_created_idx on public.operation_receipts(user_id, created_at);

create table if not exists public.record_revisions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('note','task','event')),
  entity_id text not null,
  version integer not null,
  payload jsonb not null,
  recorded_at timestamptz not null default now()
);
create index if not exists revisions_lookup_idx on public.record_revisions(user_id, kind, entity_id, recorded_at desc);

create table if not exists public.note_conflicts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  entity_id text not null,
  base_version integer not null,
  server_payload jsonb not null,
  incoming_patch jsonb not null,
  status text not null default 'open' check (status in ('open','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists conflicts_user_open_idx on public.note_conflicts(user_id, status, created_at desc);

create table if not exists public.snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  snapshot_date date not null,
  payload jsonb not null check (octet_length(payload::text) <= 1048576),
  created_at timestamptz not null default now(),
  primary key (user_id, snapshot_date)
);

alter table public.profiles enable row level security;
alter table public.records enable row level security;
alter table public.operation_receipts enable row level security;
alter table public.record_revisions enable row level security;
alter table public.note_conflicts enable row level security;
alter table public.snapshots enable row level security;

drop policy if exists profiles_own_select on public.profiles;
create policy profiles_own_select on public.profiles for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists profiles_own_insert on public.profiles;
create policy profiles_own_insert on public.profiles for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists profiles_own_update on public.profiles;
create policy profiles_own_update on public.profiles for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists records_own_select on public.records;
create policy records_own_select on public.records for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists receipts_own_select on public.operation_receipts;
create policy receipts_own_select on public.operation_receipts for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists revisions_own_select on public.record_revisions;
create policy revisions_own_select on public.record_revisions for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists conflicts_own_select on public.note_conflicts;
create policy conflicts_own_select on public.note_conflicts for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists snapshots_own_select on public.snapshots;
create policy snapshots_own_select on public.snapshots for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.records, public.operation_receipts, public.record_revisions,
  public.note_conflicts, public.snapshots from anon, authenticated;
grant select on public.records, public.operation_receipts, public.record_revisions,
  public.note_conflicts, public.snapshots to authenticated;
grant select, insert, update on public.profiles to authenticated;

create or replace function public.apply_record_change(
  p_op_id uuid, p_kind text, p_entity_id text, p_patch jsonb,
  p_base_version integer default 0, p_deleted boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_record public.records%rowtype;
  v_result jsonb;
  v_conflict_id bigint;
begin
  if v_user is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_op_id is null or p_kind is null or p_entity_id is null or
     char_length(p_entity_id) not between 1 and 160 or
     p_kind not in ('task','subtask','subject','textbook','event','session','note','goal','exam',
       'settings','theme','scene','video','mood','sleep','mistake','question','journal',
       'schedule','priority','review','audio','rewards','weather','layout','scratch','timer','thought','profile') or
     p_patch is null or jsonb_typeof(p_patch) <> 'object' or octet_length(p_patch::text) > 262144
  then raise exception 'Invalid record change' using errcode = '22023'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':' || p_kind || ':' || p_entity_id, 0));
  select result into v_result from public.operation_receipts where user_id = v_user and op_id = p_op_id;
  if found then return v_result; end if;
  select * into v_record from public.records
    where user_id = v_user and kind = p_kind and entity_id = p_entity_id for update;

  if not found then
    if p_deleted then
      v_result := pg_catalog.jsonb_build_object('status','ok','version',0,'deleted',true);
    else
      insert into public.records(user_id,kind,entity_id,payload)
      values (v_user,p_kind,p_entity_id,p_patch) returning * into v_record;
      v_result := pg_catalog.jsonb_build_object('status','ok','version',v_record.version,
        'updated_at',v_record.updated_at,'deleted',false);
    end if;
  elsif p_kind = 'note' and p_base_version <> v_record.version then
    insert into public.note_conflicts(user_id,entity_id,base_version,server_payload,incoming_patch)
    values (v_user,p_entity_id,p_base_version,v_record.payload,p_patch)
    returning id into v_conflict_id;
    v_result := pg_catalog.jsonb_build_object('status','conflict','conflict_id',v_conflict_id,
      'version',v_record.version,'server_payload',v_record.payload);
  else
    if p_kind in ('note','task','event') then
      insert into public.record_revisions(user_id,kind,entity_id,version,payload)
      values (v_user,p_kind,p_entity_id,v_record.version,v_record.payload);
      delete from public.record_revisions where id in (
        select id from public.record_revisions
        where user_id = v_user and kind = p_kind and entity_id = p_entity_id
          and recorded_at < now() - interval '90 days'
        order by recorded_at desc offset 50
      );
    end if;
    update public.records set payload = payload || p_patch,
      deleted_at = case when p_deleted then clock_timestamp() else null end
      where id = v_record.id returning * into v_record;
    v_result := pg_catalog.jsonb_build_object('status','ok','version',v_record.version,
      'updated_at',v_record.updated_at,'deleted',p_deleted);
  end if;
  insert into public.operation_receipts(user_id,op_id,result) values (v_user,p_op_id,v_result);
  return v_result;
end;
$$;

create or replace function public.purge_record(p_kind text, p_entity_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_record public.records%rowtype;
begin
  if v_user is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text || ':' || p_kind || ':' || p_entity_id, 0));
  select * into v_record from public.records where user_id = v_user and kind = p_kind
    and entity_id = p_entity_id for update;
  if found then
    if v_record.deleted_at is null then raise exception 'Record is not in trash' using errcode = '22023'; end if;
    delete from public.records where id = v_record.id;
    delete from public.record_revisions where user_id = v_user and kind = p_kind and entity_id = p_entity_id;
    delete from public.note_conflicts where user_id = v_user and entity_id = p_entity_id and p_kind = 'note';
  end if;
  return pg_catalog.jsonb_build_object('status','ok');
end;
$$;

create or replace function public.pull_records(p_after_at timestamptz default null,
  p_after_id bigint default 0, p_limit integer default 500)
returns setof public.records language sql stable security definer set search_path = '' as $$
  select r.* from public.records r
  where r.user_id = auth.uid()
    and (p_after_at is null or (r.updated_at, r.id) > (p_after_at, p_after_id))
  order by r.updated_at, r.id limit least(greatest(p_limit,1),500);
$$;

create or replace function public.resolve_note_conflict(
  p_conflict_id bigint, p_choice text, p_merged_payload jsonb default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_conflict public.note_conflicts%rowtype;
  v_record public.records%rowtype;
  v_payload jsonb;
begin
  if v_user is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select * into v_conflict from public.note_conflicts where id = p_conflict_id and user_id = v_user and status = 'open' for update;
  if not found then raise exception 'Conflict not found' using errcode = '22023'; end if;
  if p_choice not in ('server','local','merge') then raise exception 'Invalid choice' using errcode = '22023'; end if;
  if p_choice <> 'server' then
    select * into v_record from public.records where user_id = v_user and kind = 'note'
      and entity_id = v_conflict.entity_id for update;
    if not found then raise exception 'Note not found' using errcode = '22023'; end if;
    v_payload := case when p_merged_payload is not null then p_merged_payload
      else v_record.payload || v_conflict.incoming_patch end;
    if v_payload is null or jsonb_typeof(v_payload) <> 'object' or octet_length(v_payload::text) > 262144
      then raise exception 'Invalid merged note' using errcode = '22023'; end if;
    insert into public.record_revisions(user_id,kind,entity_id,version,payload)
      values (v_user,'note',v_record.entity_id,v_record.version,v_record.payload);
    update public.records set payload = v_payload, deleted_at = null where id = v_record.id;
  end if;
  update public.note_conflicts set status = 'resolved', resolved_at = clock_timestamp() where id = p_conflict_id;
  return pg_catalog.jsonb_build_object('status','ok');
end;
$$;

create or replace function public.capture_daily_snapshot()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_today date;
  v_payload jsonb;
begin
  if v_user is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  v_today := (now() at time zone 'UTC')::date;
  if exists (select 1 from public.snapshots where user_id = v_user and snapshot_date = v_today)
    then return pg_catalog.jsonb_build_object('status','exists'); end if;
  select pg_catalog.jsonb_build_object('records',coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('kind',kind,'entity_id',entity_id,'payload',payload,
      'version',version,'deleted_at',deleted_at)), '[]'::jsonb)) into v_payload
    from public.records where user_id = v_user;
  if octet_length(v_payload::text) > 1048576
    then return pg_catalog.jsonb_build_object('status','too_large'); end if;
  insert into public.snapshots(user_id,snapshot_date,payload) values (v_user,v_today,v_payload)
    on conflict do nothing;
  delete from public.snapshots where user_id = v_user and snapshot_date not in
    (select snapshot_date from public.snapshots where user_id = v_user order by snapshot_date desc limit 14);
  return pg_catalog.jsonb_build_object('status','saved');
end;
$$;

create or replace function public.delete_my_account(p_confirmation text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_username text;
begin
  if v_user is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select username into v_username from public.profiles where user_id = v_user;
  if v_username is null or p_confirmation <> 'DELETE ' || v_username
    then raise exception 'Confirmation does not match' using errcode = '22023'; end if;
  delete from auth.users where id = v_user;
  return found;
end;
$$;

revoke all on function public.create_profile_for_auth_user() from public, anon, authenticated;
revoke all on function public.apply_record_change(uuid,text,text,jsonb,integer,boolean) from public, anon;
revoke all on function public.pull_records(timestamptz,bigint,integer) from public, anon;
revoke all on function public.resolve_note_conflict(bigint,text,jsonb) from public, anon;
revoke all on function public.capture_daily_snapshot() from public, anon;
revoke all on function public.delete_my_account(text) from public, anon;
revoke all on function public.purge_record(text,text) from public, anon;
grant execute on function public.apply_record_change(uuid,text,text,jsonb,integer,boolean) to authenticated;
grant execute on function public.pull_records(timestamptz,bigint,integer) to authenticated;
grant execute on function public.resolve_note_conflict(bigint,text,jsonb) to authenticated;
grant execute on function public.capture_daily_snapshot() to authenticated;
grant execute on function public.delete_my_account(text) to authenticated;
grant execute on function public.purge_record(text,text) to authenticated;

-- Realtime: chỉ record riêng của chủ sở hữu, RLS vẫn áp dụng khi phát thay đổi.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'records') then
    alter publication supabase_realtime add table public.records;
  end if;
end $$;
