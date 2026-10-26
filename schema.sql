create table if not exists sites (
  id         text primary key,
  name       text not null,
  domain     text not null,
  created_at timestamptz not null default now()
);

create table if not exists events (
  id         bigserial primary key,
  site_id    text not null references sites(id) on delete cascade,
  ts         timestamptz not null default now(),
  vid        text not null,
  name       text,
  event      text not null default 'pageview',
  path       text,
  referrer   text,
  country    text,
  city       text,
  device     text,
  browser    text,
  ip_hash    text
);

create index if not exists events_site_ts on events (site_id, ts desc);
create index if not exists events_site_name on events (site_id, name) where name is not null;
