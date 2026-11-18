create index if not exists admin_users_created_by_idx on private.admin_users(created_by);

drop policy if exists admin_users_no_direct_access on private.admin_users;
create policy admin_users_no_direct_access on private.admin_users
  for all to public using (false) with check (false);

create or replace function private.sima_is_owner()
returns boolean language sql stable security definer set search_path = ''
as $$
  select lower(coalesce((select auth.jwt() ->> 'email'), '')) <> ''
     and lower(coalesce((select s.admin_email from public.site_settings s where s.id = true), '')) =
         lower(coalesce((select auth.jwt() ->> 'email'), ''));
$$;

create or replace function private.sima_is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.sima_is_owner()
      or exists (select 1 from private.admin_users a
        where a.user_id = (select auth.uid()) and a.is_active = true);
$$;

create or replace function private.owner_list_supervisors()
returns table(user_id uuid, email text, created_at timestamptz, is_active boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.sima_is_owner() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  return query select a.user_id, a.email, a.created_at, a.is_active
    from private.admin_users a order by a.created_at desc;
end;
$$;

create or replace function private.owner_add_supervisor(p_user_id uuid, p_email text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_auth_email text; v_owner_email text;
begin
  if not private.sima_is_owner() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  v_owner_email := lower(coalesce((select s.admin_email from public.site_settings s where s.id = true), ''));
  if p_user_id is null or nullif(trim(p_email), '') is null then raise exception 'بيانات المشرف غير مكتملة'; end if;
  select lower(u.email) into v_auth_email from auth.users u where u.id = p_user_id;
  if v_auth_email is null or v_auth_email <> lower(trim(p_email)) then raise exception 'البريد الإلكتروني لا يطابق حساب المستخدم'; end if;
  if v_auth_email = v_owner_email then raise exception 'لا يمكن إضافة حساب المدير الرئيسي كمشرف'; end if;
  insert into private.admin_users(user_id, email, created_by, is_active)
  values (p_user_id, v_auth_email, (select auth.uid()), true)
  on conflict (user_id) do update set email = excluded.email, created_by = excluded.created_by, is_active = true;
end;
$$;

create or replace function private.owner_remove_supervisor(p_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_owner_id uuid;
begin
  if not private.sima_is_owner() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select u.id into v_owner_id from auth.users u join public.site_settings s on s.id = true
    where lower(u.email) = lower(s.admin_email);
  if p_user_id is null or p_user_id = v_owner_id then raise exception 'لا يمكن إزالة حساب المدير الرئيسي'; end if;
  update private.admin_users set is_active = false where user_id = p_user_id;
  if not found then raise exception 'حساب المشرف غير موجود'; end if;
end;
$$;

create or replace function public.sima_is_owner()
returns boolean language sql stable security invoker set search_path = ''
as $$ select private.sima_is_owner(); $$;

create or replace function public.sima_is_admin()
returns boolean language sql stable security invoker set search_path = ''
as $$ select private.sima_is_admin(); $$;

create or replace function public.owner_list_supervisors()
returns table(user_id uuid, email text, created_at timestamptz, is_active boolean)
language sql stable security invoker set search_path = ''
as $$ select * from private.owner_list_supervisors(); $$;

create or replace function public.owner_add_supervisor(p_user_id uuid, p_email text)
returns void language sql security invoker set search_path = ''
as $$ select private.owner_add_supervisor(p_user_id, p_email); $$;

create or replace function public.owner_remove_supervisor(p_user_id uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.owner_remove_supervisor(p_user_id); $$;

grant usage on schema private to authenticated;
grant execute on function private.sima_is_owner() to authenticated;
grant execute on function private.sima_is_admin() to authenticated;
grant execute on function private.owner_list_supervisors() to authenticated;
grant execute on function private.owner_add_supervisor(uuid, text) to authenticated;
grant execute on function private.owner_remove_supervisor(uuid) to authenticated;

revoke all on function private.sima_is_owner() from public, anon;
revoke all on function private.sima_is_admin() from public, anon;
revoke all on function private.owner_list_supervisors() from public, anon;
revoke all on function private.owner_add_supervisor(uuid, text) from public, anon;
revoke all on function private.owner_remove_supervisor(uuid) from public, anon;

revoke all on function public.sima_is_owner() from public, anon;
revoke all on function public.sima_is_admin() from public, anon;
revoke all on function public.owner_list_supervisors() from public, anon;
revoke all on function public.owner_add_supervisor(uuid, text) from public, anon;
revoke all on function public.owner_remove_supervisor(uuid) from public, anon;

grant execute on function public.sima_is_owner() to authenticated;
grant execute on function public.sima_is_admin() to authenticated;
grant execute on function public.owner_list_supervisors() to authenticated;
grant execute on function public.owner_add_supervisor(uuid, text) to authenticated;
grant execute on function public.owner_remove_supervisor(uuid) to authenticated;
revoke all on function private.sima_is_owner() from public, anon;
revoke all on function private.sima_is_admin() from public, anon;
revoke all on function private.owner_list_supervisors() from public, anon;
revoke all on function private.owner_add_supervisor(uuid, text) from public, anon;
revoke all on function private.owner_remove_supervisor(uuid) from public, anon;
