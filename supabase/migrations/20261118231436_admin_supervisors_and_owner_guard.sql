alter table private.admin_users
  add column if not exists email text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists is_active boolean not null default true;

update private.admin_users a
set email = u.email
from auth.users u
where u.id = a.user_id and a.email is null;

create unique index if not exists admin_users_email_lower_uidx
  on private.admin_users (lower(email))
  where email is not null;

alter table private.admin_users enable row level security;
revoke all on table private.admin_users from public, anon, authenticated;

create or replace function public.sima_is_owner()
returns boolean language sql stable security definer set search_path = ''
as $$
  select lower(coalesce((select auth.jwt() ->> 'email'), '')) <> ''
     and lower(coalesce((select s.admin_email from public.site_settings s where s.id = true), '')) =
         lower(coalesce((select auth.jwt() ->> 'email'), ''));
$$;

create or replace function public.sima_is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select public.sima_is_owner()
      or exists (select 1 from private.admin_users a
        where a.user_id = (select auth.uid()) and a.is_active = true);
$$;

create or replace function public.owner_list_supervisors()
returns table(user_id uuid, email text, created_at timestamptz, is_active boolean)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.sima_is_owner() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  return query select a.user_id, a.email, a.created_at, a.is_active
    from private.admin_users a order by a.created_at desc;
end;
$$;

create or replace function public.owner_add_supervisor(p_user_id uuid, p_email text)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_auth_email text; v_owner_email text;
begin
  if not public.sima_is_owner() then raise exception 'غير مصرح' using errcode = '42501'; end if;
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

create or replace function public.owner_remove_supervisor(p_user_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_owner_id uuid;
begin
  if not public.sima_is_owner() then raise exception 'غير مصرح' using errcode = '42501'; end if;
  select u.id into v_owner_id from auth.users u join public.site_settings s on s.id = true
    where lower(u.email) = lower(s.admin_email);
  if p_user_id is null or p_user_id = v_owner_id then raise exception 'لا يمكن إزالة حساب المدير الرئيسي'; end if;
  update private.admin_users set is_active = false where user_id = p_user_id;
  if not found then raise exception 'حساب المشرف غير موجود'; end if;
end;
$$;

create or replace function private.prevent_admin_email_change()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.admin_email is distinct from old.admin_email then
    raise exception 'لا يمكن تغيير حساب المدير الرئيسي من لوحة الإدارة';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_sima_owner_email on public.site_settings;
create trigger protect_sima_owner_email before update of admin_email on public.site_settings
for each row execute function private.prevent_admin_email_change();

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
