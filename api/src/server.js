import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import pg from 'pg';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const { Pool } = pg;

const app = express();
const port = Number(process.env.PORT || 3000);
const defaultTenantId = process.env.DEFAULT_TENANT_ID || 'northstar';
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
const paperclipBaseUrl = process.env.PAPERCLIP_BASE_URL || 'http://paperclip';
const appSecret = process.env.APP_SECRET || 'change-this-octave-secret';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || !allowedOrigins.length || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} is not allowed by CORS`));
  }
}));
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_req, res) => {
  const db = await checkDatabase();
  res.status(db.ok ? 200 : 503).json({
    ok: db.ok,
    service: 'octave-crm-api',
    database: db.ok ? 'connected' : db.error
  });
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ ok: false, error: 'email and password are required' });

    const result = await pool.query(
      `select u.id, u.tenant_id, u.name, u.email, u.password_hash, u.role, u.platform_role,
              u.team, u.initials, u.is_active, t.name as tenant_name, t.plan, t.status as tenant_status
         from app_users u
         join tenants t on t.id = u.tenant_id
        where lower(u.email) = $1`,
      [email]
    );
    const user = result.rows[0];
    if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ ok: false, error: 'Invalid email or password' });
    }
    if (user.tenant_status === 'Restricted' && user.platform_role !== 'platform_admin') {
      return res.status(403).json({ ok: false, error: 'Company access is restricted. Contact the platform admin.' });
    }

    const safeUser = toSafeUser(user);
    const token = signToken({ sub: safeUser.id, tenantId: safeUser.tenantId, role: safeUser.platformRole });
    res.json({ ok: true, token, user: safeUser });
  } catch (error) {
    next(error);
  }
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.json({ ok: true, user: req.user });
});

app.post('/api/auth/change-password', requireAuth, async (req, res, next) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!currentPassword || !newPassword) return res.status(400).json({ ok: false, error: 'currentPassword and newPassword are required' });
  if (newPassword.length < 8) return res.status(400).json({ ok: false, error: 'New password must be at least 8 characters' });

  try {
    const result = await pool.query('select password_hash from app_users where id = $1', [req.user.id]);
    if (!result.rowCount || !verifyPassword(currentPassword, result.rows[0].password_hash)) {
      return res.status(401).json({ ok: false, error: 'Current password is incorrect' });
    }
    await pool.query('update app_users set password_hash = $2, updated_at = now() where id = $1', [req.user.id, hashPassword(newPassword)]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/system/status', requireAuth, async (_req, res) => {
  const [database, ollama, paperclip] = await Promise.all([
    checkDatabase(),
    getOllamaTags(),
    checkPaperclip()
  ]);
  const ok = database.ok && ollama.ok && paperclip.ok;
  res.status(ok ? 200 : 207).json({
    ok,
    database,
    ollama,
    paperclip,
    publicAppUrl: process.env.PUBLIC_APP_URL || null
  });
});

app.get('/api/tenants', requireAuth, async (req, res, next) => {
  try {
    if (!isPlatformAdmin(req.user)) {
      return res.json({ ok: true, tenants: [req.user.tenant] });
    }
    const result = await pool.query(
      `select t.id, t.name, t.plan, t.status, count(u.id)::int as users
         from tenants t
         left join app_users u on u.tenant_id = t.id
        group by t.id
        order by t.created_at desc`
    );
    res.json({ ok: true, tenants: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/tenants', requirePlatformAdmin, async (req, res, next) => {
  const name = cleanString(req.body?.name);
  const plan = cleanString(req.body?.plan) || 'Starter';
  const status = cleanString(req.body?.status) || 'Active';
  const adminName = cleanString(req.body?.adminName);
  const adminEmail = cleanString(req.body?.adminEmail)?.toLowerCase();
  const adminPassword = String(req.body?.adminPassword || '');
  if (!name) return res.status(400).json({ ok: false, error: 'company name is required' });

  const tenantId = slugify(req.body?.id || name);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const tenant = await client.query(
      `insert into tenants (id, name, plan, status)
       values ($1,$2,$3,$4)
       returning id, name, plan, status`,
      [tenantId, name, plan, status]
    );
    let user = null;
    if (adminName && adminEmail && adminPassword) {
      user = await createUser(client, {
        tenantId,
        name: adminName,
        email: adminEmail,
        password: adminPassword,
        role: 'Tenant Admin',
        platformRole: 'tenant_admin',
        team: 'Administration'
      });
    }
    await client.query('commit');
    res.status(201).json({ ok: true, tenant: tenant.rows[0], user });
  } catch (error) {
    await client.query('rollback');
    next(error);
  } finally {
    client.release();
  }
});

app.patch('/api/admin/tenants/:id', requirePlatformAdmin, async (req, res, next) => {
  const name = cleanString(req.body?.name);
  const plan = cleanString(req.body?.plan);
  const status = cleanString(req.body?.status);
  if (status && !['Active', 'Restricted', 'Review'].includes(status)) {
    return res.status(400).json({ ok: false, error: 'status must be Active, Restricted, or Review' });
  }

  try {
    const result = await pool.query(
      `update tenants
          set name = coalesce($2, name),
              plan = coalesce($3, plan),
              status = coalesce($4, status)
        where id = $1
        returning id, name, plan, status`,
      [req.params.id, name || null, plan || null, status || null]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'company not found' });
    res.json({ ok: true, tenant: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/tenants/:id', requirePlatformAdmin, async (req, res, next) => {
  if (req.params.id === req.user.tenantId) {
    return res.status(400).json({ ok: false, error: 'You cannot delete the company your admin account belongs to' });
  }

  try {
    const result = await pool.query('delete from tenants where id = $1 returning id, name', [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'company not found' });
    res.json({ ok: true, tenant: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/users', requireAuth, async (req, res, next) => {
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query(
      `select id, tenant_id as "tenantId", name, email, role, platform_role as "platformRole",
              team, initials, is_active as "isActive", created_at as "createdAt"
         from app_users
        where tenant_id = $1
        order by created_at desc`,
      [tenantId]
    );
    res.json({ ok: true, users: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users', requireAuth, async (req, res, next) => {
  try {
    const tenantId = getScopedTenantId(req);
    if (!canManageTenantUsers(req.user, tenantId)) {
      return res.status(403).json({ ok: false, error: 'Only platform or tenant admins can create users' });
    }
    const user = await createUser(pool, {
      tenantId,
      name: cleanString(req.body?.name),
      email: cleanString(req.body?.email)?.toLowerCase(),
      password: String(req.body?.password || ''),
      role: cleanString(req.body?.role) || 'Tenant User',
      platformRole: normalizePlatformRole(req.body?.platformRole || req.body?.role),
      team: cleanString(req.body?.team)
    });
    res.status(201).json({ ok: true, user });
  } catch (error) {
    next(error);
  }
});

app.post('/api/admin/users/:id/password', requireAuth, async (req, res, next) => {
  const newPassword = String(req.body?.newPassword || '');
  if (newPassword.length < 8) return res.status(400).json({ ok: false, error: 'New password must be at least 8 characters' });

  try {
    const userResult = await pool.query(
      `select id, tenant_id as "tenantId", name, email, role, platform_role as "platformRole",
              team, initials, is_active as "isActive", created_at as "createdAt"
         from app_users
        where id = $1`,
      [req.params.id]
    );
    if (!userResult.rowCount) return res.status(404).json({ ok: false, error: 'user not found' });
    const target = userResult.rows[0];
    if (!canManageTenantUsers(req.user, target.tenantId)) {
      return res.status(403).json({ ok: false, error: 'Only platform or tenant admins can change this user password' });
    }
    if (target.platformRole === 'platform_admin' && !isPlatformAdmin(req.user)) {
      return res.status(403).json({ ok: false, error: 'Platform admin password can only be changed by that admin' });
    }
    await pool.query('update app_users set password_hash = $2, updated_at = now() where id = $1', [target.id, hashPassword(newPassword)]);
    res.json({ ok: true, user: target });
  } catch (error) {
    next(error);
  }
});

app.get('/api/social/accounts', requireAuth, async (req, res, next) => {
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query(
      `select id, tenant_id as "tenantId", platform, handle, credentials, status,
              created_at as "createdAt", updated_at as "updatedAt"
         from social_accounts
        where tenant_id = $1
        order by platform`,
      [tenantId]
    );
    res.json({ ok: true, accounts: result.rows.map(maskSocialAccount) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/social/accounts', requireAuth, async (req, res, next) => {
  try {
    const tenantId = getScopedTenantId(req);
    if (!canManageTenantUsers(req.user, tenantId)) {
      return res.status(403).json({ ok: false, error: 'Only platform or tenant admins can configure social accounts' });
    }
    const platform = cleanString(req.body?.platform);
    const handle = cleanString(req.body?.handle) || '';
    const credentials = normalizeCredentials(req.body?.credentials);
    const status = cleanString(req.body?.status) || 'Active';
    if (!platform) return res.status(400).json({ ok: false, error: 'platform is required' });

    const result = await pool.query(
      `insert into social_accounts (tenant_id, platform, handle, credentials, status, created_by)
       values ($1,$2,$3,$4::jsonb,$5,$6)
       on conflict (tenant_id, platform) do update
          set handle = excluded.handle,
              credentials = social_accounts.credentials || excluded.credentials,
              status = excluded.status,
              updated_at = now()
       returning id, tenant_id as "tenantId", platform, handle, credentials, status,
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [tenantId, platform, handle, JSON.stringify(credentials), status, req.user.id]
    );
    res.status(201).json({ ok: true, account: maskSocialAccount(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/social/accounts/:id', requireAuth, async (req, res, next) => {
  try {
    const tenantId = getScopedTenantId(req);
    if (!canManageTenantUsers(req.user, tenantId)) {
      return res.status(403).json({ ok: false, error: 'Only platform or tenant admins can remove social accounts' });
    }
    const result = await pool.query(
      'delete from social_accounts where id = $1 and tenant_id = $2 returning id',
      [req.params.id, tenantId]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'social account not found' });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/ai/ollama/status', requireAuth, async (_req, res) => {
  const result = await getOllamaTags();
  res.status(result.ok ? 200 : 502).json(result);
});

app.get('/api/ai/ollama/models', requireAuth, async (_req, res) => {
  const result = await getOllamaTags();
  res.status(result.ok ? 200 : 502).json({
    ok: result.ok,
    baseUrl: result.baseUrl,
    models: result.models || [],
    count: result.models?.length || 0,
    error: result.error
  });
});

app.get('/api/ai/ollama/installed', requireAuth, async (_req, res) => {
  const result = await getOllamaTags();
  res.status(result.ok ? 200 : 502).json({
    ok: result.ok,
    baseUrl: result.baseUrl,
    installed: result.models || [],
    count: result.models?.length || 0,
    error: result.error
  });
});

app.post('/api/ai/ollama/test', requirePlatformAdmin, async (req, res) => {
  const { model, prompt, temperature } = req.body || {};
  if (!model || !prompt) return res.status(400).json({ ok: false, error: 'model and prompt are required' });

  try {
    const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: Number(temperature ?? 0.4) }
      })
    });
    const body = await safeJson(response);
    if (!response.ok) return res.status(response.status).json({ ok: false, error: body.error || 'Ollama request failed' });
    res.json({ ok: true, response: body.response || '', raw: body });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message });
  }
});

app.post('/api/ai/ollama/pull', requirePlatformAdmin, async (req, res) => {
  const { model } = req.body || {};
  if (!model) return res.status(400).json({ ok: false, error: 'model is required' });

  try {
    const response = await fetch(`${ollamaBaseUrl}/api/pull`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, stream: false })
    });
    const body = await safeJson(response);
    const installed = await getOllamaTags();
    res.status(response.ok ? 202 : response.status).json({
      ok: response.ok,
      model,
      result: body,
      installed: installed.models || [],
      error: response.ok ? undefined : body.error || 'Ollama model pull failed'
    });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message });
  }
});

app.get('/api/ai/agents', requireAuth, async (req, res, next) => {
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query(
      `select id, tenant_id as "tenantId", name, type, model, temperature, approval_rule as "approvalRule",
              status, tools, system_prompt as "systemPrompt"
         from ai_agents
        where tenant_id = $1
        order by created_at`,
      [tenantId]
    );
    res.json({ ok: true, agents: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/ai/agents', requirePlatformAdmin, async (req, res, next) => {
  const agent = normalizeAgent(req.body);
  const tenantId = req.body?.tenantId || defaultTenantId;
  if (!agent.name || !agent.model) return res.status(400).json({ ok: false, error: 'name and model are required' });

  try {
    const result = await pool.query(
      `insert into ai_agents
        (tenant_id, name, type, model, temperature, approval_rule, status, tools, system_prompt)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning id, tenant_id as "tenantId", name, type, model, temperature,
                 approval_rule as "approvalRule", status, tools, system_prompt as "systemPrompt"`,
      [tenantId, agent.name, agent.type, agent.model, agent.temperature, agent.approvalRule, agent.status, agent.tools, agent.systemPrompt]
    );
    res.status(201).json({ ok: true, agent: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.put('/api/ai/agents/:id', requirePlatformAdmin, async (req, res, next) => {
  const agent = normalizeAgent(req.body);
  try {
    const result = await pool.query(
      `update ai_agents
          set name = coalesce($2, name),
              type = coalesce($3, type),
              model = coalesce($4, model),
              temperature = coalesce($5, temperature),
              approval_rule = coalesce($6, approval_rule),
              status = coalesce($7, status),
              tools = coalesce($8, tools),
              system_prompt = coalesce($9, system_prompt),
              updated_at = now()
        where id = $1
        returning id, tenant_id as "tenantId", name, type, model, temperature,
                  approval_rule as "approvalRule", status, tools, system_prompt as "systemPrompt"`,
      [req.params.id, agent.name, agent.type, agent.model, agent.temperature, agent.approvalRule, agent.status, agent.tools, agent.systemPrompt]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'agent not found' });
    res.json({ ok: true, agent: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/ai/agents/:id/run', requireAuth, async (req, res, next) => {
  const tenantId = getScopedTenantId(req);
  try {
    const agentResult = await pool.query('select * from ai_agents where id = $1 and tenant_id = $2', [req.params.id, tenantId]);
    if (!agentResult.rowCount) return res.status(404).json({ ok: false, error: 'agent not found' });

    const agent = agentResult.rows[0];
    const prompt = req.body?.prompt || 'Prepare a short marketing recommendation.';
    const output = await runAgent(agent, prompt, tenantId);
    const approval = await createApproval({
      tenantId,
      title: `${agent.name} draft`,
      sourceAgentId: agent.id,
      risk: req.body?.risk || 'Medium',
      prompt,
      output,
      status: 'pending'
    });

    res.json({ ok: true, output, approval });
  } catch (error) {
    next(error);
  }
});

app.get('/api/paperclip/status', requireAuth, async (_req, res) => {
  const result = await checkPaperclip();
  res.status(result.ok ? 200 : 502).json(result);
});

app.get('/api/paperclip/models', requireAuth, async (_req, res) => {
  const result = await getPaperclipModels();
  res.status(result.ok ? 200 : 502).json(result);
});

app.post('/api/paperclip/tasks', requirePlatformAdmin, async (req, res, next) => {
  const tenantId = req.body?.tenantId || defaultTenantId;
  const payload = {
    tenantId,
    task: req.body?.task || 'generic_ai_task',
    model: req.body?.model,
    input: req.body?.input || {},
    requireApproval: req.body?.requireApproval !== false
  };

  try {
    const paperclipResponse = await forwardToPaperclip(payload);
    const approval = await createApproval({
      tenantId,
      title: payload.task,
      sourceAgentId: null,
      risk: req.body?.risk || 'Medium',
      prompt: JSON.stringify(payload.input),
      output: JSON.stringify(paperclipResponse),
      status: 'pending'
    });
    res.status(202).json({ ok: true, task: paperclipResponse, approval });
  } catch (error) {
    next(error);
  }
});

app.get('/api/approvals', requireAuth, async (req, res, next) => {
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query(
      `select a.id, a.title, a.risk, a.status, a.prompt, a.output,
              a.created_at as "createdAt", a.decided_at as "decidedAt",
              ag.name as agent
         from approvals a
         left join ai_agents ag on ag.id = a.source_agent_id
        where a.tenant_id = $1
        order by a.created_at desc`,
      [tenantId]
    );
    res.json({ ok: true, approvals: result.rows });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/approvals/:id', requireAuth, async (req, res, next) => {
  const status = req.body?.status;
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ ok: false, error: 'status must be approved, rejected, or pending' });
  }
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query(
      `update approvals
          set status = $3,
              decided_by = $4,
              decided_at = case when $3 = 'pending' then null else now() end,
              decision_note = $5
        where id = $1 and tenant_id = $2
        returning id, title, risk, status, prompt, output, created_at as "createdAt", decided_at as "decidedAt"`,
      [req.params.id, tenantId, status, req.user.email, req.body?.decisionNote || null]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'approval not found' });
    res.json({ ok: true, approval: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ ok: false, error: error.message });
});

ensureSchema()
  .then(() => {
    app.listen(port, () => {
      console.log(`Octave CRM API listening on ${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to prepare database schema', error);
    process.exit(1);
  });

async function requireAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const payload = verifyToken(token);
    if (!payload) return res.status(401).json({ ok: false, error: 'Authentication required' });
    const result = await pool.query(
      `select u.id, u.tenant_id, u.name, u.email, u.role, u.platform_role,
              u.team, u.initials, u.is_active, t.name as tenant_name, t.plan, t.status as tenant_status
         from app_users u
         join tenants t on t.id = u.tenant_id
        where u.id = $1`,
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user || !user.is_active) return res.status(401).json({ ok: false, error: 'Authentication required' });
    if (user.tenant_status === 'Restricted' && user.platform_role !== 'platform_admin') {
      return res.status(403).json({ ok: false, error: 'Company access is restricted. Contact the platform admin.' });
    }
    req.user = toSafeUser(user);
    next();
  } catch (error) {
    next(error);
  }
}

function requirePlatformAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (!isPlatformAdmin(req.user)) return res.status(403).json({ ok: false, error: 'Platform admin access required' });
    next();
  });
}

async function checkDatabase() {
  try {
    await pool.query('select 1');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function ensureSchema() {
  await pool.query(`
    create extension if not exists "pgcrypto";
    create table if not exists tenants (
      id text primary key,
      name text not null,
      plan text not null default 'Starter',
      status text not null default 'Active',
      created_at timestamptz not null default now()
    );
    create table if not exists app_users (
      id uuid primary key default gen_random_uuid(),
      tenant_id text not null references tenants(id) on delete cascade,
      name text not null,
      email text unique,
      role text not null,
      team text,
      initials text,
      created_at timestamptz not null default now()
    );
    alter table app_users add column if not exists password_hash text;
    alter table app_users add column if not exists platform_role text not null default 'tenant_user';
    alter table app_users add column if not exists is_active boolean not null default true;
    alter table app_users add column if not exists updated_at timestamptz not null default now();
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
  `);

  await pool.query(
    `insert into tenants (id, name, plan, status)
     values ($1, $2, $3, $4)
     on conflict (id) do nothing`,
    [defaultTenantId, 'Northstar Wellness', 'Growth', 'Active']
  );

  await pool.query(
    `insert into app_users (tenant_id, name, email, password_hash, role, platform_role, team, initials)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (email) do update
       set password_hash = excluded.password_hash,
           role = excluded.role,
           platform_role = excluded.platform_role,
           is_active = true,
           updated_at = now()`,
    [defaultTenantId, 'Platform Admin', 'admin@octave.local', '1098110b7acd108052bb6381081afe67:aadd845132f93b9f486eda8e1efd2582d3e031cf9f621692368283ac678ca3d31dabe73f65b4c935b100ba11b3fd9d9f1213c39e02254338a326d27db06cd832', 'Platform Admin', 'platform_admin', 'System', 'PA']
  );

  await pool.query(
    `update app_users
        set password_hash = coalesce(password_hash, $1),
            platform_role = case when role = 'Tenant Admin' then 'tenant_admin' else platform_role end,
            is_active = true,
            updated_at = now()
      where lower(email) = 'ananya@example.com'`,
    ['04c9685156f7f8f090f88d1ca8287aa3:9aed23c934104f2bb1e58d846efb1cc12772a0af0758d5e3bcffc729b1ca094979529e967b1868b04c4e1059b72885da571e0152bde2e1db899712608590a3fc']
  );

  await pool.query(
    `update app_users
        set password_hash = coalesce(password_hash, $1),
            platform_role = 'tenant_user',
            is_active = true,
            updated_at = now()
      where lower(email) in ('karan@example.com', 'mira@example.com', 'dev@example.com')`,
    ['8da7c471aeae6572f0c6d65ac107ea6b:f10adcf9ffa987f02fe0849cc3006c1b91b9a2f18b5b974e09a77d4136a32636a581c6201e652e5190b1c0fd45177e65862f51142cc9c0e75284ff3fbb1911ac']
  );
}

async function getOllamaTags() {
  try {
    const response = await fetch(`${ollamaBaseUrl}/api/tags`);
    const body = await safeJson(response);
    if (!response.ok) return { ok: false, error: body.error || 'Ollama tags failed' };
    return {
      ok: true,
      baseUrl: ollamaBaseUrl,
      models: (body.models || []).map((model) => ({ name: model.name, modifiedAt: model.modified_at, size: model.size }))
    };
  } catch (error) {
    return { ok: false, baseUrl: ollamaBaseUrl, error: error.message };
  }
}

async function checkPaperclip() {
  try {
    const response = await fetch(`${paperclipBaseUrl}/health`);
    const body = await safeJson(response);
    return { ok: response.ok, baseUrl: paperclipBaseUrl, status: response.status, ...body };
  } catch (error) {
    return { ok: false, baseUrl: paperclipBaseUrl, error: error.message };
  }
}

async function getPaperclipModels() {
  try {
    const response = await fetch(`${paperclipBaseUrl}/api/models`);
    const body = await safeJson(response);
    return { ok: response.ok, baseUrl: paperclipBaseUrl, status: response.status, ...body };
  } catch (error) {
    return { ok: false, baseUrl: paperclipBaseUrl, error: error.message };
  }
}

async function runAgent(agent, prompt, tenantId) {
  const paperclip = await tryPaperclipAgent(agent, prompt, tenantId);
  if (paperclip.ok) return paperclip.output;

  const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: agent.model,
      prompt: `${agent.system_prompt || ''}\n\n${prompt}`,
      stream: false,
      options: { temperature: Number(agent.temperature || 0.4) }
    })
  });
  const body = await safeJson(response);
  if (!response.ok) throw new Error(body.error || 'Ollama generation failed');
  return body.response || '';
}

async function tryPaperclipAgent(agent, prompt, tenantId) {
  try {
    const response = await fetch(`${paperclipBaseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId, agent, prompt, requireApproval: true })
    });
    if (!response.ok) return { ok: false };
    const body = await safeJson(response);
    return { ok: true, output: body.output || JSON.stringify(body) };
  } catch {
    return { ok: false };
  }
}

async function forwardToPaperclip(payload) {
  try {
    const response = await fetch(`${paperclipBaseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await safeJson(response);
    if (!response.ok) return { status: 'queued-locally', paperclipAvailable: false, payload, error: body.error };
    return body;
  } catch (error) {
    return { status: 'queued-locally', paperclipAvailable: false, payload, error: error.message };
  }
}

async function createApproval({ tenantId, title, sourceAgentId, risk, prompt, output, status }) {
  const result = await pool.query(
    `insert into approvals (tenant_id, source_agent_id, title, risk, prompt, output, status)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning id, title, risk, status, prompt, output, created_at as "createdAt"`,
    [tenantId, sourceAgentId, title || 'AI generated draft', risk, prompt, output, status]
  );
  return result.rows[0];
}

async function createUser(client, { tenantId, name, email, password, role, platformRole, team }) {
  if (!tenantId || !name || !email || !password) throw new Error('tenantId, name, email, and password are required');
  const result = await client.query(
    `insert into app_users (tenant_id, name, email, password_hash, role, platform_role, team, initials)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     returning id, tenant_id as "tenantId", name, email, role, platform_role as "platformRole",
               team, initials, is_active as "isActive", created_at as "createdAt"`,
    [tenantId, name, email, hashPassword(password), role, platformRole, team || null, initialsFor(name)]
  );
  return result.rows[0];
}

function normalizeAgent(input = {}) {
  return {
    name: cleanString(input.name),
    type: cleanString(input.type) || 'General',
    model: cleanString(input.model),
    temperature: input.temperature == null ? null : Number(input.temperature),
    approvalRule: cleanString(input.approvalRule || input.approval_rule) || 'Human approval before execution',
    status: cleanString(input.status) || 'Ready',
    tools: Array.isArray(input.tools) ? input.tools : String(input.tools || '').split(',').map((item) => item.trim()).filter(Boolean),
    systemPrompt: cleanString(input.systemPrompt || input.system_prompt) || null
  };
}

function getScopedTenantId(req) {
  if (isPlatformAdmin(req.user)) return req.query.tenantId || req.body?.tenantId || defaultTenantId;
  return req.user.tenantId;
}

function canManageTenantUsers(user, tenantId) {
  return isPlatformAdmin(user) || (user.tenantId === tenantId && user.platformRole === 'tenant_admin');
}

function isPlatformAdmin(user) {
  return user?.platformRole === 'platform_admin';
}

function normalizePlatformRole(value) {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('tenant_admin') || raw.includes('tenant admin')) return 'tenant_admin';
  if (raw.includes('approver')) return 'approver';
  return 'tenant_user';
}

function toSafeUser(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    email: row.email,
    role: row.role,
    platformRole: row.platform_role,
    team: row.team,
    initials: row.initials || initialsFor(row.name),
    tenant: {
      id: row.tenant_id,
      name: row.tenant_name,
      plan: row.plan,
      status: row.tenant_status
    }
  };
}

function normalizeCredentials(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input)
      .map(([key, value]) => [cleanString(key), typeof value === 'string' ? value.trim() : value])
      .filter(([key, value]) => key && value !== undefined && value !== null && value !== '')
  );
}

function maskSocialAccount(row) {
  const credentials = row.credentials && typeof row.credentials === 'object' ? row.credentials : {};
  return {
    id: row.id,
    tenantId: row.tenantId,
    platform: row.platform,
    handle: row.handle,
    status: row.status,
    credentialKeys: Object.keys(credentials),
    hasCredentials: Object.keys(credentials).length > 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function signToken(payload) {
  const body = base64url(JSON.stringify({ ...payload, exp: Date.now() + 1000 * 60 * 60 * 12 }));
  const signature = createHmac('sha256', appSecret).update(body).digest('base64url');
  return `${body}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, signature] = token.split('.');
  const expected = createHmac('sha256', appSecret).update(body).digest('base64url');
  if (!timingEqual(signature, expected)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (!payload.exp || payload.exp < Date.now()) return null;
  return payload;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  const test = scryptSync(password, salt, 64);
  return timingEqual(Buffer.from(hash, 'hex'), test);
}

function timingEqual(a, b) {
  const left = Buffer.isBuffer(a) ? a : Buffer.from(String(a));
  const right = Buffer.isBuffer(b) ? b : Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function slugify(value) {
  const slug = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || `tenant-${Date.now()}`;
}

function initialsFor(name = '') {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : value;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
