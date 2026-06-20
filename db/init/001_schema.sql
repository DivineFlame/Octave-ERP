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
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table app_users add column if not exists password_hash text;
alter table app_users add column if not exists platform_role text not null default 'tenant_user';
alter table app_users add column if not exists is_active boolean not null default true;
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

insert into tenants (id, name, plan, status)
values
  ('northstar', 'Northstar Wellness', 'Growth', 'Active'),
  ('urbanedge', 'UrbanEdge Realty', 'Scale', 'Active'),
  ('brightbyte', 'BrightByte Academy', 'Starter', 'Review')
on conflict (id) do nothing;

insert into app_users (tenant_id, name, email, role, team, initials)
values
  ('northstar', 'Ananya Rao', 'ananya@example.com', 'Tenant Admin', 'Marketing Ops', 'AR'),
  ('northstar', 'Karan Mehta', 'karan@example.com', 'Campaign Manager', 'Demand Gen', 'KM'),
  ('northstar', 'Mira Sen', 'mira@example.com', 'Approver', 'Brand', 'MS'),
  ('northstar', 'Dev Iyer', 'dev@example.com', 'Sales Follow-up', 'CRM', 'DI')
on conflict (email) do nothing;

insert into app_users (tenant_id, name, email, password_hash, role, platform_role, team, initials)
values
  ('northstar', 'Platform Admin', 'admin@octave.local', '1098110b7acd108052bb6381081afe67:aadd845132f93b9f486eda8e1efd2582d3e031cf9f621692368283ac678ca3d31dabe73f65b4c935b100ba11b3fd9d9f1213c39e02254338a326d27db06cd832', 'Platform Admin', 'platform_admin', 'System', 'PA')
on conflict (email) do update
  set password_hash = excluded.password_hash,
      role = excluded.role,
      platform_role = excluded.platform_role,
      is_active = true,
      updated_at = now();

update app_users
   set password_hash = coalesce(password_hash, '04c9685156f7f8f090f88d1ca8287aa3:9aed23c934104f2bb1e58d846efb1cc12772a0af0758d5e3bcffc729b1ca094979529e967b1868b04c4e1059b72885da571e0152bde2e1db899712608590a3fc'),
       platform_role = case when role = 'Tenant Admin' then 'tenant_admin' else platform_role end,
       updated_at = now()
 where email = 'ananya@example.com';

update app_users
   set password_hash = coalesce(password_hash, '8da7c471aeae6572f0c6d65ac107ea6b:f10adcf9ffa987f02fe0849cc3006c1b91b9a2f18b5b974e09a77d4136a32636a581c6201e652e5190b1c0fd45177e65862f51142cc9c0e75284ff3fbb1911ac'),
       platform_role = 'tenant_user',
       updated_at = now()
 where email in ('karan@example.com', 'mira@example.com', 'dev@example.com');

insert into campaigns (tenant_id, name, stage, progress, budget, leads_count, channels)
values
  ('northstar', 'Monsoon Wellness Reset', 'Human approval', 72, 180000, 284, array['Instagram','Facebook','Email']),
  ('northstar', 'Corporate Health Webinar', 'AI drafting', 48, 85000, 96, array['LinkedIn','Email']),
  ('northstar', 'Referral Boost Week', 'Scheduled', 91, 42000, 138, array['Instagram','Email'])
on conflict do nothing;

insert into leads (tenant_id, company, contact_name, email, score, source, stage, next_action)
values
  ('northstar', 'Acme Shared Services', 'Priya N.', 'priya@example.com', 92, 'LinkedIn webinar', 'Qualified', 'Call today 16:00'),
  ('northstar', 'MetroBuild Group', 'Rohit V.', 'rohit@example.com', 84, 'Facebook lead form', 'Proposal', 'Send pricing deck'),
  ('northstar', 'Futura Labs', 'Sara M.', 'sara@example.com', 78, 'Instagram DM', 'New', 'Qualify need')
on conflict do nothing;

insert into customers (tenant_id, name, health, plan, mrr, status)
values
  ('northstar', 'Northstar Wellness', 91, 'Growth', 120000, 'Expansion ready'),
  ('northstar', 'UrbanEdge Realty', 82, 'Scale', 280000, 'Onboarding'),
  ('northstar', 'BrightByte Academy', 74, 'Starter', 48000, 'Needs adoption')
on conflict do nothing;

insert into follow_up_tasks (tenant_id, title, due_at, priority, channel, status)
values
  ('northstar', 'Call Acme Shared Services', now() + interval '4 hours', 'High', 'Phone', 'Open'),
  ('northstar', 'Approve webinar nurture email', now() + interval '6 hours', 'High', 'Email', 'Open'),
  ('northstar', 'Send MetroBuild deck', now() + interval '1 day', 'Medium', 'Email', 'Open'),
  ('northstar', 'Qualify Instagram DM leads', now() + interval '2 days', 'Medium', 'Social', 'Open')
on conflict do nothing;

insert into ai_agents (tenant_id, name, type, model, temperature, approval_rule, status, tools, system_prompt)
values
  ('northstar', 'Campaign Strategist', 'Planning', 'llama3.1:8b', 0.40, 'Every campaign brief', 'Ready', array['Market research','Audience map','Budget split'], 'You are a marketing campaign strategist.'),
  ('northstar', 'Social Copywriter', 'Content', 'mistral:7b', 0.70, 'Before publishing', 'Ready', array['Caption draft','Hashtag set','Tone rewrite'], 'You write concise social media copy.'),
  ('northstar', 'Lead Nurture Agent', 'Follow-up', 'qwen2.5:14b', 0.30, 'High-value leads', 'Ready', array['Email sequence','CRM notes','Follow-up tasks'], 'You create sales follow-up drafts.')
on conflict do nothing;

insert into approvals (tenant_id, title, risk, prompt, output, status)
values
  ('northstar', 'Monsoon Reset carousel creative', 'Low', 'Draft carousel captions', 'Draft carousel copy waiting for review.', 'pending'),
  ('northstar', 'Corporate webinar email sequence', 'Medium', 'Draft nurture sequence', 'Email sequence waiting for compliance review.', 'pending'),
  ('northstar', 'Paid campaign budget split', 'High', 'Recommend paid split', 'Budget allocation requires admin approval.', 'pending')
on conflict do nothing;
