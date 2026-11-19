-- Admin dashboard notifications and email outbox for new SIMA listings.
create table if not exists private.sima_admin_email_outbox (
  id bigint generated always as identity primary key,
  listing_id uuid not null,
  recipient_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique(listing_id, recipient_email)
);
create index if not exists sima_admin_email_outbox_pending_idx
  on private.sima_admin_email_outbox(next_attempt_at,id)
  where status in ('pending','failed');
alter table private.sima_admin_email_outbox enable row level security;
revoke all on private.sima_admin_email_outbox from public,anon,authenticated;
grant all on private.sima_admin_email_outbox to service_role;

create or replace function private.enqueue_sima_admin_alerts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_email text;
  v_admin_user_id uuid;
  v_body text;
begin
  if new.status <> 'pending' then return new; end if;
  v_body := 'إعلان جديد بانتظار المراجعة: ' || coalesce(new.title,'بدون عنوان')
    || ' — المعلن: ' || coalesce(new.contact_name,'غير محدد')
    || ' — رقم الإعلان: ' || new.id::text;

  select ss.admin_email into v_admin_email
  from public.site_settings ss where ss.id = true;

  select u.id into v_admin_user_id
  from auth.users u
  where lower(u.email) = lower(v_admin_email)
  limit 1;

  if v_admin_user_id is not null then
    insert into public.notifications(user_id,title,body,kind)
    values(v_admin_user_id,'إعلان جديد بانتظار المراجعة',v_body,'admin_new_listing');
  end if;

  insert into public.notifications(user_id,title,body,kind)
  select au.user_id,'إعلان جديد بانتظار المراجعة',v_body,'admin_new_listing'
  from private.admin_users au
  where au.is_active = true
  on conflict do nothing;

  if nullif(trim(coalesce(v_admin_email,'')),'') is not null then
    insert into private.sima_admin_email_outbox(listing_id,recipient_email,subject,body)
    values(new.id,v_admin_email,'إعلان جديد بانتظار المراجعة | سِمة',v_body)
    on conflict(listing_id,recipient_email) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists sima_listing_admin_alert_enqueue on public.listings;
create trigger sima_listing_admin_alert_enqueue
after insert on public.listings
for each row when (new.status = 'pending')
execute function private.enqueue_sima_admin_alerts();

create or replace function public.sima_admin_email_claim(p_limit integer default 20)
returns table(id bigint,recipient_email text,subject text,body text,attempts integer)
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  return query
  with picked as (
    select e.id from private.sima_admin_email_outbox e
    where e.status in ('pending','failed') and e.next_attempt_at <= now() and e.attempts < 8
    order by e.id for update skip locked
    limit greatest(1,least(coalesce(p_limit,20),100))
  )
  update private.sima_admin_email_outbox e
  set status='processing',attempts=e.attempts+1,locked_at=now()
  from picked where e.id=picked.id
  returning e.id,e.recipient_email,e.subject,e.body,e.attempts;
end;
$$;

create or replace function public.sima_admin_email_finish(p_id bigint,p_success boolean,p_error text default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role' then
    raise exception 'service role required' using errcode='42501';
  end if;
  update private.sima_admin_email_outbox
  set status=case when p_success then 'sent' else 'failed' end,
      sent_at=case when p_success then now() else null end,
      last_error=case when p_success then null else left(coalesce(p_error,'Unknown error'),1000) end,
      next_attempt_at=case when p_success then now()
        else now()+make_interval(mins=>least(60,greatest(1,attempts*5))) end,
      locked_at=null
  where id=p_id and status='processing';
end;
$$;
revoke all on function public.sima_admin_email_claim(integer) from public,anon,authenticated;
revoke all on function public.sima_admin_email_finish(bigint,boolean,text) from public,anon,authenticated;
grant execute on function public.sima_admin_email_claim(integer) to service_role;
grant execute on function public.sima_admin_email_finish(bigint,boolean,text) to service_role;
