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

-- GĐ9–10: thêm vào cuối schema.sql. Chạy bằng SQL Editor của project owner.
alter table public.profiles add column if not exists share_minutes boolean not null default false;
alter table public.profiles add column if not exists share_status boolean not null default false;
alter table public.profiles add column if not exists hide_presence boolean not null default false;
alter table public.profiles add column if not exists notification_preferences jsonb not null default '{"friend":true,"squad":true,"room":true,"streak":true}'::jsonb;
alter table public.profiles add column if not exists quiet_start time;
alter table public.profiles add column if not exists quiet_end time;
alter table public.profiles add column if not exists community_accepted_at timestamptz;

create table if not exists public.friend_requests(
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check(status in('pending','accepted','rejected','cancelled')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check(sender_id<>recipient_id), unique(sender_id,recipient_id)
);
create index if not exists friend_requests_recipient_idx on public.friend_requests(recipient_id,status,created_at desc);
create table if not exists public.friendships(
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_a,user_b), check(user_a<user_b)
);
create table if not exists public.user_blocks(
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker_id,blocked_id), check(blocker_id<>blocked_id)
);
create table if not exists public.notifications(
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check(kind in('friend','squad','room','streak','reminder')),
  title text not null check(char_length(title)<=100),
  body text not null default '' check(char_length(body)<=300),
  target_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notifications_user_idx on public.notifications(user_id,created_at desc);

create table if not exists public.focus_sessions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  planned_end_at timestamptz not null,
  ended_at timestamptz,
  room_id uuid,
  check(planned_end_at>started_at and planned_end_at<=started_at+interval '4 hours'),
  check(ended_at is null or ended_at>=started_at)
);
create index if not exists focus_sessions_user_day_idx on public.focus_sessions(user_id,started_at);
create unique index if not exists focus_one_open_idx on public.focus_sessions(user_id) where ended_at is null;

create table if not exists public.squads(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check(char_length(name) between 3 and 60),
  avatar_id text not null default 'star' check(avatar_id in('moon','sun','leaf','star','wave','book')),
  invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
  timezone text not null default 'Asia/Ho_Chi_Minh' check(char_length(timezone) between 1 and 80),
  threshold_percent integer not null default 100 check(threshold_percent in(50,70,100)),
  min_focus_minutes integer not null default 25 check(min_focus_minutes between 5 and 180),
  leaderboard_enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.squad_members(
  squad_id uuid not null references public.squads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check(role in('admin','member')),
  joined_at timestamptz not null default now(),
  last_reminded_at timestamptz,
  primary key(squad_id,user_id)
);
create index if not exists squad_members_user_idx on public.squad_members(user_id);
create table if not exists public.squad_shields(
  squad_id uuid not null references public.squads(id) on delete cascade,
  week_start date not null,
  protected_day date not null,
  used_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(squad_id,week_start)
);
create table if not exists public.squad_rest_days(
 squad_id uuid not null references public.squads(id) on delete cascade,
 rest_day date not null,
 planned_by uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(squad_id,rest_day)
);
create table if not exists public.squad_challenges(
  id uuid primary key default gen_random_uuid(),
  squad_id uuid not null references public.squads(id) on delete cascade,
  title text not null check(char_length(title) between 3 and 100),
  target_minutes integer not null check(target_minutes between 25 and 30000),
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  check(ends_on>=starts_on and ends_on<=starts_on+interval '31 days')
);

alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.user_blocks enable row level security;
alter table public.notifications enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.squads enable row level security;
alter table public.squad_members enable row level security;
alter table public.squad_shields enable row level security;
alter table public.squad_rest_days enable row level security;
alter table public.squad_challenges enable row level security;

create or replace function public.is_squad_member(p_squad uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(
    select 1 from public.squad_members where squad_id=p_squad and user_id=auth.uid());
$$;
create policy friend_requests_participant on public.friend_requests for select to authenticated
  using(auth.uid() in(sender_id,recipient_id));
create policy friendships_participant on public.friendships for select to authenticated
  using(auth.uid() in(user_a,user_b));
create policy blocks_owner on public.user_blocks for select to authenticated using(auth.uid()=blocker_id);
create policy notifications_owner on public.notifications for select to authenticated using(auth.uid()=user_id);
create policy focus_owner on public.focus_sessions for select to authenticated using(auth.uid()=user_id);
create policy squads_member on public.squads for select to authenticated using(public.is_squad_member(id));
create policy squad_members_member on public.squad_members for select to authenticated
  using(public.is_squad_member(squad_id));
create policy shields_member on public.squad_shields for select to authenticated
  using(public.is_squad_member(squad_id));
create policy rest_days_member on public.squad_rest_days for select to authenticated
  using(public.is_squad_member(squad_id));
create policy challenges_member on public.squad_challenges for select to authenticated
  using(public.is_squad_member(squad_id));

revoke all on public.friend_requests,public.friendships,public.user_blocks,public.notifications,
 public.focus_sessions,public.squads,public.squad_members,public.squad_shields,public.squad_rest_days,public.squad_challenges
 from anon,authenticated;
grant select on public.friend_requests,public.friendships,public.user_blocks,public.notifications,
 public.focus_sessions,public.squads,public.squad_members,public.squad_shields,public.squad_rest_days,public.squad_challenges
 to authenticated;

create or replace function public.find_people(p_query text)
returns table(user_id uuid,username text,avatar_id text)
language sql stable security definer set search_path='' as $$
  select p.user_id,p.username,p.avatar_id from public.profiles p
  where auth.uid() is not null and p.user_id<>auth.uid()
    and char_length(p_query) between 3 and 20 and p.username like lower(p_query)||'%'
    and not exists(select 1 from public.user_blocks b where
      (b.blocker_id=auth.uid() and b.blocked_id=p.user_id) or
      (b.blocker_id=p.user_id and b.blocked_id=auth.uid()))
  order by p.username limit 20;
$$;

create or replace function public.friend_action(p_target uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_a uuid; v_b uuid; v_request public.friend_requests%rowtype;
begin
 if v_user is null or p_target is null or v_user=p_target then raise exception 'Invalid friend target' using errcode='22023'; end if;
 v_a:=least(v_user,p_target);v_b:=greatest(v_user,p_target);
 if p_action='block' then
   insert into public.user_blocks(blocker_id,blocked_id) values(v_user,p_target) on conflict do nothing;
   delete from public.friendships where user_a=v_a and user_b=v_b;
   update public.friend_requests set status='cancelled',responded_at=now()
     where status='pending' and ((sender_id=v_user and recipient_id=p_target) or (sender_id=p_target and recipient_id=v_user));
 elsif p_action='unblock' then
   delete from public.user_blocks where blocker_id=v_user and blocked_id=p_target;
 elsif p_action='remove' then
   delete from public.friendships where user_a=v_a and user_b=v_b;
 elsif p_action='request' then
   if not exists(select 1 from public.profiles where user_id=p_target) or
     exists(select 1 from public.user_blocks where
       (blocker_id=v_user and blocked_id=p_target) or (blocker_id=p_target and blocked_id=v_user))
     then raise exception 'User unavailable' using errcode='22023'; end if;
   if (select count(*) from public.friend_requests where sender_id=v_user and created_at>now()-interval '1 day')>=20
     then raise exception 'Daily invite limit reached' using errcode='22023'; end if;
   if exists(select 1 from public.friendships where user_a=v_a and user_b=v_b)
     then raise exception 'Already friends' using errcode='22023'; end if;
   insert into public.friend_requests(sender_id,recipient_id,status,created_at,responded_at)
     values(v_user,p_target,'pending',now(),null)
     on conflict(sender_id,recipient_id) do update set status='pending',created_at=now(),responded_at=null;
   insert into public.notifications(user_id,kind,title,body)
     values(p_target,'friend','Lời mời kết bạn','Có một lời mời kết bạn mới.');
 elsif p_action in('accept','reject') then
   select * into v_request from public.friend_requests where sender_id=p_target and recipient_id=v_user
     and status='pending' for update;
   if not found then raise exception 'Invite not found' using errcode='22023'; end if;
   update public.friend_requests set status=case when p_action='accept' then 'accepted' else 'rejected' end,
     responded_at=now() where id=v_request.id;
   if p_action='accept' then
     insert into public.friendships(user_a,user_b) values(v_a,v_b) on conflict do nothing;
   end if;
 elsif p_action='cancel' then
   update public.friend_requests set status='cancelled',responded_at=now()
     where sender_id=v_user and recipient_id=p_target and status='pending';
 else raise exception 'Invalid friend action' using errcode='22023'; end if;
 return jsonb_build_object('status','ok');
end;
$$;

create or replace function public.focus_start(p_minutes integer,p_room uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_id uuid;v_today_minutes integer;
begin
 if v_user is null or p_minutes not between 1 and 240 or
   (p_room is not null and not public.is_room_member(p_room))
   then raise exception 'Invalid focus duration or room' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text,42));
 update public.focus_sessions set ended_at=started_at where user_id=v_user
   and ended_at is null and planned_end_at<=now();
 if exists(select 1 from public.focus_sessions where user_id=v_user and ended_at is null)
   then raise exception 'Focus already running' using errcode='22023'; end if;
 select coalesce(sum(floor(extract(epoch from least(ended_at,planned_end_at)-started_at)/60)),0)::integer
 into v_today_minutes from public.focus_sessions where user_id=v_user and ended_at is not null
   and started_at::date=(now() at time zone 'UTC')::date;
 if v_today_minutes+p_minutes>720 then raise exception 'Daily verified focus limit reached' using errcode='22023'; end if;
 insert into public.focus_sessions(user_id,planned_end_at,room_id)
 values(v_user,now()+make_interval(mins=>p_minutes),p_room) returning id into v_id;
 return v_id;
end;
$$;
create or replace function public.focus_stop(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_row public.focus_sessions%rowtype;v_minutes integer;
begin
 if v_user is null then raise exception 'Not authenticated' using errcode='28000'; end if;
 select * into v_row from public.focus_sessions where id=p_id and user_id=v_user for update;
 if not found then raise exception 'Focus session not found' using errcode='22023'; end if;
 if v_row.ended_at is null then
   update public.focus_sessions set ended_at=least(now(),planned_end_at) where id=p_id returning * into v_row;
 end if;
 v_minutes:=greatest(0,floor(extract(epoch from least(v_row.ended_at,v_row.planned_end_at)-v_row.started_at)/60))::integer;
 return jsonb_build_object('status','ok','minutes',v_minutes,'started_at',v_row.started_at,'ended_at',v_row.ended_at);
end;
$$;
create or replace function public.focus_abandon(p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Not authenticated' using errcode='28000'; end if;
 update public.focus_sessions set ended_at=started_at where id=p_id and user_id=auth.uid()
   and ended_at is null;
 return found;
end;
$$;

create or replace function public.create_squad(p_name text,p_avatar text,p_timezone text)
returns public.squads language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_squad public.squads%rowtype;
begin
 if v_user is null or char_length(trim(p_name)) not between 3 and 60 or
   p_avatar not in('moon','sun','leaf','star','wave','book') or
   p_timezone not in(select name from pg_catalog.pg_timezone_names)
   then raise exception 'Invalid squad details' using errcode='22023'; end if;
 if (select count(*) from public.squads where owner_id=v_user and created_at>now()-interval '1 day')>=3
   then raise exception 'Daily squad limit reached' using errcode='22023'; end if;
 insert into public.squads(owner_id,name,avatar_id,timezone) values(v_user,trim(p_name),p_avatar,p_timezone)
 returning * into v_squad;
 insert into public.squad_members(squad_id,user_id,role) values(v_squad.id,v_user,'admin');
 return v_squad;
end;
$$;
create or replace function public.join_squad(p_code text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_squad public.squads%rowtype;
begin
 if v_user is null then raise exception 'Not authenticated' using errcode='28000'; end if;
 select * into v_squad from public.squads where invite_code=upper(trim(p_code)) for update;
 if not found then raise exception 'Squad code not found' using errcode='22023'; end if;
  if exists(select 1 from public.squad_members where squad_id=v_squad.id and user_id=v_user)
    then return v_squad.id; end if;
 if (select count(*) from public.squad_members where squad_id=v_squad.id)>=10
   then raise exception 'Squad is full' using errcode='22023'; end if;
 insert into public.squad_members(squad_id,user_id) values(v_squad.id,v_user) on conflict do nothing;
 insert into public.notifications(user_id,kind,title,body,target_id)
   values(v_squad.owner_id,'squad','Thành viên mới', 'Có người vừa vào Squad.',v_squad.id);
 return v_squad.id;
end;
$$;
create or replace function public.squad_action(p_squad uuid,p_action text,p_target uuid default null,
 p_value text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_squad public.squads%rowtype;v_role text;v_week date;
begin
 if v_user is null or not public.is_squad_member(p_squad) then raise exception 'Not a squad member' using errcode='42501'; end if;
 select * into v_squad from public.squads where id=p_squad for update;
 select role into v_role from public.squad_members where squad_id=p_squad and user_id=v_user;
 if p_action='leave' then
   if v_squad.owner_id=v_user and (select count(*) from public.squad_members where squad_id=p_squad)>1
     then raise exception 'Transfer admin before leaving' using errcode='22023'; end if;
   if v_squad.owner_id=v_user then delete from public.squads where id=p_squad;
   else delete from public.squad_members where squad_id=p_squad and user_id=v_user; end if;
 elsif p_action='remind' then
   if p_target is null or p_target=v_user or not exists(select 1 from public.squad_members where squad_id=p_squad and user_id=p_target)
     then raise exception 'Invalid reminder target' using errcode='22023'; end if;
   if exists(select 1 from public.squad_members where squad_id=p_squad and user_id=v_user
     and last_reminded_at>now()-interval '1 hour') then raise exception 'Wait one hour before another reminder' using errcode='22023'; end if;
   update public.squad_members set last_reminded_at=now() where squad_id=p_squad and user_id=v_user;
   insert into public.notifications(user_id,kind,title,body,target_id)
     values(p_target,'reminder','Nhắc học cùng Squad','Bạn có một lời nhắc nhẹ từ Squad.',p_squad);
 elsif p_action='shield' then
   v_week:=date_trunc('week',(now() at time zone v_squad.timezone))::date;
   if coalesce(p_value::date,(now() at time zone v_squad.timezone)::date) not between v_week and v_week+6
     then raise exception 'Shield day must be this week' using errcode='22023'; end if;
   insert into public.squad_shields(squad_id,week_start,protected_day,used_by)
     values(p_squad,v_week,coalesce(p_value::date,(now() at time zone v_squad.timezone)::date),v_user);
 elsif p_action in('kick','promote','threshold','minutes','leaderboard','name','rest') then
   if v_role<>'admin' then raise exception 'Admin required' using errcode='42501'; end if;
   if p_action='kick' then
     if p_target is null or p_target=v_squad.owner_id then raise exception 'Cannot kick owner' using errcode='22023'; end if;
     delete from public.squad_members where squad_id=p_squad and user_id=p_target;
   elsif p_action='promote' then
     if p_target is null or not exists(select 1 from public.squad_members where squad_id=p_squad and user_id=p_target)
       then raise exception 'Member not found' using errcode='22023'; end if;
     update public.squad_members set role='admin' where squad_id=p_squad and user_id=p_target;
     update public.squads set owner_id=p_target where id=p_squad;
   elsif p_action='threshold' then
     if p_value::integer not in(50,70,100) then raise exception 'Invalid threshold' using errcode='22023'; end if;
     update public.squads set threshold_percent=p_value::integer where id=p_squad;
   elsif p_action='minutes' then
     if p_value::integer not between 5 and 180 then raise exception 'Invalid minutes' using errcode='22023'; end if;
     update public.squads set min_focus_minutes=p_value::integer where id=p_squad;
   elsif p_action='leaderboard' then
     update public.squads set leaderboard_enabled=p_value::boolean where id=p_squad;
   elsif p_action='name' then
     if char_length(trim(p_value)) not between 3 and 60 then raise exception 'Invalid name' using errcode='22023'; end if;
     update public.squads set name=trim(p_value) where id=p_squad;
   elsif p_action='rest' then
     if p_value::date<(now() at time zone v_squad.timezone)::date or
       p_value::date>(now() at time zone v_squad.timezone)::date+30
       then raise exception 'Plan rest day in the next 30 days' using errcode='22023'; end if;
     insert into public.squad_rest_days(squad_id,rest_day,planned_by)
       values(p_squad,p_value::date,v_user) on conflict do nothing;
   end if;
 else raise exception 'Invalid squad action' using errcode='22023'; end if;
 return jsonb_build_object('status','ok');
end;
$$;

create or replace function public.squad_day(p_squad uuid,p_day date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_squad public.squads%rowtype;v_members jsonb;v_total integer;v_achieved integer;v_shield boolean;v_rest boolean;
begin
 if auth.uid() is null or not public.is_squad_member(p_squad) then raise exception 'Not a squad member' using errcode='42501'; end if;
 select * into v_squad from public.squads where id=p_squad;
 if p_day is null or p_day>(now() at time zone v_squad.timezone)::date or
   p_day<(now() at time zone v_squad.timezone)::date-365 then raise exception 'Invalid day' using errcode='22023'; end if;
  select count(*),count(*) filter(where t.minutes>=v_squad.min_focus_minutes),
   jsonb_agg(jsonb_build_object('user_id',m.user_id,'username',p.username,'avatar_id',p.avatar_id,'role',m.role,
      'achieved',t.minutes>=v_squad.min_focus_minutes,'minutes',
        case when p.share_minutes and v_squad.leaderboard_enabled then t.minutes else null end)
     order by p.username)
 into v_total,v_achieved,v_members from public.squad_members m
 join public.profiles p on p.user_id=m.user_id
 cross join lateral (select coalesce(sum(greatest(0,floor(extract(epoch from
   least(f.ended_at,f.planned_end_at)-f.started_at)/60))),0)::integer as minutes
   from public.focus_sessions f where f.user_id=m.user_id and f.ended_at is not null
   and (f.started_at at time zone v_squad.timezone)::date=p_day) t
 where m.squad_id=p_squad;
 select exists(select 1 from public.squad_shields where squad_id=p_squad and protected_day=p_day)
 into v_shield;
 select exists(select 1 from public.squad_rest_days where squad_id=p_squad and rest_day=p_day)
 into v_rest;
 return jsonb_build_object('day',p_day,'members',coalesce(v_members,'[]'::jsonb),
   'qualified',v_rest or v_shield or (v_total>=2 and v_achieved*100>=v_total*v_squad.threshold_percent),
   'shield',v_shield,'rest',v_rest,'achieved',v_achieved,'total',v_total);
end;
$$;
create or replace function public.squad_history(p_squad uuid,p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_today date;v_zone text;v_result jsonb;
begin
 if auth.uid() is null or not public.is_squad_member(p_squad) then raise exception 'Not a squad member' using errcode='42501'; end if;
 select timezone into v_zone from public.squads where id=p_squad;
 v_today:=(now() at time zone v_zone)::date;
 select coalesce(jsonb_agg(public.squad_day(p_squad,d.day::date) order by d.day desc),'[]'::jsonb)
 into v_result from generate_series(v_today-least(greatest(p_days,1),90)+1,v_today,interval '1 day') d(day);
 return v_result;
end;
$$;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create table if not exists public.rooms(
 id uuid primary key default gen_random_uuid(),
 host_id uuid not null references auth.users(id) on delete cascade,
 squad_id uuid references public.squads(id) on delete set null,
 name text not null check(char_length(name) between 3 and 80),
 visibility text not null default 'public' check(visibility in('public','private','squad')),
 invite_code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
 password_hash text,
 subject text not null default '' check(char_length(subject)<=60),
 language text not null default 'vi' check(language in('vi','en')),
 rules text not null default '' check(char_length(rules)<=500),
 max_members integer not null default 10 check(max_members between 2 and 20),
 status text not null default 'open' check(status in('open','locked','closed')),
 chat_enabled boolean not null default true,
 scene jsonb not null default '{}'::jsonb check(octet_length(scene::text)<=2048),
 timer_started_at timestamptz,
 timer_minutes integer check(timer_minutes between 1 and 240),
 timer_mode text not null default 'individual' check(timer_mode in('individual','shared')),
 music_video_id text check(music_video_id ~ '^[A-Za-z0-9_-]{11}$'),
 music_position integer not null default 0 check(music_position>=0),
 music_playing boolean not null default false,
 music_updated_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 last_empty_at timestamptz,
 check(visibility<>'squad' or squad_id is not null)
);
create index if not exists rooms_directory_idx on public.rooms(visibility,status,created_at desc);
create table if not exists public.room_members(
 room_id uuid not null references public.rooms(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null default 'member' check(role in('host','moderator','member')),
 active boolean not null default true,
 joined_at timestamptz not null default now(),
 left_at timestamptz,
 muted_until timestamptz,
 commitment text not null default '' check(char_length(commitment)<=140),
 checkin text check(checkin in('done','partial','missed')),
 primary key(room_id,user_id)
);
create index if not exists room_members_user_idx on public.room_members(user_id,active);
create table if not exists public.room_bans(
 room_id uuid not null references public.rooms(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 banned_by uuid not null references auth.users(id) on delete cascade,
 reason text not null default '' check(char_length(reason)<=200),
 created_at timestamptz not null default now(),
 primary key(room_id,user_id)
);
create table if not exists public.room_messages(
 id bigint generated always as identity primary key,
 room_id uuid not null references public.rooms(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 parent_id bigint references public.room_messages(id) on delete set null,
 body text not null check(char_length(body) between 1 and 500),
 created_at timestamptz not null default now(),
 deleted_at timestamptz
);
create index if not exists room_messages_recent_idx on public.room_messages(room_id,created_at desc);
create table if not exists public.room_message_reactions(
 message_id bigint not null references public.room_messages(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 emoji text not null check(emoji in('👍','❤️','✨','👏','🔥')),
 primary key(message_id,user_id,emoji)
);
create table if not exists public.room_banned_words(
 room_id uuid not null references public.rooms(id) on delete cascade,
 word text not null check(char_length(word) between 2 and 40),
 primary key(room_id,word)
);
create table if not exists public.room_reports(
 id bigint generated always as identity primary key,
 room_id uuid not null references public.rooms(id) on delete cascade,
 reporter_id uuid not null references auth.users(id) on delete cascade,
 target_user_id uuid references auth.users(id) on delete set null,
 message_id bigint references public.room_messages(id) on delete set null,
 reason text not null check(char_length(reason) between 5 and 500),
 created_at timestamptz not null default now()
);
create table if not exists public.room_favorites(
 room_id uuid not null references public.rooms(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 primary key(room_id,user_id)
);
create table if not exists public.room_events(
 id uuid primary key default gen_random_uuid(),
 room_id uuid references public.rooms(id) on delete set null,
 creator_id uuid not null references auth.users(id) on delete cascade,
 squad_id uuid references public.squads(id) on delete set null,
 title text not null check(char_length(title) between 3 and 100),
 starts_at timestamptz not null,
 created_at timestamptz not null default now(),
 check(starts_at>created_at-interval '1 day' and starts_at<created_at+interval '1 year')
);
create table if not exists public.room_event_rsvps(
 event_id uuid not null references public.room_events(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 response text not null default 'invited' check(response in('invited','yes','no','maybe')),
 responded_at timestamptz,
 primary key(event_id,user_id)
);

alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.room_bans enable row level security;
alter table public.room_messages enable row level security;
alter table public.room_message_reactions enable row level security;
alter table public.room_banned_words enable row level security;
alter table public.room_reports enable row level security;
alter table public.room_favorites enable row level security;
alter table public.room_events enable row level security;
alter table public.room_event_rsvps enable row level security;

create or replace function public.is_room_member(p_room uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.room_members
   where room_id=p_room and user_id=auth.uid() and active=true)
   and not exists(select 1 from public.room_bans where room_id=p_room and user_id=auth.uid());
$$;
create or replace function public.can_manage_room(p_room uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select public.is_room_member(p_room) and exists(select 1 from public.room_members
   where room_id=p_room and user_id=auth.uid() and role in('host','moderator'));
$$;
create policy rooms_visible on public.rooms for select to authenticated
 using((visibility='public' and status<>'closed') or public.is_room_member(id));
create policy room_members_visible on public.room_members for select to authenticated
 using(public.is_room_member(room_id));
create policy room_bans_visible on public.room_bans for select to authenticated
 using(public.can_manage_room(room_id) or user_id=auth.uid());
create policy room_messages_visible on public.room_messages for select to authenticated
 using(public.is_room_member(room_id));
create policy room_reactions_visible on public.room_message_reactions for select to authenticated
 using(exists(select 1 from public.room_messages m where m.id=message_id and public.is_room_member(m.room_id)));
create policy room_words_visible on public.room_banned_words for select to authenticated
 using(public.can_manage_room(room_id));
create policy room_reports_own on public.room_reports for select to authenticated
 using(reporter_id=auth.uid() or public.can_manage_room(room_id));
create policy room_favorites_own on public.room_favorites for select to authenticated
 using(user_id=auth.uid());
create policy room_events_visible on public.room_events for select to authenticated
 using(creator_id=auth.uid() or public.is_squad_member(squad_id) or
   exists(select 1 from public.room_event_rsvps r where r.event_id=id and r.user_id=auth.uid()));
create policy room_rsvps_visible on public.room_event_rsvps for select to authenticated
 using(user_id=auth.uid() or exists(select 1 from public.room_events e where e.id=event_id and e.creator_id=auth.uid()));

revoke all on public.rooms,public.room_members,public.room_bans,public.room_messages,
 public.room_message_reactions,public.room_banned_words,public.room_reports,
 public.room_favorites,public.room_events,public.room_event_rsvps from anon,authenticated;
grant select on public.room_members,public.room_bans,public.room_messages,
 public.room_message_reactions,public.room_banned_words,public.room_reports,
 public.room_favorites,public.room_events,public.room_event_rsvps to authenticated;
grant select(id,host_id,squad_id,name,visibility,invite_code,subject,language,rules,max_members,
 status,chat_enabled,scene,timer_started_at,timer_minutes,timer_mode,music_video_id,
 music_position,music_playing,music_updated_at,created_at,updated_at,last_empty_at)
 on public.rooms to authenticated;

create or replace function public.create_room(p_name text,p_visibility text,p_squad uuid,
 p_password text,p_capacity integer,p_subject text,p_language text,p_rules text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_room uuid;
begin
 if v_user is null or not exists(select 1 from public.profiles where user_id=v_user and community_accepted_at is not null)
   then raise exception 'Community rules acceptance required' using errcode='42501'; end if;
 if char_length(trim(p_name)) not between 3 and 80 or p_visibility not in('public','private','squad')
   or p_capacity not between 2 and 20 or char_length(coalesce(p_subject,''))>60
   or p_language not in('vi','en') or char_length(coalesce(p_rules,''))>500
   then raise exception 'Invalid room details' using errcode='22023'; end if;
 if p_visibility='squad' and (p_squad is null or not public.is_squad_member(p_squad))
   then raise exception 'Squad membership required' using errcode='42501'; end if;
 if p_password is not null and p_password<>'' and char_length(p_password) not between 6 and 72
   then raise exception 'Password must be 6–72 characters' using errcode='22023'; end if;
 if (select count(*) from public.rooms where host_id=v_user and created_at>now()-interval '1 day')>=5
   then raise exception 'Daily room limit reached' using errcode='22023'; end if;
 insert into public.rooms(host_id,squad_id,name,visibility,password_hash,max_members,subject,language,rules)
 values(v_user,case when p_visibility='squad' then p_squad else null end,trim(p_name),p_visibility,
   case when coalesce(p_password,'')<>'' then extensions.crypt(p_password,extensions.gen_salt('bf')) else null end,
   p_capacity,coalesce(p_subject,''),p_language,coalesce(p_rules,'')) returning id into v_room;
 insert into public.room_members(room_id,user_id,role) values(v_room,v_user,'host');
 return v_room;
end;
$$;
create or replace function public.join_room(p_room uuid,p_code text default null,p_password text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_room public.rooms%rowtype;
begin
 if v_user is null then raise exception 'Not authenticated' using errcode='28000'; end if;
 select * into v_room from public.rooms where id=p_room for update;
 if not found or v_room.status<>'open' then raise exception 'Room unavailable' using errcode='22023'; end if;
 if v_room.visibility='private' and upper(coalesce(trim(p_code),''))<>v_room.invite_code
   and not exists(select 1 from public.room_members where room_id=p_room and user_id=v_user)
   then raise exception 'Invalid room code' using errcode='42501'; end if;
 if v_room.visibility='squad' and not public.is_squad_member(v_room.squad_id)
   then raise exception 'Squad membership required' using errcode='42501'; end if;
 if v_room.password_hash is not null and v_room.password_hash<>extensions.crypt(coalesce(p_password,''),v_room.password_hash)
   then raise exception 'Invalid room password' using errcode='42501'; end if;
 if exists(select 1 from public.room_bans where room_id=p_room and user_id=v_user)
   then raise exception 'You are banned from this room' using errcode='42501'; end if;
 if (select count(*) from public.room_members where room_id=p_room and active)>=v_room.max_members
   and not exists(select 1 from public.room_members where room_id=p_room and user_id=v_user and active)
   then raise exception 'Room is full' using errcode='22023'; end if;
 insert into public.room_members(room_id,user_id,role,active,joined_at,left_at)
 values(p_room,v_user,'member',true,now(),null)
 on conflict(room_id,user_id) do update set active=true,joined_at=now(),left_at=null;
 update public.rooms set last_empty_at=null,updated_at=now() where id=p_room;
 if v_room.host_id<>v_user then
   insert into public.notifications(user_id,kind,title,body,target_id)
   values(v_room.host_id,'room','Có người vào phòng','Một bạn vừa vào phòng học.',p_room);
 end if;
 return jsonb_build_object('status','ok');
end;
$$;
create or replace function public.leave_room(p_room uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_next uuid;
begin
 if v_user is null then raise exception 'Not authenticated' using errcode='28000'; end if;
 update public.room_members set active=false,left_at=now() where room_id=p_room and user_id=v_user;
 if not found then raise exception 'Not in room' using errcode='22023'; end if;
 if exists(select 1 from public.rooms where id=p_room and host_id=v_user) then
   select user_id into v_next from public.room_members where room_id=p_room and active
   order by case role when 'moderator' then 0 else 1 end,joined_at limit 1;
   if v_next is not null then
     update public.room_members set role='host' where room_id=p_room and user_id=v_next;
     update public.rooms set host_id=v_next,updated_at=now() where id=p_room;
   end if;
 end if;
 if not exists(select 1 from public.room_members where room_id=p_room and active)
   then update public.rooms set last_empty_at=now(),updated_at=now() where id=p_room; end if;
 return jsonb_build_object('status','ok');
end;
$$;
create or replace function public.room_action(p_room uuid,p_action text,p_target uuid default null,
 p_value text default null,p_extra jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_role text;v_room public.rooms%rowtype;
begin
 if v_user is null or not public.can_manage_room(p_room) then raise exception 'Moderator required' using errcode='42501'; end if;
 select role into v_role from public.room_members where room_id=p_room and user_id=v_user;
 select * into v_room from public.rooms where id=p_room for update;
 if p_action in('kick','mute','ban','promote','host') then
     if p_target is null or p_target=v_user or not exists(select 1 from public.room_members where room_id=p_room and user_id=p_target and active)
     then raise exception 'Invalid member' using errcode='22023'; end if;
   if exists(select 1 from public.room_members where room_id=p_room and user_id=p_target and role='host')
     then raise exception 'Cannot moderate host' using errcode='42501'; end if;
   if p_action in('promote','host','ban') and v_role<>'host' then raise exception 'Host required' using errcode='42501'; end if;
   if p_action='kick' then update public.room_members set active=false,left_at=now() where room_id=p_room and user_id=p_target;
   elsif p_action='mute' then update public.room_members set muted_until=now()+interval '1 hour' where room_id=p_room and user_id=p_target;
   elsif p_action='ban' then
     insert into public.room_bans(room_id,user_id,banned_by,reason)
       values(p_room,p_target,v_user,left(coalesce(p_value,''),200)) on conflict do nothing;
     update public.room_members set active=false,left_at=now() where room_id=p_room and user_id=p_target;
   elsif p_action='promote' then update public.room_members set role='moderator' where room_id=p_room and user_id=p_target;
   elsif p_action='host' then
     update public.room_members set role='moderator' where room_id=p_room and user_id=v_user;
     update public.room_members set role='host' where room_id=p_room and user_id=p_target;
     update public.rooms set host_id=p_target where id=p_room;
   end if;
 elsif p_action='lock' then update public.rooms set status='locked' where id=p_room;
 elsif p_action='unlock' then update public.rooms set status='open' where id=p_room;
 elsif p_action='close' then update public.rooms set status='closed' where id=p_room;
 elsif p_action='chat' then update public.rooms set chat_enabled=p_value::boolean where id=p_room;
 elsif p_action='scene' then
   if p_extra is null or jsonb_typeof(p_extra)<>'object' or octet_length(p_extra::text)>2048
     or coalesce(p_extra->>'theme','') not in('aurora','cafe','forest','paper')
     or coalesce(p_extra->>'sound','') not in('','rain','cafe','ocean','fire')
     or (coalesce(p_extra->>'backgroundURL','')<>'' and
       (p_extra->>'backgroundURL' !~ '^https://[^[:space:]]+$' or char_length(p_extra->>'backgroundURL')>500))
     then raise exception 'Invalid scene' using errcode='22023'; end if;
   update public.rooms set scene=p_extra where id=p_room;
 elsif p_action='timer_start' then
   if p_value::integer not between 1 and 240 then raise exception 'Invalid timer' using errcode='22023'; end if;
   update public.rooms set timer_mode='shared',timer_started_at=clock_timestamp(),timer_minutes=p_value::integer where id=p_room;
 elsif p_action='timer_stop' then
   update public.rooms set timer_mode='individual',timer_started_at=null,timer_minutes=null where id=p_room;
 elsif p_action='music' then
   if p_value is not null and p_value !~ '^[A-Za-z0-9_-]{11}$'
     then raise exception 'Invalid YouTube ID' using errcode='22023'; end if;
   update public.rooms set music_video_id=p_value,music_position=0,music_playing=false,
     music_updated_at=clock_timestamp() where id=p_room;
 elsif p_action='music_state' then
    if v_room.music_video_id is null or p_extra->>'playing' not in('true','false')
      or p_extra->>'position' is null or (p_extra->>'position')::integer<0
     or (p_extra->>'position')::integer>86400 then raise exception 'Invalid music state' using errcode='22023'; end if;
   update public.rooms set music_position=(p_extra->>'position')::integer,
     music_playing=(p_extra->>'playing')::boolean,music_updated_at=clock_timestamp() where id=p_room;
 elsif p_action='word_add' then
   insert into public.room_banned_words(room_id,word) values(p_room,lower(trim(p_value))) on conflict do nothing;
 elsif p_action='word_remove' then
   delete from public.room_banned_words where room_id=p_room and word=lower(trim(p_value));
 else raise exception 'Invalid room action' using errcode='22023'; end if;
 update public.rooms set updated_at=clock_timestamp() where id=p_room;
 return jsonb_build_object('status','ok','server_time',clock_timestamp());
end;
$$;

create or replace function public.send_room_message(p_room uuid,p_body text,p_parent bigint default null)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_id bigint;v_last timestamptz;
begin
 if v_user is null or not public.is_room_member(p_room) or
   not exists(select 1 from public.rooms where id=p_room and status<>'closed' and chat_enabled)
   then raise exception 'Chat unavailable' using errcode='42501'; end if;
 if char_length(trim(p_body)) not between 1 and 500 then raise exception 'Message must be 1–500 characters' using errcode='22023'; end if;
 if exists(select 1 from public.room_members where room_id=p_room and user_id=v_user and muted_until>now())
   then raise exception 'You are muted' using errcode='42501'; end if;
 if p_parent is not null and not exists(select 1 from public.room_messages where id=p_parent and room_id=p_room and deleted_at is null)
   then raise exception 'Reply target unavailable' using errcode='22023'; end if;
 if exists(select 1 from public.room_banned_words where room_id=p_room and position(word in lower(p_body))>0)
   then raise exception 'Message contains a blocked word' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text||p_room::text,9));
 select max(created_at) into v_last from public.room_messages where room_id=p_room and user_id=v_user;
 if v_last>now()-interval '1 second' or
   (select count(*) from public.room_messages where room_id=p_room and user_id=v_user
     and created_at>now()-interval '1 minute')>=20
   then raise exception 'Please slow down' using errcode='22023'; end if;
 insert into public.room_messages(room_id,user_id,parent_id,body)
 values(p_room,v_user,p_parent,trim(p_body)) returning id into v_id;
 delete from public.room_messages where room_id=p_room and created_at<now()-interval '24 hours';
 delete from public.room_messages where id in(
   select id from public.room_messages where room_id=p_room order by created_at desc offset 200
 );
 return v_id;
end;
$$;
create or replace function public.room_react(p_message bigint,p_emoji text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_room uuid;
begin
 select room_id into v_room from public.room_messages where id=p_message and deleted_at is null;
 if v_user is null or not public.is_room_member(v_room) then raise exception 'Not a room member' using errcode='42501'; end if;
 if p_emoji not in('👍','❤️','✨','👏','🔥') then raise exception 'Invalid reaction' using errcode='22023'; end if;
 insert into public.room_message_reactions(message_id,user_id,emoji) values(p_message,v_user,p_emoji)
 on conflict do nothing;
 return jsonb_build_object('status','ok');
end;
$$;
create or replace function public.room_report(p_room uuid,p_target uuid,p_message bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();
begin
 if v_user is null or not public.is_room_member(p_room) then raise exception 'Not a room member' using errcode='42501'; end if;
 if char_length(trim(p_reason)) not between 5 and 500 then raise exception 'Reason must be 5–500 characters' using errcode='22023'; end if;
 if p_message is not null and not exists(select 1 from public.room_messages where id=p_message and room_id=p_room)
   then raise exception 'Message not found' using errcode='22023'; end if;
 if (select count(*) from public.room_reports where reporter_id=v_user and created_at>now()-interval '1 day')>=10
   then raise exception 'Daily report limit reached' using errcode='22023'; end if;
 insert into public.room_reports(room_id,reporter_id,target_user_id,message_id,reason)
 values(p_room,v_user,p_target,p_message,trim(p_reason));
 return jsonb_build_object('status','ok');
end;
$$;
create or replace function public.room_commitment(p_room uuid,p_text text,p_checkin text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_room_member(p_room) then raise exception 'Not a room member' using errcode='42501'; end if;
 if char_length(coalesce(p_text,''))>140 or (p_checkin is not null and p_checkin not in('done','partial','missed'))
   then raise exception 'Invalid commitment' using errcode='22023'; end if;
 update public.room_members set commitment=coalesce(p_text,''),checkin=p_checkin
 where room_id=p_room and user_id=auth.uid();
 return jsonb_build_object('status','ok');
end;
$$;
create or replace function public.room_favorite(p_room uuid,p_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_room_member(p_room) then raise exception 'Not a room member' using errcode='42501'; end if;
 if p_active then insert into public.room_favorites(room_id,user_id) values(p_room,auth.uid()) on conflict do nothing;
 else delete from public.room_favorites where room_id=p_room and user_id=auth.uid(); end if;
 return jsonb_build_object('status','ok');
end;
$$;
create or replace function public.create_room_event(p_room uuid,p_squad uuid,p_title text,p_starts timestamptz)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_id uuid;
begin
 if v_user is null or (p_room is not null and not public.is_room_member(p_room)) or
   (p_squad is not null and not public.is_squad_member(p_squad)) or
   char_length(trim(p_title)) not between 3 and 100 or
   p_starts<=now() or p_starts>now()+interval '1 year'
   then raise exception 'Invalid event' using errcode='22023'; end if;
 insert into public.room_events(room_id,squad_id,creator_id,title,starts_at)
 values(p_room,p_squad,v_user,trim(p_title),p_starts) returning id into v_id;
 insert into public.room_event_rsvps(event_id,user_id)
 select v_id,m.user_id from public.squad_members m where m.squad_id=p_squad and m.user_id<>v_user;
 insert into public.room_event_rsvps(event_id,user_id)
 select v_id,m.user_id from public.room_members m where m.room_id=p_room and m.active and m.user_id<>v_user
 on conflict do nothing;
 insert into public.room_event_rsvps(event_id,user_id,response,responded_at)
 values(v_id,v_user,'yes',now());
 return v_id;
end;
$$;
create or replace function public.invite_room_event(p_event uuid,p_target uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid();v_event public.room_events%rowtype;
begin
 select * into v_event from public.room_events where id=p_event;
 if v_user is null or v_event.creator_id<>v_user or p_target=v_user or
   not exists(select 1 from public.friendships f where
     f.user_a=least(v_user,p_target) and f.user_b=greatest(v_user,p_target)) or
   exists(select 1 from public.user_blocks b where
     (b.blocker_id=v_user and b.blocked_id=p_target) or
     (b.blocker_id=p_target and b.blocked_id=v_user))
   then raise exception 'Friend invitation unavailable' using errcode='42501'; end if;
 insert into public.room_event_rsvps(event_id,user_id) values(p_event,p_target)
 on conflict do nothing;
 insert into public.notifications(user_id,kind,title,body,target_id)
 values(p_target,'room','Lời mời học chung','Bạn có một lịch hẹn học chung.',p_event);
 return true;
end;
$$;
create or replace function public.room_rsvp(p_event uuid,p_response text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_response not in('yes','no','maybe') then raise exception 'Invalid RSVP' using errcode='22023'; end if;
 update public.room_event_rsvps set response=p_response,responded_at=now()
 where event_id=p_event and user_id=auth.uid();
 if not found then raise exception 'Not invited' using errcode='42501'; end if;
 return jsonb_build_object('status','ok');
end;
$$;
create or replace function public.room_directory(p_subject text default null,p_language text default null)
returns table(id uuid,name text,subject text,language text,member_count bigint,max_members integer,
 host_username text,created_at timestamptz,password_required boolean)
language sql stable security definer set search_path='' as $$
 select r.id,r.name,r.subject,r.language,
   (select count(*) from public.room_members m where m.room_id=r.id and m.active),r.max_members,
   p.username,r.created_at,r.password_hash is not null from public.rooms r join public.profiles p on p.user_id=r.host_id
 where auth.uid() is not null and r.visibility='public' and r.status='open'
   and (p_subject is null or r.subject ilike '%'||left(p_subject,60)||'%')
   and (p_language is null or r.language=p_language)
 order by r.created_at desc limit 50;
$$;
create or replace function public.my_rooms()
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'status',r.status,
   'visibility',r.visibility,'invite_code',r.invite_code,'password_required',r.password_hash is not null,'joined_at',m.joined_at,
   'favorite',exists(select 1 from public.room_favorites f where f.room_id=r.id and f.user_id=auth.uid()))
   order by m.joined_at desc),'[]'::jsonb)
 from public.room_members m join public.rooms r on r.id=m.room_id
 where auth.uid() is not null and m.user_id=auth.uid();
$$;
create or replace function public.close_empty_rooms()
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
 if auth.uid() is null then raise exception 'Not authenticated' using errcode='28000'; end if;
 update public.rooms r set status='closed',updated_at=now()
 where r.status<>'closed' and r.last_empty_at<now()-interval '24 hours'
   and not exists(select 1 from public.room_members m where m.room_id=r.id and m.active);
 get diagnostics v_count=row_count;return v_count;
end;
$$;

create or replace function public.social_overview()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'friends',coalesce((select jsonb_agg(jsonb_build_object(
    'user_id',p.user_id,'username',p.username,'avatar_id',p.avatar_id,
    'share_status',p.share_status and not p.hide_presence,
    'studying',case when p.share_status and not p.hide_presence then exists(
      select 1 from public.focus_sessions f where f.user_id=p.user_id and f.ended_at is null
      and f.planned_end_at>now()) else false end,
    'minutes_today',case when p.share_minutes then
       (select coalesce(sum(greatest(0,floor(extract(epoch from least(f.ended_at,f.planned_end_at)-f.started_at)/60))),0)::integer
        from public.focus_sessions f where f.user_id=p.user_id and f.ended_at is not null
        and f.started_at::date=current_date) else null end)
    order by p.username) from public.friendships x join public.profiles p
    on p.user_id=case when x.user_a=auth.uid() then x.user_b else x.user_a end
    where auth.uid() in(x.user_a,x.user_b)),'[]'::jsonb),
  'incoming',coalesce((select jsonb_agg(jsonb_build_object('user_id',p.user_id,'username',p.username,
    'avatar_id',p.avatar_id,'created_at',r.created_at))
    from public.friend_requests r join public.profiles p on p.user_id=r.sender_id
    where r.recipient_id=auth.uid() and r.status='pending'),'[]'::jsonb),
  'outgoing',coalesce((select jsonb_agg(jsonb_build_object('user_id',p.user_id,'username',p.username,
    'avatar_id',p.avatar_id,'created_at',r.created_at))
    from public.friend_requests r join public.profiles p on p.user_id=r.recipient_id
    where r.sender_id=auth.uid() and r.status='pending'),'[]'::jsonb),
  'squads',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'avatar_id',s.avatar_id,'owner_id',s.owner_id,
    'invite_code',s.invite_code,'timezone',s.timezone,'threshold_percent',s.threshold_percent,
    'min_focus_minutes',s.min_focus_minutes,'leaderboard_enabled',s.leaderboard_enabled,
    'role',m.role)) from public.squad_members m join public.squads s on s.id=m.squad_id
    where m.user_id=auth.uid()),'[]'::jsonb),
  'blocked',coalesce((select jsonb_agg(jsonb_build_object('user_id',b.blocked_id,'username',p.username))
    from public.user_blocks b join public.profiles p on p.user_id=b.blocked_id
    where b.blocker_id=auth.uid()),'[]'::jsonb));
$$;
create or replace function public.room_roster(p_room uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select case when public.is_room_member(p_room) then coalesce(jsonb_agg(jsonb_build_object(
   'user_id',m.user_id,'username',p.username,'avatar_id',p.avatar_id,'role',m.role,
   'commitment',m.commitment,'checkin',m.checkin,'muted_until',m.muted_until)
   order by m.joined_at),'[]'::jsonb) else '[]'::jsonb end
 from public.room_members m join public.profiles p on p.user_id=m.user_id
 where m.room_id=p_room and m.active;
$$;
create or replace function public.room_feed(p_room uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select case when public.is_room_member(p_room) then coalesce(jsonb_agg(jsonb_build_object(
   'id',m.id,'user_id',m.user_id,'username',p.username,'avatar_id',p.avatar_id,
   'parent_id',m.parent_id,'body',m.body,'created_at',m.created_at,
   'reactions',(select coalesce(jsonb_object_agg(emoji,n),'{}'::jsonb) from
      (select emoji,count(*) as n from public.room_message_reactions where message_id=m.id group by emoji) r))
   order by m.created_at),'[]'::jsonb) else '[]'::jsonb end
 from (select * from public.room_messages where room_id=p_room and deleted_at is null
   and created_at>now()-interval '24 hours' order by created_at desc limit 200) m
 join public.profiles p on p.user_id=m.user_id;
$$;
create or replace function public.accept_community_rules()
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Not authenticated' using errcode='28000'; end if;
 update public.profiles set community_accepted_at=coalesce(community_accepted_at,now())
 where user_id=auth.uid();return found;
end;
$$;
create or replace function public.update_privacy(p_minutes boolean,p_status boolean,p_hidden boolean,
 p_prefs jsonb,p_quiet_start time default null,p_quiet_end time default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_prefs is null or jsonb_typeof(p_prefs)<>'object' or
   octet_length(p_prefs::text)>1024 then raise exception 'Invalid preferences' using errcode='22023'; end if;
 update public.profiles set share_minutes=p_minutes,share_status=p_status,hide_presence=p_hidden,
   notification_preferences=p_prefs,quiet_start=p_quiet_start,quiet_end=p_quiet_end,
   updated_at=now() where user_id=auth.uid();
 return jsonb_build_object('status','ok');
end;
$$;
create or replace function public.mark_notifications_read()
returns integer language plpgsql security definer set search_path='' as $$
declare v_count integer;
begin
 if auth.uid() is null then raise exception 'Not authenticated' using errcode='28000'; end if;
 update public.notifications set read_at=now() where user_id=auth.uid() and read_at is null;
 get diagnostics v_count=row_count;return v_count;
end;
$$;
create or replace function public.create_squad_challenge(p_squad uuid,p_title text,p_minutes integer,
 p_start date,p_end date)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 if auth.uid() is null or not exists(select 1 from public.squad_members where squad_id=p_squad
   and user_id=auth.uid() and role='admin') or char_length(trim(p_title)) not between 3 and 100
   or p_minutes not between 25 and 30000 or p_start<current_date or p_end<p_start or p_end>p_start+31
   then raise exception 'Invalid challenge' using errcode='22023'; end if;
 insert into public.squad_challenges(squad_id,title,target_minutes,starts_on,ends_on)
 values(p_squad,trim(p_title),p_minutes,p_start,p_end) returning id into v_id;
 return v_id;
end;
$$;
create or replace function public.squad_challenge_progress(p_challenge uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_challenge public.squad_challenges%rowtype;v_total integer;
begin
 select * into v_challenge from public.squad_challenges where id=p_challenge;
 if auth.uid() is null or not public.is_squad_member(v_challenge.squad_id)
   then raise exception 'Not a squad member' using errcode='42501'; end if;
 select coalesce(sum(greatest(0,floor(extract(epoch from least(f.ended_at,f.planned_end_at)-f.started_at)/60))),0)::integer
 into v_total from public.focus_sessions f join public.squad_members m on m.user_id=f.user_id
 where m.squad_id=v_challenge.squad_id and f.ended_at is not null
   and (f.started_at at time zone (select timezone from public.squads where id=v_challenge.squad_id))::date
     between v_challenge.starts_on and v_challenge.ends_on;
 return jsonb_build_object('minutes',v_total,'target',v_challenge.target_minutes);
end;
$$;
create or replace function public.squad_week_leaderboard(p_squad uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_zone text;v_enabled boolean;v_result jsonb;
begin
 if auth.uid() is null or not public.is_squad_member(p_squad) then raise exception 'Not a squad member' using errcode='42501'; end if;
 select timezone,leaderboard_enabled into v_zone,v_enabled from public.squads where id=p_squad;
 if not v_enabled then return '[]'::jsonb; end if;
 select coalesce(jsonb_agg(jsonb_build_object('username',p.username,'avatar_id',p.avatar_id,'minutes',t.minutes)
   order by t.minutes desc),'[]'::jsonb) into v_result
 from public.squad_members m join public.profiles p on p.user_id=m.user_id
 cross join lateral(select coalesce(sum(greatest(0,floor(extract(epoch from least(f.ended_at,f.planned_end_at)-f.started_at)/60))),0)::integer minutes
   from public.focus_sessions f where f.user_id=m.user_id and f.ended_at is not null
   and (f.started_at at time zone v_zone)::date>=date_trunc('week',now() at time zone v_zone)::date) t
 where m.squad_id=p_squad and p.share_minutes;
 return v_result;
end;
$$;
create or replace function public.find_room_by_code(p_code text)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('id',id,'name',name,
   'password_required',password_hash is not null,'visibility',visibility)
   from public.rooms where auth.uid() is not null and invite_code=upper(trim(p_code))
   and status='open' and (visibility<>'squad' or public.is_squad_member(squad_id))),
   '{}'::jsonb);
$$;
create or replace function public.server_time()
returns timestamptz language sql volatile security definer set search_path='' as $$
 select case when auth.uid() is not null then clock_timestamp() else null end;
$$;
create or replace function public.room_day_total(p_room uuid,p_day date default current_date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_total integer;v_members integer;
begin
 if auth.uid() is null or not public.is_room_member(p_room) then raise exception 'Not a room member' using errcode='42501'; end if;
 select coalesce(sum(greatest(0,floor(extract(epoch from least(f.ended_at,f.planned_end_at)-f.started_at)/60))),0)::integer,
   count(distinct f.user_id)::integer into v_total,v_members
 from public.focus_sessions f where f.room_id=p_room and f.ended_at is not null
   and f.started_at::date=p_day;
 return jsonb_build_object('minutes',v_total,'contributors',v_members);
end;
$$;

create or replace function public.is_event_invited(p_event uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.room_event_rsvps
   where event_id=p_event and user_id=auth.uid());
$$;
drop policy if exists room_events_visible on public.room_events;
create policy room_events_visible on public.room_events for select to authenticated
 using(creator_id=auth.uid() or public.is_squad_member(squad_id) or public.is_event_invited(id));

-- Topic room:<uuid> chỉ dành cho thành viên còn hoạt động. Tắt "Allow public access"
-- trong Supabase Realtime Settings trước khi bật phòng chung.
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='rooms') then
    alter publication supabase_realtime add table public.rooms;
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='room_messages') then
    alter publication supabase_realtime add table public.room_messages;
  end if;
end $$;
drop policy if exists room_presence_read on realtime.messages;
create policy room_presence_read on realtime.messages for select to authenticated
 using(realtime.messages.extension in('broadcast','presence') and
   (select realtime.topic()) ~ '^room:[0-9a-f-]{36}$' and
   public.is_room_member(split_part((select realtime.topic()),':',2)::uuid));
drop policy if exists room_presence_send on realtime.messages;
create policy room_presence_send on realtime.messages for insert to authenticated
 with check(realtime.messages.extension in('broadcast','presence') and
   (select realtime.topic()) ~ '^room:[0-9a-f-]{36}$' and
   public.is_room_member(split_part((select realtime.topic()),':',2)::uuid));

do $$
declare r record;
begin
 for r in select p.oid::regprocedure as signature from pg_catalog.pg_proc p
   join pg_catalog.pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname=any(array[
     'is_squad_member','find_people','friend_action','focus_start','focus_stop','focus_abandon',
     'create_squad','join_squad','squad_action','squad_day','squad_history',
     'is_room_member','can_manage_room','create_room','join_room','leave_room',
     'room_action','send_room_message','room_react','room_report','room_commitment',
     'room_favorite','create_room_event','invite_room_event','room_rsvp','room_directory','my_rooms','close_empty_rooms',
     'social_overview','room_roster','room_feed','accept_community_rules',
     'update_privacy','mark_notifications_read','create_squad_challenge',
     'squad_challenge_progress','squad_week_leaderboard','find_room_by_code','server_time','room_day_total','is_event_invited'])
 loop
   execute format('revoke all on function %s from public, anon',r.signature);
   execute format('grant execute on function %s to authenticated',r.signature);
 end loop;
end $$;
