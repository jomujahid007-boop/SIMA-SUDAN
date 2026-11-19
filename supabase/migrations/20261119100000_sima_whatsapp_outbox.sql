-- SIMA WhatsApp integration foundation: private outbox and deduplicated inbound messages.
create schema if not exists private;

create table if not exists private.sima_whatsapp_outbox (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('listing_submitted')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists sima_whatsapp_outbox_pending_idx
  on private.sima_whatsapp_outbox (next_attempt_at, id)
  where status in ('pending','failed');
alter table private.sima_whatsapp_outbox enable row level security;
revoke all on table private.sima_whatsapp_outbox from public, anon, authenticated;
grant all on table private.sima_whatsapp_outbox to service_role;

create table if not exists public.sima_whatsapp_inbound (
  message_id text primary key,
  sender text not null,
  auto_replied boolean not null default false,
  received_at timestamptz not null default now()
);
alter table public.sima_whatsapp_inbound enable row level security;
revoke all on table public.sima_whatsapp_inbound from public, anon, authenticated;
grant all on table public.sima_whatsapp_inbound to service_role;

create or replace function private.enqueue_sima_listing_whatsapp()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into private.sima_whatsapp_outbox(event_type, payload)
  values ('listing_submitted', jsonb_build_object(
    'listing_id', new.id, 'title', new.title, 'contact_name', new.contact_name,
    'city_id', new.city_id, 'category_id', new.category_id, 'created_at', new.created_at
  ));
  return new;
end;
$$;

drop trigger if exists sima_listing_whatsapp_enqueue on public.listings;
create trigger sima_listing_whatsapp_enqueue
after insert on public.listings
for each row when (new.status = 'pending')
execute function private.enqueue_sima_listing_whatsapp();

create or replace function public.sima_whatsapp_claim_outbox(p_limit integer default 20)
returns table(id bigint, event_type text, payload jsonb, attempts integer)
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  return query
  with picked as (
    select o.id from private.sima_whatsapp_outbox o
    where o.status in ('pending','failed') and o.next_attempt_at <= now() and o.attempts < 8
    order by o.id for update skip locked
    limit greatest(1, least(coalesce(p_limit,20),100))
  )
  update private.sima_whatsapp_outbox o
  set status='processing', attempts=o.attempts+1, locked_at=now()
  from picked where o.id=picked.id
  returning o.id,o.event_type,o.payload,o.attempts;
end;
$$;

create or replace function public.sima_whatsapp_finish_outbox(p_id bigint,p_success boolean,p_error text default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update private.sima_whatsapp_outbox
  set status=case when p_success then 'sent' else 'failed' end,
      sent_at=case when p_success then now() else null end,
      last_error=case when p_success then null else left(coalesce(p_error,'Unknown error'),1000) end,
      next_attempt_at=case when p_success then now()
        else now()+make_interval(mins=>least(60,greatest(1,attempts*5))) end,
      locked_at=null
  where id=p_id and status='processing';
end;
$$;

revoke all on function public.sima_whatsapp_claim_outbox(integer) from public,anon,authenticated;
revoke all on function public.sima_whatsapp_finish_outbox(bigint,boolean,text) from public,anon,authenticated;
grant execute on function public.sima_whatsapp_claim_outbox(integer) to service_role;
grant execute on function public.sima_whatsapp_finish_outbox(bigint,boolean,text) to service_role;
