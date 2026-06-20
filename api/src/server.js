import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import nodemailer from 'nodemailer';
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
              u.team, u.initials, u.avatar_url, u.is_active, t.name as tenant_name, t.plan,
              t.status as tenant_status, t.logo_url as tenant_logo_url
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
      `select t.id, t.name, t.plan, t.status, t.logo_url as "logoUrl", count(u.id)::int as users
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
  const logoUrl = cleanString(req.body?.logoUrl) || null;
  if (!name) return res.status(400).json({ ok: false, error: 'company name is required' });

  const tenantId = slugify(req.body?.id || name);
  const client = await pool.connect();
  try {
    await client.query('begin');
    const tenant = await client.query(
      `insert into tenants (id, name, plan, status)
       values ($1,$2,$3,$4)
       returning id, name, plan, status, logo_url as "logoUrl"`,
      [tenantId, name, plan, status]
    );
    if (logoUrl) {
      await client.query('update tenants set logo_url = $2 where id = $1', [tenantId, logoUrl]);
      tenant.rows[0].logoUrl = logoUrl;
    }
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
    const emailDelivery = user ? await sendCredentialEmail({
      tenantId: null,
      to: adminEmail,
      name: adminName,
      email: adminEmail,
      password: adminPassword,
      createdBy: req.user,
      tenant: tenant.rows[0]
    }) : { sent: false, skipped: true, reason: 'tenant admin credentials not provided' };
    res.status(201).json({ ok: true, tenant: tenant.rows[0], user, emailDelivery });
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
  const logoUrl = cleanString(req.body?.logoUrl);
  if (status && !['Active', 'Restricted', 'Review'].includes(status)) {
    return res.status(400).json({ ok: false, error: 'status must be Active, Restricted, or Review' });
  }

  try {
    const result = await pool.query(
      `update tenants
          set name = coalesce($2, name),
              plan = coalesce($3, plan),
              status = coalesce($4, status),
              logo_url = coalesce($5, logo_url)
        where id = $1
        returning id, name, plan, status, logo_url as "logoUrl"`,
      [req.params.id, name || null, plan || null, status || null, logoUrl || null]
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
              team, initials, avatar_url as "avatarUrl", is_active as "isActive", created_at as "createdAt"
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
      team: cleanString(req.body?.team),
      avatarUrl: cleanString(req.body?.avatarUrl) || null
    });
    const tenantResult = await pool.query('select id, name, plan, status, logo_url as "logoUrl" from tenants where id = $1', [tenantId]);
    const emailDelivery = await sendCredentialEmail({
      tenantId: isPlatformAdmin(req.user) ? null : tenantId,
      to: user.email,
      name: user.name,
      email: user.email,
      password: String(req.body?.password || ''),
      createdBy: req.user,
      tenant: tenantResult.rows[0]
    });
    res.status(201).json({ ok: true, user, emailDelivery });
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
              team, initials, avatar_url as "avatarUrl", is_active as "isActive", created_at as "createdAt"
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

app.get('/api/email/config', requireAuth, async (req, res, next) => {
  try {
    const tenantId = getEmailConfigTenantId(req);
    if (!canManageEmailConfig(req.user, tenantId)) {
      return res.status(403).json({ ok: false, error: 'Email configuration access denied' });
    }
    const config = await getEmailConfig(tenantId);
    res.json({ ok: true, config: maskEmailConfig(config, tenantId) });
  } catch (error) {
    next(error);
  }
});

app.put('/api/email/config', requireAuth, async (req, res, next) => {
  try {
    const tenantId = getEmailConfigTenantId(req);
    if (!canManageEmailConfig(req.user, tenantId)) {
      return res.status(403).json({ ok: false, error: 'Email configuration access denied' });
    }
    const config = normalizeEmailConfig(req.body);
    const result = await pool.query(
      `insert into email_configs
        (tenant_id, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass, from_email, from_name, enabled, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       on conflict (tenant_id) do update
          set smtp_host = excluded.smtp_host,
              smtp_port = excluded.smtp_port,
              smtp_secure = excluded.smtp_secure,
              smtp_user = excluded.smtp_user,
              smtp_pass = coalesce(excluded.smtp_pass, email_configs.smtp_pass),
              from_email = excluded.from_email,
              from_name = excluded.from_name,
              enabled = excluded.enabled,
              updated_by = excluded.updated_by,
              updated_at = now()
       returning id, tenant_id as "tenantId", smtp_host as "smtpHost", smtp_port as "smtpPort",
                 smtp_secure as "smtpSecure", smtp_user as "smtpUser", smtp_pass as "smtpPass",
                 from_email as "fromEmail", from_name as "fromName", enabled`,
      [tenantId || '__platform__', config.smtpHost, config.smtpPort, config.smtpSecure, config.smtpUser, config.smtpPass || null, config.fromEmail, config.fromName, config.enabled, req.user.id]
    );
    res.json({ ok: true, config: maskEmailConfig(result.rows[0], tenantId) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/email/test', requireAuth, async (req, res, next) => {
  try {
    const tenantId = getEmailConfigTenantId(req);
    if (!canManageEmailConfig(req.user, tenantId)) {
      return res.status(403).json({ ok: false, error: 'Email configuration access denied' });
    }
    const delivery = await sendMailWithConfig({
      tenantId,
      to: cleanString(req.body?.to) || req.user.email,
      subject: 'Octave CRM email test',
      text: 'Your Octave CRM email configuration is working.',
      html: '<p>Your Octave CRM email configuration is working.</p>'
    });
    res.status(delivery.sent ? 200 : 400).json({ ok: delivery.sent, delivery });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/settings/profile', requireAuth, async (req, res, next) => {
  try {
    const tenantLogoUrl = cleanString(req.body?.tenantLogoUrl);
    const avatarUrl = cleanString(req.body?.avatarUrl);
    const tenantId = getScopedTenantId(req);
    if (tenantLogoUrl && !canManageTenantUsers(req.user, tenantId)) {
      return res.status(403).json({ ok: false, error: 'Only platform or tenant admins can update the company logo' });
    }
    if (tenantLogoUrl) await pool.query('update tenants set logo_url = $2 where id = $1', [tenantId, tenantLogoUrl]);
    if (avatarUrl) await pool.query('update app_users set avatar_url = $2, updated_at = now() where id = $1', [req.user.id, avatarUrl]);
    const refreshed = await loadUserById(req.user.id);
    res.json({ ok: true, user: refreshed });
  } catch (error) {
    next(error);
  }
});

app.post('/api/ai/framework/activate', requirePlatformAdmin, async (req, res, next) => {
  const tenantId = req.body?.tenantId || defaultTenantId;
  try {
    const model = cleanString(req.body?.model) || await pickDefaultModel();
    const templates = [
      ['Campaign Strategist', 'Planning', 0.4, ['Market research', 'Audience map', 'Budget split'], 'You are a marketing campaign strategist. Create concise plans for human approval.'],
      ['Social Copywriter', 'Content', 0.7, ['Caption draft', 'Hashtag set', 'Tone rewrite'], 'You write clear social media copy for human approval.'],
      ['Lead Nurture Agent', 'Follow-up', 0.3, ['Email sequence', 'CRM notes', 'Follow-up tasks'], 'You create sales follow-up drafts and CRM notes for human approval.'],
      ['Approval Guard', 'Governance', 0.2, ['Risk review', 'Policy check'], 'You review AI outputs for risks before a human decides.']
    ];
    for (const [name, type, temperature, tools, systemPrompt] of templates) {
      await pool.query(
        `insert into ai_agents (tenant_id, name, type, model, temperature, approval_rule, status, tools, system_prompt)
         select $1,$2,$3,$4,$5,'Human approval before execution','Ready',$6,$7
          where not exists (
            select 1 from ai_agents where tenant_id = $1 and name = $2
          )`,
        [tenantId, name, type, model, temperature, tools, systemPrompt]
      );
    }
    const result = await pool.query(
      `select id, tenant_id as "tenantId", name, type, model, temperature, approval_rule as "approvalRule",
              status, tools, system_prompt as "systemPrompt"
         from ai_agents
        where tenant_id = $1
        order by created_at`,
      [tenantId]
    );
    res.json({ ok: true, tenantId, model, agents: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/dashboard/summary', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  const tenantId = getScopedTenantId(req);
  try {
    const [campaigns, leads, approvals, tasks] = await Promise.all([
      pool.query('select count(*)::int as count from campaigns where tenant_id = $1', [tenantId]),
      pool.query('select count(*)::int as count from leads where tenant_id = $1', [tenantId]),
      pool.query("select count(*)::int as count from approvals where tenant_id = $1 and status = 'pending'", [tenantId]),
      pool.query("select count(*)::int as count from follow_up_tasks where tenant_id = $1 and status <> 'Done'", [tenantId])
    ]);
    res.json({
      ok: true,
      summary: {
        campaigns: campaigns.rows[0].count,
        leads: leads.rows[0].count,
        approvals: approvals.rows[0].count,
        tasks: tasks.rows[0].count
      }
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/campaigns', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query(
      `select c.id, c.name, c.stage, c.progress, c.budget, c.leads_count as "leadsCount",
              c.channels, c.created_at as "createdAt", c.updated_at as "updatedAt",
              coalesce(u.name, 'Unassigned') as owner
         from campaigns c
         left join app_users u on u.id = c.owner_user_id
        where c.tenant_id = $1
        order by c.updated_at desc, c.created_at desc`,
      [tenantId]
    );
    res.json({ ok: true, campaigns: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/campaigns', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const data = normalizeCampaign(req.body);
    if (!data.name) return res.status(400).json({ ok: false, error: 'campaign name is required' });
    const result = await pool.query(
      `insert into campaigns (tenant_id, name, owner_user_id, stage, progress, budget, leads_count, channels)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       returning id, name, stage, progress, budget, leads_count as "leadsCount", channels,
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [tenantId, data.name, req.user.id, data.stage, data.progress, data.budget, data.leadsCount, data.channels]
    );
    res.status(201).json({ ok: true, campaign: { ...result.rows[0], owner: req.user.name } });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/campaigns/:id', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const data = normalizeCampaignPatch(req.body);
    const result = await pool.query(
      `update campaigns
          set name = coalesce($3, name),
              stage = coalesce($4, stage),
              progress = coalesce($5, progress),
              budget = coalesce($6, budget),
              leads_count = coalesce($7, leads_count),
              channels = coalesce($8, channels),
              updated_at = now()
        where id = $1 and tenant_id = $2
        returning id, name, stage, progress, budget, leads_count as "leadsCount", channels,
                  created_at as "createdAt", updated_at as "updatedAt"`,
      [req.params.id, tenantId, data.name, data.stage, data.progress, data.budget, data.leadsCount, data.channels]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'campaign not found' });
    res.json({ ok: true, campaign: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/campaigns/:id', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const result = await pool.query('delete from campaigns where id = $1 and tenant_id = $2 returning id', [req.params.id, getScopedTenantId(req)]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'campaign not found' });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/leads', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const result = await pool.query(
      `select id, company, contact_name as "contactName", email, score, source, stage,
              next_action as "nextAction", created_at as "createdAt", updated_at as "updatedAt"
         from leads
        where tenant_id = $1
        order by updated_at desc, created_at desc`,
      [getScopedTenantId(req)]
    );
    res.json({ ok: true, leads: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/leads', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const data = normalizeLead(req.body);
    if (!data.company || !data.contactName) return res.status(400).json({ ok: false, error: 'company and contact name are required' });
    const result = await pool.query(
      `insert into leads (tenant_id, company, contact_name, email, score, source, stage, owner_user_id, next_action)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       returning id, company, contact_name as "contactName", email, score, source, stage,
                 next_action as "nextAction", created_at as "createdAt", updated_at as "updatedAt"`,
      [tenantId, data.company, data.contactName, data.email, data.score, data.source, data.stage, req.user.id, data.nextAction]
    );
    res.status(201).json({ ok: true, lead: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/leads/:id', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const data = normalizeLeadPatch(req.body);
    const result = await pool.query(
      `update leads
          set company = coalesce($3, company),
              contact_name = coalesce($4, contact_name),
              email = coalesce($5, email),
              score = coalesce($6, score),
              source = coalesce($7, source),
              stage = coalesce($8, stage),
              next_action = coalesce($9, next_action),
              updated_at = now()
        where id = $1 and tenant_id = $2
        returning id, company, contact_name as "contactName", email, score, source, stage,
                  next_action as "nextAction", created_at as "createdAt", updated_at as "updatedAt"`,
      [req.params.id, getScopedTenantId(req), data.company, data.contactName, data.email, data.score, data.source, data.stage, data.nextAction]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'lead not found' });
    res.json({ ok: true, lead: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/leads/:id', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const result = await pool.query('delete from leads where id = $1 and tenant_id = $2 returning id', [req.params.id, getScopedTenantId(req)]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'lead not found' });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/customers', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const result = await pool.query(
      `select id, name, health, plan, mrr, status, created_at as "createdAt"
         from customers
        where tenant_id = $1
        order by created_at desc`,
      [getScopedTenantId(req)]
    );
    res.json({ ok: true, customers: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/customers', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const data = normalizeCustomer(req.body);
    if (!data.name) return res.status(400).json({ ok: false, error: 'customer name is required' });
    const result = await pool.query(
      `insert into customers (tenant_id, name, health, plan, mrr, status)
       values ($1,$2,$3,$4,$5,$6)
       returning id, name, health, plan, mrr, status, created_at as "createdAt"`,
      [getScopedTenantId(req), data.name, data.health, data.plan, data.mrr, data.status]
    );
    res.status(201).json({ ok: true, customer: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/customers/:id', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const data = normalizeCustomerPatch(req.body);
    const result = await pool.query(
      `update customers
          set name = coalesce($3, name),
              health = coalesce($4, health),
              plan = coalesce($5, plan),
              mrr = coalesce($6, mrr),
              status = coalesce($7, status)
        where id = $1 and tenant_id = $2
        returning id, name, health, plan, mrr, status, created_at as "createdAt"`,
      [req.params.id, getScopedTenantId(req), data.name, data.health, data.plan, data.mrr, data.status]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'customer not found' });
    res.json({ ok: true, customer: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/customers/:id', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const result = await pool.query('delete from customers where id = $1 and tenant_id = $2 returning id', [req.params.id, getScopedTenantId(req)]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'customer not found' });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/follow-ups', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const result = await pool.query(
      `select id, title, due_at as "dueAt", priority, channel, status, created_at as "createdAt"
         from follow_up_tasks
        where tenant_id = $1
        order by coalesce(due_at, created_at) asc`,
      [getScopedTenantId(req)]
    );
    res.json({ ok: true, tasks: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/follow-ups', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const data = normalizeTask(req.body);
    if (!data.title) return res.status(400).json({ ok: false, error: 'task title is required' });
    const result = await pool.query(
      `insert into follow_up_tasks (tenant_id, title, owner_user_id, due_at, priority, channel, status)
       values ($1,$2,$3,$4,$5,$6,$7)
       returning id, title, due_at as "dueAt", priority, channel, status, created_at as "createdAt"`,
      [getScopedTenantId(req), data.title, req.user.id, data.dueAt, data.priority, data.channel, data.status]
    );
    res.status(201).json({ ok: true, task: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/follow-ups/:id', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const data = normalizeTaskPatch(req.body);
    const result = await pool.query(
      `update follow_up_tasks
          set title = coalesce($3, title),
              due_at = coalesce($4, due_at),
              priority = coalesce($5, priority),
              channel = coalesce($6, channel),
              status = coalesce($7, status)
        where id = $1 and tenant_id = $2
        returning id, title, due_at as "dueAt", priority, channel, status, created_at as "createdAt"`,
      [req.params.id, getScopedTenantId(req), data.title, data.dueAt, data.priority, data.channel, data.status]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'follow-up task not found' });
    res.json({ ok: true, task: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/follow-ups/:id', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const result = await pool.query('delete from follow_up_tasks where id = $1 and tenant_id = $2 returning id', [req.params.id, getScopedTenantId(req)]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'follow-up task not found' });
    res.json({ ok: true });
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
  if (isPlatformAdmin(req.user)) {
    return res.status(403).json({ ok: false, error: 'Platform admins cannot run tenant workspace agents' });
  }
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
      status: 'pending',
      actionType: req.body?.actionType || null,
      actionPayload: req.body?.actionPayload || {}
    });

    res.json({ ok: true, output, approval });
  } catch (error) {
    next(error);
  }
});

app.post('/api/ai/workflows', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const workflow = normalizeWorkflow(req.body);
    if (!workflow.type) return res.status(400).json({ ok: false, error: 'workflow type is required' });

    const agent = await findWorkflowAgent(tenantId, workflow.type);
    const prompt = buildWorkflowPrompt(workflow);
    const output = agent ? await runAgent(agent, prompt, tenantId) : await runFallbackWorkflow(prompt);
    const action = buildWorkflowAction(workflow, output);
    const approval = await createApproval({
      tenantId,
      title: workflow.title,
      sourceAgentId: agent?.id || null,
      risk: workflow.risk,
      prompt,
      output,
      status: 'pending',
      actionType: action.type,
      actionPayload: action.payload
    });

    res.status(202).json({ ok: true, output, approval, action });
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
      status: 'pending',
      actionType: req.body?.actionType || null,
      actionPayload: req.body?.actionPayload || {}
    });
    res.status(202).json({ ok: true, task: paperclipResponse, approval });
  } catch (error) {
    next(error);
  }
});

app.get('/api/approvals', requireAuth, async (req, res, next) => {
  if (isPlatformAdmin(req.user)) {
    return res.status(403).json({ ok: false, error: 'Platform admins cannot access tenant approval queues' });
  }
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query(
      `select a.id, a.title, a.risk, a.status, a.prompt, a.output,
              a.action_type as "actionType", a.action_payload as "actionPayload",
              a.execution_result as "executionResult",
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
  if (isPlatformAdmin(req.user)) {
    return res.status(403).json({ ok: false, error: 'Platform admins cannot decide tenant approvals' });
  }
  const status = req.body?.status;
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ ok: false, error: 'status must be approved, rejected, or pending' });
  }
  try {
    const tenantId = getScopedTenantId(req);
    const current = await pool.query('select id, status, action_type, action_payload from approvals where id = $1 and tenant_id = $2', [req.params.id, tenantId]);
    if (!current.rowCount) return res.status(404).json({ ok: false, error: 'approval not found' });
    const execution = status === 'approved' && current.rows[0].status !== 'approved'
      ? await executeApprovalAction({ tenantId, actionType: current.rows[0].action_type, actionPayload: current.rows[0].action_payload, output: req.body?.output })
      : null;
    const result = await pool.query(
      `update approvals
          set status = $3,
              decided_by = $4,
              decided_at = case when $3 = 'pending' then null else now() end,
              decision_note = $5,
              execution_result = coalesce($6::jsonb, execution_result)
        where id = $1 and tenant_id = $2
        returning id, title, risk, status, prompt, output, action_type as "actionType",
                  action_payload as "actionPayload", execution_result as "executionResult",
                  created_at as "createdAt", decided_at as "decidedAt"`,
      [req.params.id, tenantId, status, req.user.email, req.body?.decisionNote || null, execution ? JSON.stringify(execution) : null]
    );
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
              u.team, u.initials, u.avatar_url, u.is_active, t.name as tenant_name, t.plan,
              t.status as tenant_status, t.logo_url as tenant_logo_url
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
    alter table approvals add column if not exists action_type text;
    alter table approvals add column if not exists action_payload jsonb not null default '{}'::jsonb;
    alter table approvals add column if not exists execution_result jsonb;
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

  await seedOperationalData(defaultTenantId);
}

async function seedOperationalData(tenantId) {
  await pool.query(
    `insert into campaigns (tenant_id, name, stage, progress, budget, leads_count, channels)
     select $1, 'Monsoon Wellness Reset', 'Human approval', 72, 180000, 284, array['Instagram','Facebook','Email']
      where not exists (select 1 from campaigns where tenant_id = $1 and name = 'Monsoon Wellness Reset')`,
    [tenantId]
  );
  await pool.query(
    `insert into campaigns (tenant_id, name, stage, progress, budget, leads_count, channels)
     select $1, 'Corporate Health Webinar', 'AI drafting', 48, 85000, 96, array['LinkedIn','Email']
      where not exists (select 1 from campaigns where tenant_id = $1 and name = 'Corporate Health Webinar')`,
    [tenantId]
  );
  await pool.query(
    `insert into leads (tenant_id, company, contact_name, email, score, source, stage, next_action)
     select $1, 'Acme Shared Services', 'Priya N.', 'priya@example.com', 92, 'LinkedIn webinar', 'Qualified', 'Call today 16:00'
      where not exists (select 1 from leads where tenant_id = $1 and company = 'Acme Shared Services')`,
    [tenantId]
  );
  await pool.query(
    `insert into leads (tenant_id, company, contact_name, email, score, source, stage, next_action)
     select $1, 'MetroBuild Group', 'Rohit V.', 'rohit@example.com', 84, 'Facebook lead form', 'Proposal', 'Send pricing deck'
      where not exists (select 1 from leads where tenant_id = $1 and company = 'MetroBuild Group')`,
    [tenantId]
  );
  await pool.query(
    `insert into customers (tenant_id, name, health, plan, mrr, status)
     select $1, 'Northstar Wellness', 91, 'Growth', 120000, 'Expansion ready'
      where not exists (select 1 from customers where tenant_id = $1 and name = 'Northstar Wellness')`,
    [tenantId]
  );
  await pool.query(
    `insert into customers (tenant_id, name, health, plan, mrr, status)
     select $1, 'UrbanEdge Realty', 82, 'Scale', 280000, 'Onboarding'
      where not exists (select 1 from customers where tenant_id = $1 and name = 'UrbanEdge Realty')`,
    [tenantId]
  );
  await pool.query(
    `insert into follow_up_tasks (tenant_id, title, due_at, priority, channel, status)
     select $1, 'Call Acme Shared Services', now() + interval '4 hours', 'High', 'Phone', 'Open'
      where not exists (select 1 from follow_up_tasks where tenant_id = $1 and title = 'Call Acme Shared Services')`,
    [tenantId]
  );
  await pool.query(
    `insert into follow_up_tasks (tenant_id, title, due_at, priority, channel, status)
     select $1, 'Approve webinar nurture email', now() + interval '6 hours', 'High', 'Email', 'Open'
      where not exists (select 1 from follow_up_tasks where tenant_id = $1 and title = 'Approve webinar nurture email')`,
    [tenantId]
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

async function createApproval({ tenantId, title, sourceAgentId, risk, prompt, output, status, actionType, actionPayload }) {
  const result = await pool.query(
    `insert into approvals (tenant_id, source_agent_id, title, risk, prompt, output, status, action_type, action_payload)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     returning id, title, risk, status, prompt, output, action_type as "actionType",
               action_payload as "actionPayload", execution_result as "executionResult",
               created_at as "createdAt"`,
    [tenantId, sourceAgentId, title || 'AI generated draft', risk, prompt, output, status, actionType || null, JSON.stringify(actionPayload || {})]
  );
  return result.rows[0];
}

function normalizeWorkflow(input = {}) {
  return {
    type: cleanString(input.type),
    title: cleanString(input.title) || 'AI workflow draft',
    subject: cleanString(input.subject),
    recipient: cleanString(input.recipient),
    context: cleanString(input.context),
    risk: cleanString(input.risk) || 'Medium',
    campaignName: cleanString(input.campaignName),
    channels: normalizeTextArray(input.channels),
    dueAt: cleanString(input.dueAt) || null,
    priority: cleanString(input.priority) || 'Medium',
    channel: cleanString(input.channel) || 'Email'
  };
}

async function findWorkflowAgent(tenantId, type) {
  const typeMap = {
    campaign_brief: ['Planning', 'Content', 'General'],
    follow_up_email: ['Follow-up', 'Content', 'General'],
    follow_up_task: ['Follow-up', 'Planning', 'General']
  };
  const preferred = typeMap[type] || ['General'];
  const result = await pool.query(
    `select *
       from ai_agents
      where tenant_id = $1 and status <> 'Disabled'
      order by array_position($2::text[], type) nulls last, created_at
      limit 1`,
    [tenantId, preferred]
  );
  return result.rows[0] || null;
}

function buildWorkflowPrompt(workflow) {
  if (workflow.type === 'campaign_brief') {
    return `Create a concise campaign brief for: ${workflow.campaignName || workflow.subject || workflow.title}.
Channels: ${workflow.channels.join(', ') || 'Email, Social'}.
Context: ${workflow.context || 'No extra context.'}
Return a practical brief with audience, offer, message, channel plan, and approval notes.`;
  }
  if (workflow.type === 'follow_up_email') {
    return `Draft a professional follow-up email.
Subject: ${workflow.subject || workflow.title}
Recipient: ${workflow.recipient || 'lead'}
Context: ${workflow.context || 'No extra context.'}
Return only the email body.`;
  }
  if (workflow.type === 'follow_up_task') {
    return `Create a short follow-up task.
Subject: ${workflow.subject || workflow.title}
Context: ${workflow.context || 'No extra context.'}
Return one action-oriented task title.`;
  }
  return workflow.context || workflow.title;
}

async function runFallbackWorkflow(prompt) {
  return `Draft generated for approval:\n\n${prompt}`;
}

function buildWorkflowAction(workflow, output) {
  if (workflow.type === 'campaign_brief') {
    return {
      type: 'create_campaign',
      payload: {
        name: workflow.campaignName || workflow.subject || workflow.title,
        stage: 'Human approval',
        progress: 20,
        budget: 0,
        leadsCount: 0,
        channels: workflow.channels,
        approvalNotes: output
      }
    };
  }
  if (workflow.type === 'follow_up_email') {
    return {
      type: 'send_email',
      payload: {
        to: workflow.recipient,
        subject: workflow.subject || workflow.title,
        text: output,
        html: `<p>${escapeHtml(output).replaceAll('\n', '<br/>')}</p>`
      }
    };
  }
  if (workflow.type === 'follow_up_task') {
    return {
      type: 'create_follow_up_task',
      payload: {
        title: firstLine(output) || workflow.subject || workflow.title,
        dueAt: workflow.dueAt,
        priority: workflow.priority,
        channel: workflow.channel,
        status: 'Open'
      }
    };
  }
  return { type: null, payload: {} };
}

async function executeApprovalAction({ tenantId, actionType, actionPayload }) {
  if (!actionType) return { executed: false, reason: 'No executable action attached' };
  const payload = actionPayload && typeof actionPayload === 'object' ? actionPayload : {};
  if (actionType === 'create_campaign') {
    const data = normalizeCampaign(payload);
    const result = await pool.query(
      `insert into campaigns (tenant_id, name, stage, progress, budget, leads_count, channels)
       values ($1,$2,$3,$4,$5,$6,$7)
       returning id, name`,
      [tenantId, data.name || 'Approved AI Campaign', data.stage, data.progress, data.budget, data.leadsCount, data.channels]
    );
    return { executed: true, actionType, campaign: result.rows[0] };
  }
  if (actionType === 'create_follow_up_task') {
    const data = normalizeTask(payload);
    const result = await pool.query(
      `insert into follow_up_tasks (tenant_id, title, due_at, priority, channel, status)
       values ($1,$2,$3,$4,$5,$6)
       returning id, title`,
      [tenantId, data.title || 'Approved AI follow-up', data.dueAt, data.priority, data.channel, data.status]
    );
    return { executed: true, actionType, task: result.rows[0] };
  }
  if (actionType === 'send_email') {
    if (!payload.to || !payload.subject || !payload.text) return { executed: false, actionType, reason: 'Email action requires recipient, subject, and text' };
    const delivery = await sendMailWithConfig({
      tenantId,
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html || `<p>${escapeHtml(payload.text).replaceAll('\n', '<br/>')}</p>`
    });
    return { executed: Boolean(delivery.sent), actionType, delivery };
  }
  return { executed: false, actionType, reason: 'Unsupported action type' };
}

async function createUser(client, { tenantId, name, email, password, role, platformRole, team, avatarUrl }) {
  if (!tenantId || !name || !email || !password) throw new Error('tenantId, name, email, and password are required');
  const result = await client.query(
    `insert into app_users (tenant_id, name, email, password_hash, role, platform_role, team, initials, avatar_url)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     returning id, tenant_id as "tenantId", name, email, role, platform_role as "platformRole",
               team, initials, avatar_url as "avatarUrl", is_active as "isActive", created_at as "createdAt"`,
    [tenantId, name, email, hashPassword(password), role, platformRole, team || null, initialsFor(name), avatarUrl || null]
  );
  return result.rows[0];
}

async function loadUserById(id) {
  const result = await pool.query(
    `select u.id, u.tenant_id, u.name, u.email, u.role, u.platform_role,
            u.team, u.initials, u.avatar_url, u.is_active, t.name as tenant_name, t.plan,
            t.status as tenant_status, t.logo_url as tenant_logo_url
       from app_users u
       join tenants t on t.id = u.tenant_id
      where u.id = $1`,
    [id]
  );
  return result.rowCount ? toSafeUser(result.rows[0]) : null;
}

async function pickDefaultModel() {
  const tags = await getOllamaTags();
  return tags.models?.[0]?.name || process.env.DEFAULT_OLLAMA_MODEL || 'llama3.1:8b';
}

function getEmailConfigTenantId(req) {
  if (isPlatformAdmin(req.user)) return req.query.tenantId || req.body?.tenantId || null;
  return req.user.tenantId;
}

function canManageEmailConfig(user, tenantId) {
  if (isPlatformAdmin(user)) return true;
  return tenantId === user.tenantId && user.platformRole === 'tenant_admin';
}

function normalizeEmailConfig(input = {}) {
  return {
    smtpHost: cleanString(input.smtpHost),
    smtpPort: Number(input.smtpPort || 587),
    smtpSecure: Boolean(input.smtpSecure),
    smtpUser: cleanString(input.smtpUser),
    smtpPass: cleanString(input.smtpPass),
    fromEmail: cleanString(input.fromEmail),
    fromName: cleanString(input.fromName) || 'Octave CRM',
    enabled: Boolean(input.enabled)
  };
}

function maskEmailConfig(config, tenantId) {
  return {
    tenantId,
    smtpHost: config?.smtpHost || '',
    smtpPort: config?.smtpPort || 587,
    smtpSecure: Boolean(config?.smtpSecure),
    smtpUser: config?.smtpUser || '',
    fromEmail: config?.fromEmail || '',
    fromName: config?.fromName || 'Octave CRM',
    enabled: Boolean(config?.enabled),
    hasPassword: Boolean(config?.smtpPass)
  };
}

async function getEmailConfig(tenantId) {
  const key = tenantId || '__platform__';
  const result = await pool.query(
    `select tenant_id as "tenantId", smtp_host as "smtpHost", smtp_port as "smtpPort",
            smtp_secure as "smtpSecure", smtp_user as "smtpUser", smtp_pass as "smtpPass",
            from_email as "fromEmail", from_name as "fromName", enabled
       from email_configs
      where tenant_id = $1`,
    [key]
  );
  return result.rows[0] || null;
}

async function getBestEmailConfig(tenantId) {
  return await getEmailConfig(tenantId) || await getEmailConfig(null);
}

async function sendCredentialEmail({ tenantId, to, name, email, password, createdBy, tenant }) {
  const subject = `Your Octave CRM login for ${tenant?.name || 'Octave CRM'}`;
  const loginUrl = process.env.PUBLIC_APP_URL || 'http://38.247.188.228:3002';
  const text = [
    `Hello ${name || ''},`,
    '',
    `${createdBy?.name || 'An administrator'} created your Octave CRM account.`,
    `Company: ${tenant?.name || 'Octave CRM'}`,
    `Login URL: ${loginUrl}`,
    `Email: ${email}`,
    `Temporary password: ${password}`,
    '',
    'Please sign in and change your password from Settings.'
  ].join('\n');
  const html = `<p>Hello ${escapeHtml(name || '')},</p><p>${escapeHtml(createdBy?.name || 'An administrator')} created your Octave CRM account.</p><p><strong>Company:</strong> ${escapeHtml(tenant?.name || 'Octave CRM')}<br/><strong>Login URL:</strong> <a href="${loginUrl}">${loginUrl}</a><br/><strong>Email:</strong> ${escapeHtml(email)}<br/><strong>Temporary password:</strong> ${escapeHtml(password)}</p><p>Please sign in and change your password from Settings.</p>`;
  return sendMailWithConfig({ tenantId, to, subject, text, html });
}

async function sendMailWithConfig({ tenantId, to, subject, text, html }) {
  const config = await getBestEmailConfig(tenantId);
  if (!config?.enabled || !config.smtpHost || !config.fromEmail) {
    return { sent: false, skipped: true, reason: 'email configuration is not enabled' };
  }
  try {
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: Number(config.smtpPort || 587),
      secure: Boolean(config.smtpSecure),
      auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass || '' } : undefined
    });
    const info = await transporter.sendMail({
      from: `"${config.fromName || 'Octave CRM'}" <${config.fromEmail}>`,
      to,
      subject,
      text,
      html
    });
    return { sent: true, messageId: info.messageId };
  } catch (error) {
    return { sent: false, error: error.message };
  }
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

function requireTenantWorkspace(req, res) {
  if (isPlatformAdmin(req.user)) {
    res.status(403).json({ ok: false, error: 'Platform admins cannot access tenant workspace operations' });
    return false;
  }
  return true;
}

function normalizeCampaign(input = {}) {
  return {
    name: cleanString(input.name),
    stage: cleanString(input.stage) || 'Draft',
    progress: boundedInt(input.progress, 0, 100, 0),
    budget: boundedNumber(input.budget, 0),
    leadsCount: boundedInt(input.leadsCount ?? input.leads_count, 0, 1000000, 0),
    channels: normalizeTextArray(input.channels)
  };
}

function normalizeCampaignPatch(input = {}) {
  return {
    name: input.name === undefined ? null : cleanString(input.name),
    stage: input.stage === undefined ? null : cleanString(input.stage),
    progress: input.progress === undefined ? null : boundedInt(input.progress, 0, 100, 0),
    budget: input.budget === undefined ? null : boundedNumber(input.budget, 0),
    leadsCount: input.leadsCount === undefined && input.leads_count === undefined ? null : boundedInt(input.leadsCount ?? input.leads_count, 0, 1000000, 0),
    channels: input.channels === undefined ? null : normalizeTextArray(input.channels)
  };
}

function normalizeLead(input = {}) {
  return {
    company: cleanString(input.company),
    contactName: cleanString(input.contactName || input.contact_name),
    email: cleanString(input.email) || null,
    score: boundedInt(input.score, 0, 100, 0),
    source: cleanString(input.source) || null,
    stage: cleanString(input.stage) || 'New',
    nextAction: cleanString(input.nextAction || input.next_action) || null
  };
}

function normalizeLeadPatch(input = {}) {
  return {
    company: input.company === undefined ? null : cleanString(input.company),
    contactName: input.contactName === undefined && input.contact_name === undefined ? null : cleanString(input.contactName || input.contact_name),
    email: input.email === undefined ? null : cleanString(input.email),
    score: input.score === undefined ? null : boundedInt(input.score, 0, 100, 0),
    source: input.source === undefined ? null : cleanString(input.source),
    stage: input.stage === undefined ? null : cleanString(input.stage),
    nextAction: input.nextAction === undefined && input.next_action === undefined ? null : cleanString(input.nextAction || input.next_action)
  };
}

function normalizeCustomer(input = {}) {
  return {
    name: cleanString(input.name),
    health: boundedInt(input.health, 0, 100, 75),
    plan: cleanString(input.plan) || 'Starter',
    mrr: boundedNumber(input.mrr, 0),
    status: cleanString(input.status) || 'Active'
  };
}

function normalizeCustomerPatch(input = {}) {
  return {
    name: input.name === undefined ? null : cleanString(input.name),
    health: input.health === undefined ? null : boundedInt(input.health, 0, 100, 75),
    plan: input.plan === undefined ? null : cleanString(input.plan),
    mrr: input.mrr === undefined ? null : boundedNumber(input.mrr, 0),
    status: input.status === undefined ? null : cleanString(input.status)
  };
}

function normalizeTask(input = {}) {
  return {
    title: cleanString(input.title),
    dueAt: cleanString(input.dueAt || input.due_at) || null,
    priority: cleanString(input.priority) || 'Medium',
    channel: cleanString(input.channel) || 'Email',
    status: cleanString(input.status) || 'Open'
  };
}

function normalizeTaskPatch(input = {}) {
  return {
    title: input.title === undefined ? null : cleanString(input.title),
    dueAt: input.dueAt === undefined && input.due_at === undefined ? null : cleanString(input.dueAt || input.due_at),
    priority: input.priority === undefined ? null : cleanString(input.priority),
    channel: input.channel === undefined ? null : cleanString(input.channel),
    status: input.status === undefined ? null : cleanString(input.status)
  };
}

function normalizeTextArray(value) {
  if (Array.isArray(value)) return value.map(cleanString).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function boundedInt(value, min, max, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function boundedNumber(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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
    avatarUrl: row.avatar_url,
    tenant: {
      id: row.tenant_id,
      name: row.tenant_name,
      plan: row.plan,
      status: row.tenant_status,
      logoUrl: row.tenant_logo_url
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

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function firstLine(value) {
  return String(value || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
