create table if not exists private.sima_site_visitors (
  visitor_key uuid primary key,
  first_seen_at timestamptz not null default now()
);

alter table private.sima_site_visitors enable row level security;
revoke all on table private.sima_site_visitors from public, anon, authenticated;

create or replace function private.sima_track_visit(p_visitor_key uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_visitor_key is null then
    raise exception 'معرّف الزيارة غير صالح' using errcode = '22023';
  end if;

  insert into private.sima_site_visitors(visitor_key)
  values (p_visitor_key)
  on conflict (visitor_key) do nothing;
end;
$$;

create or replace function public.sima_track_visit(p_visitor_key uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.sima_track_visit(p_visitor_key);
$$;

create or replace function private.sima_admin_metrics()
returns table(visitor_count bigint, advertiser_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.sima_is_admin() then
    raise exception 'غير مصرح' using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from private.sima_site_visitors),
    (
      select count(distinct nullif(regexp_replace(coalesce(l.contact_phone, ''), '[^0-9]', '', 'g'), ''))
      from public.listings l
      where nullif(regexp_replace(coalesce(l.contact_phone, ''), '[^0-9]', '', 'g'), '') is not null
    );
end;
$$;

create or replace function public.sima_admin_metrics()
returns table(visitor_count bigint, advertiser_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select * from private.sima_admin_metrics();
$$;

grant usage on schema private to anon, authenticated;
revoke all on function private.sima_track_visit(uuid) from public, anon, authenticated;
grant execute on function private.sima_track_visit(uuid) to anon, authenticated;
revoke all on function public.sima_track_visit(uuid) from public, anon, authenticated;
grant execute on function public.sima_track_visit(uuid) to anon, authenticated;

revoke all on function private.sima_admin_metrics() from public, anon, authenticated;
grant execute on function private.sima_admin_metrics() to authenticated;
revoke all on function public.sima_admin_metrics() from public, anon, authenticated;
grant execute on function public.sima_admin_metrics() to authenticated;
