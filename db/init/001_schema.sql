create extension if not exists "pgcrypto";

create table if not exists tenants (
  id text primary key,
  name text not null,
  plan text not null default 'Starter',
  status text not null default 'Active',
  logo_url text,
  created_at timestamptz not null default now()
);

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  email text unique,
  password_hash text,
  role text not null,
  platform_role text not null default 'tenant_user',
  team text,
  initials text,
  avatar_url text,
  is_active boolean not null default true,
  must_change_password boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table app_users add column if not exists password_hash text;
alter table app_users add column if not exists platform_role text not null default 'tenant_user';
alter table app_users add column if not exists is_active boolean not null default true;
alter table app_users add column if not exists must_change_password boolean not null default false;
alter table app_users add column if not exists updated_at timestamptz not null default now();
alter table tenants add column if not exists logo_url text;
alter table app_users add column if not exists avatar_url text;

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  owner_user_id uuid references app_users(id),
  stage text not null default 'Draft',
  progress integer not null default 0 check (progress between 0 and 100),
  budget numeric(12,2) not null default 0,
  leads_count integer not null default 0,
  channels text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  company text not null,
  contact_name text not null,
  email text,
  score integer not null default 0 check (score between 0 and 100),
  source text,
  stage text not null default 'New',
  owner_user_id uuid references app_users(id),
  next_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  health integer not null default 75 check (health between 0 and 100),
  plan text not null default 'Starter',
  mrr numeric(12,2) not null default 0,
  status text not null default 'Active',
  created_at timestamptz not null default now()
);

create table if not exists follow_up_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  title text not null,
  owner_user_id uuid references app_users(id),
  due_at timestamptz,
  priority text not null default 'Medium',
  channel text not null default 'Email',
  status text not null default 'Open',
  created_at timestamptz not null default now()
);

create table if not exists ai_agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  type text not null,
  model text not null,
  temperature numeric(3,2) not null default 0.40,
  approval_rule text not null default 'Human approval before execution',
  status text not null default 'Ready',
  tools text[] not null default '{}',
  system_prompt text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  source_agent_id uuid references ai_agents(id) on delete set null,
  title text not null,
  risk text not null default 'Medium',
  prompt text not null default '',
  output text not null default '',
  action_type text,
  action_payload jsonb not null default '{}'::jsonb,
  execution_result jsonb,
  status text not null default 'pending',
  decided_by text,
  decision_note text,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists social_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  platform text not null,
  handle text not null default '',
  credentials jsonb not null default '{}'::jsonb,
  status text not null default 'Active',
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, platform)
);

create table if not exists email_configs (
  tenant_id text primary key,
  smtp_host text,
  smtp_port integer not null default 587,
  smtp_secure boolean not null default false,
  smtp_user text,
  smtp_pass text,
  from_email text,
  from_name text,
  enabled boolean not null default false,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text references tenants(id) on delete set null,
  actor_user_id uuid references app_users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists email_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text references tenants(id) on delete set null,
  recipient text not null,
  subject text not null,
  status text not null,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now()
);

create table if not exists crm_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  note text not null,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  job_type text not null default 'ai_workflow',
  schedule text not null default 'manual',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'Active',
  next_run_at timestamptz,
  last_run_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  retry_count integer not null default 0,
  last_error text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table scheduled_jobs add column if not exists locked_at timestamptz;
alter table scheduled_jobs add column if not exists locked_by text;
alter table scheduled_jobs add column if not exists retry_count integer not null default 0;
alter table scheduled_jobs add column if not exists last_error text;

create table if not exists scheduled_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references scheduled_jobs(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  status text not null,
  approval_id uuid references approvals(id) on delete set null,
  output text,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

insert into tenants (id, name, plan, status)
values
  ('platform', 'Octave Platform', 'Platform', 'Active')
on conflict (id) do nothing;

insert into app_users (tenant_id, name, email, password_hash, role, platform_role, team, initials)
values
  ('platform', 'Platform Admin', 'admin@octave.local', '1098110b7acd108052bb6381081afe67:aadd845132f93b9f486eda8e1efd2582d3e031cf9f621692368283ac678ca3d31dabe73f65b4c935b100ba11b3fd9d9f1213c39e02254338a326d27db06cd832', 'Platform Admin', 'platform_admin', 'System', 'PA')
on conflict (email) do update
  set tenant_id = excluded.tenant_id,
      password_hash = excluded.password_hash,
      role = excluded.role,
      platform_role = excluded.platform_role,
      is_active = true,
      updated_at = now();
