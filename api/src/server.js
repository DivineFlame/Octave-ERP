import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import nodemailer from 'nodemailer';
import pg from 'pg';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const { Pool } = pg;

const app = express();
const port = Number(process.env.PORT || 3000);
const defaultTenantId = process.env.DEFAULT_TENANT_ID || 'northstar';
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
const paperclipBaseUrl = process.env.PAPERCLIP_BASE_URL || 'http://paperclip';
const appSecret = process.env.APP_SECRET || 'change-this-octave-secret';
const uploadDir = process.env.UPLOAD_DIR || '/app/uploads';
const loginAttempts = new Map();

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
app.use(express.json({ limit: '10mb' }));
if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));

app.get('/health', async (_req, res) => {
  const db = await checkDatabase();
  res.status(db.ok ? 200 : 503).json({
    ok: db.ok,
    service: 'octave-crm-api',
    database: db.ok ? 'connected' : db.error
  });
});

app.post('/api/auth/login', rateLimit('login', 12, 15 * 60 * 1000), async (req, res, next) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!email || !password) return res.status(400).json({ ok: false, error: 'email and password are required' });

    const result = await pool.query(
      `select u.id, u.tenant_id, u.name, u.email, u.password_hash, u.role, u.platform_role,
              u.team, u.initials, u.avatar_url, u.is_active, u.must_change_password,
              t.name as tenant_name, t.plan,
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
    await logAudit({ tenantId: safeUser.tenantId, actorUserId: safeUser.id, action: 'auth.login', entityType: 'user', entityId: safeUser.id, details: { email: safeUser.email } });
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
    await pool.query('update app_users set password_hash = $2, must_change_password = false, updated_at = now() where id = $1', [req.user.id, hashPassword(newPassword)]);
    await logAudit({ tenantId: req.user.tenantId, actorUserId: req.user.id, action: 'auth.change_password', entityType: 'user', entityId: req.user.id });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/forgot-password', rateLimit('forgot-password', 6, 15 * 60 * 1000), async (req, res, next) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ ok: false, error: 'email is required' });
  try {
    const result = await pool.query(
      `select u.id, u.tenant_id, u.name, u.email, t.name as tenant_name
         from app_users u
         join tenants t on t.id = u.tenant_id
        where lower(u.email) = $1 and u.is_active = true`,
      [email]
    );
    let delivery = { sent: false, skipped: true, reason: 'If the account exists, reset instructions will be sent.' };
    if (result.rowCount) {
      const user = result.rows[0];
      const token = randomBytes(32).toString('base64url');
      await pool.query(
        `insert into password_reset_tokens (user_id, token_hash, expires_at)
         values ($1,$2,now() + interval '1 hour')`,
        [user.id, hashToken(token)]
      );
      delivery = await sendPasswordResetEmail({ tenantId: user.tenant_id, to: user.email, name: user.name, tenantName: user.tenant_name, token });
      await logAudit({ tenantId: user.tenant_id, actorUserId: user.id, action: 'auth.password_reset_requested', entityType: 'user', entityId: user.id, details: { email: user.email, delivery } });
    }
    res.json({ ok: true, delivery: maskDelivery(delivery) });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/reset-password', async (req, res, next) => {
  const token = String(req.body?.token || '');
  const newPassword = String(req.body?.newPassword || '');
  if (!token || !newPassword) return res.status(400).json({ ok: false, error: 'token and newPassword are required' });
  if (newPassword.length < 8) return res.status(400).json({ ok: false, error: 'New password must be at least 8 characters' });
  try {
    const tokenHash = hashToken(token);
    const result = await pool.query(
      `select prt.id, prt.user_id, u.tenant_id
         from password_reset_tokens prt
         join app_users u on u.id = prt.user_id
        where prt.token_hash = $1 and prt.used_at is null and prt.expires_at > now()`,
      [tokenHash]
    );
    if (!result.rowCount) return res.status(400).json({ ok: false, error: 'Password reset link is invalid or expired' });
    const row = result.rows[0];
    await pool.query('update app_users set password_hash = $2, must_change_password = false, updated_at = now() where id = $1', [row.user_id, hashPassword(newPassword)]);
    await pool.query('update password_reset_tokens set used_at = now() where id = $1', [row.id]);
    await logAudit({ tenantId: row.tenant_id, actorUserId: row.user_id, action: 'auth.password_reset_completed', entityType: 'user', entityId: row.user_id });
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

app.get('/api/system/observability', requireAuth, async (req, res, next) => {
  try {
    if (!canViewOperationalMetrics(req.user, getScopedTenantId(req))) {
      return res.status(403).json({ ok: false, error: 'Admin access required' });
    }
    const tenantId = getScopedTenantId(req);
    const [database, ollama, paperclip, audits, emails, pending, jobs] = await Promise.all([
      checkDatabase(),
      getOllamaTags(),
      checkPaperclip(),
      pool.query('select count(*)::int as count from audit_logs where tenant_id = $1 or $2 = true', [tenantId, isPlatformAdmin(req.user)]),
      pool.query('select status, count(*)::int as count from email_delivery_logs where tenant_id = $1 or $2 = true group by status', [tenantId, isPlatformAdmin(req.user)]),
      pool.query("select count(*)::int as count from approvals where tenant_id = $1 and status = 'pending'", [tenantId]),
      pool.query('select status, count(*)::int as count from scheduled_jobs where tenant_id = $1 group by status', [tenantId])
    ]);
    res.json({
      ok: database.ok && ollama.ok && paperclip.ok,
      services: { database, ollama, paperclip },
      metrics: {
        auditEvents: audits.rows[0]?.count || 0,
        pendingApprovals: pending.rows[0]?.count || 0,
        emailDeliveries: Object.fromEntries(emails.rows.map((row) => [row.status, row.count])),
        scheduledJobs: Object.fromEntries(jobs.rows.map((row) => [row.status, row.count]))
      }
    });
  } catch (error) {
    next(error);
  }
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
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'admin.create_tenant', entityType: 'tenant', entityId: tenantId, details: { name, plan, status, adminEmail } });
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
    await logAudit({ tenantId: req.params.id, actorUserId: req.user.id, action: 'admin.update_tenant', entityType: 'tenant', entityId: req.params.id, details: { name, plan, status, logoUrl } });
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
    await logAudit({ tenantId: null, actorUserId: req.user.id, action: 'admin.delete_tenant', entityType: 'tenant', entityId: result.rows[0].id, details: { name: result.rows[0].name } });
    res.json({ ok: true, tenant: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/users', requireAuth, async (req, res, next) => {
  try {
    const tenantId = getScopedTenantId(req);
    if (!canManageTenantUsers(req.user, tenantId)) {
      return res.status(403).json({ ok: false, error: 'Only tenant admins can view tenant users' });
    }
    const result = await pool.query(
      `select id, tenant_id as "tenantId", name, email, role, platform_role as "platformRole",
              team, initials, avatar_url as "avatarUrl", is_active as "isActive",
              must_change_password as "mustChangePassword", created_at as "createdAt"
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
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'admin.create_user', entityType: 'user', entityId: user.id, details: { email: user.email, role: user.role, delivery: emailDelivery } });
    res.status(201).json({ ok: true, user, emailDelivery });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/admin/users/:id', requireAuth, async (req, res, next) => {
  try {
    const userResult = await pool.query(
      `select id, tenant_id as "tenantId", name, email, role, platform_role as "platformRole",
              team, initials, avatar_url as "avatarUrl", is_active as "isActive",
              must_change_password as "mustChangePassword", created_at as "createdAt"
         from app_users
        where id = $1`,
      [req.params.id]
    );
    if (!userResult.rowCount) return res.status(404).json({ ok: false, error: 'user not found' });
    const target = userResult.rows[0];
    if (!canManageTenantUsers(req.user, target.tenantId)) {
      return res.status(403).json({ ok: false, error: 'Only tenant admins can update tenant users' });
    }
    if (target.platformRole === 'platform_admin' && target.id !== req.user.id) {
      return res.status(403).json({ ok: false, error: 'Platform admin users cannot be updated here' });
    }

    const nextActive = req.body?.isActive === undefined ? target.isActive : Boolean(req.body.isActive);
    const result = await pool.query(
      `update app_users
          set is_active = $2,
              updated_at = now()
        where id = $1
        returning id, tenant_id as "tenantId", name, email, role, platform_role as "platformRole",
                  team, initials, avatar_url as "avatarUrl", is_active as "isActive",
                  must_change_password as "mustChangePassword", created_at as "createdAt"`,
      [target.id, nextActive]
    );
    await logAudit({ tenantId: target.tenantId, actorUserId: req.user.id, action: nextActive ? 'admin.activate_user' : 'admin.deactivate_user', entityType: 'user', entityId: target.id, details: { email: target.email } });
    res.json({ ok: true, user: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/admin/users/:id', requireAuth, async (req, res, next) => {
  try {
    const userResult = await pool.query(
      `select id, tenant_id as "tenantId", email, platform_role as "platformRole"
         from app_users
        where id = $1`,
      [req.params.id]
    );
    if (!userResult.rowCount) return res.status(404).json({ ok: false, error: 'user not found' });
    const target = userResult.rows[0];
    if (!canManageTenantUsers(req.user, target.tenantId)) {
      return res.status(403).json({ ok: false, error: 'Only tenant admins can delete tenant users' });
    }
    if (target.id === req.user.id || target.platformRole === 'platform_admin') {
      return res.status(400).json({ ok: false, error: 'This user cannot be deleted from tenant administration' });
    }
    await pool.query('delete from app_users where id = $1', [target.id]);
    await logAudit({ tenantId: target.tenantId, actorUserId: req.user.id, action: 'admin.delete_user', entityType: 'user', entityId: target.id, details: { email: target.email } });
    res.json({ ok: true });
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
              team, initials, avatar_url as "avatarUrl", is_active as "isActive",
              must_change_password as "mustChangePassword", created_at as "createdAt"
         from app_users
        where id = $1`,
      [req.params.id]
    );
    if (!userResult.rowCount) return res.status(404).json({ ok: false, error: 'user not found' });
    const target = userResult.rows[0];
    if (!canManageTenantUsers(req.user, target.tenantId)) {
      return res.status(403).json({ ok: false, error: 'Only tenant admins can change tenant user passwords' });
    }
    if (target.platformRole === 'platform_admin' && !isPlatformAdmin(req.user)) {
      return res.status(403).json({ ok: false, error: 'Platform admin password can only be changed by that admin' });
    }
    await pool.query('update app_users set password_hash = $2, must_change_password = true, updated_at = now() where id = $1', [target.id, hashPassword(newPassword)]);
    const tenantResult = await pool.query('select id, name, plan, status, logo_url as "logoUrl" from tenants where id = $1', [target.tenantId]);
    const emailDelivery = await sendCredentialEmail({
      tenantId: isPlatformAdmin(req.user) ? null : target.tenantId,
      to: target.email,
      name: target.name,
      email: target.email,
      password: newPassword,
      createdBy: req.user,
      tenant: tenantResult.rows[0]
    });
    await logAudit({ tenantId: target.tenantId, actorUserId: req.user.id, action: 'admin.reset_user_password', entityType: 'user', entityId: target.id, details: { email: target.email, delivery: emailDelivery } });
    res.json({ ok: true, user: { ...target, mustChangePassword: true }, emailDelivery });
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
      [tenantId || '__platform__', config.smtpHost, config.smtpPort, config.smtpSecure, config.smtpUser, config.smtpPass ? encryptSecret(config.smtpPass) : null, config.fromEmail, config.fromName, config.enabled, req.user.id]
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

app.get('/api/admin/audit-logs', requireAuth, async (req, res, next) => {
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query(
      `select al.id, al.action, al.entity_type as "entityType", al.entity_id as "entityId",
              al.details, al.created_at as "createdAt", u.email as actor
         from audit_logs al
         left join app_users u on u.id = al.actor_user_id
        where $2 = true
           or (al.tenant_id = $1 and al.actor_user_id = $3)
        order by al.created_at desc
        limit 100`,
      [tenantId, isPlatformAdmin(req.user), req.user.id]
    );
    res.json({ ok: true, logs: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/admin/email-logs', requireAuth, async (req, res, next) => {
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query(
      `select id, tenant_id as "tenantId", recipient, subject, status,
              provider_message_id as "providerMessageId", error, created_at as "createdAt"
         from email_delivery_logs
        where $2 = true
           or (tenant_id = $1 and lower(recipient) = lower($3))
        order by created_at desc
        limit 100`,
      [tenantId, isPlatformAdmin(req.user), req.user.email]
    );
    res.json({ ok: true, logs: result.rows });
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

app.post('/api/uploads', requireAuth, async (req, res, next) => {
  try {
    const purpose = cleanString(req.body?.purpose) || 'asset';
    if (!['logo', 'avatar', 'asset'].includes(purpose)) return res.status(400).json({ ok: false, error: 'purpose must be logo, avatar, or asset' });
    const dataUrl = String(req.body?.dataUrl || '');
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([a-z0-9+/=]+)$/i);
    if (!match) return res.status(400).json({ ok: false, error: 'dataUrl must be a base64 image data URL' });
    const ext = match[1].includes('png') ? '.png' : match[1].includes('webp') ? '.webp' : match[1].includes('gif') ? '.gif' : '.jpg';
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 3 * 1024 * 1024) return res.status(400).json({ ok: false, error: 'image must be 3MB or smaller' });
    const tenantId = getScopedTenantId(req);
    const tenantDir = join(uploadDir, tenantId);
    if (!existsSync(tenantDir)) mkdirSync(tenantDir, { recursive: true });
    const filename = `${purpose}-${Date.now()}-${randomBytes(4).toString('hex')}${ext}`;
    writeFileSync(join(tenantDir, filename), bytes);
    const url = `/uploads/${tenantId}/${filename}`;
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'asset.upload', entityType: purpose, entityId: filename, details: { bytes: bytes.length, mimeType: match[1] } });
    res.status(201).json({ ok: true, url });
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
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'ai.framework_activate', entityType: 'ai_agent', entityId: tenantId, details: { model } });
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
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'campaign.create', entityType: 'campaign', entityId: result.rows[0].id, details: { name: result.rows[0].name, stage: result.rows[0].stage } });
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
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'campaign.update', entityType: 'campaign', entityId: result.rows[0].id, details: { name: result.rows[0].name, stage: result.rows[0].stage } });
    res.json({ ok: true, campaign: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/campaigns/:id', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query('delete from campaigns where id = $1 and tenant_id = $2 returning id, name', [req.params.id, tenantId]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'campaign not found' });
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'campaign.delete', entityType: 'campaign', entityId: result.rows[0].id, details: { name: result.rows[0].name } });
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
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'lead.create', entityType: 'lead', entityId: result.rows[0].id, details: { company: result.rows[0].company, stage: result.rows[0].stage } });
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
    await logAudit({ tenantId: getScopedTenantId(req), actorUserId: req.user.id, action: 'lead.update', entityType: 'lead', entityId: result.rows[0].id, details: { company: result.rows[0].company, stage: result.rows[0].stage } });
    res.json({ ok: true, lead: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/leads/:id', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query('delete from leads where id = $1 and tenant_id = $2 returning id, company', [req.params.id, tenantId]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'lead not found' });
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'lead.delete', entityType: 'lead', entityId: result.rows[0].id, details: { company: result.rows[0].company } });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/leads/export', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query(
      `select company, contact_name, email, score, source, stage, next_action
         from leads
        where tenant_id = $1
        order by updated_at desc, created_at desc`,
      [tenantId]
    );
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'lead.export', entityType: 'lead' });
    res.setHeader('content-type', 'text/csv');
    res.setHeader('content-disposition', 'attachment; filename="octave-leads.csv"');
    res.send(toCsv(result.rows, ['company', 'contact_name', 'email', 'score', 'source', 'stage', 'next_action']));
  } catch (error) {
    next(error);
  }
});

app.post('/api/leads/import', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const rows = parseCsv(String(req.body?.csv || '')).slice(0, 500);
    let imported = 0;
    for (const row of rows) {
      const data = normalizeLead({
        company: row.company,
        contactName: row.contact_name || row.contactName,
        email: row.email,
        score: row.score,
        source: row.source || 'CSV import',
        stage: row.stage || 'New',
        nextAction: row.next_action || row.nextAction
      });
      if (!data.company || !data.contactName) continue;
      await pool.query(
        `insert into leads (tenant_id, company, contact_name, email, score, source, stage, owner_user_id, next_action)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict do nothing`,
        [tenantId, data.company, data.contactName, data.email, data.score, data.source, data.stage, req.user.id, data.nextAction]
      );
      imported += 1;
    }
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'lead.import', entityType: 'lead', details: { imported } });
    res.status(201).json({ ok: true, imported });
  } catch (error) {
    next(error);
  }
});

app.post('/api/leads/:id/convert', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const lead = await pool.query('select * from leads where id = $1 and tenant_id = $2', [req.params.id, tenantId]);
    if (!lead.rowCount) return res.status(404).json({ ok: false, error: 'lead not found' });
    const row = lead.rows[0];
    const result = await pool.query(
      `insert into customers (tenant_id, name, health, plan, mrr, status)
       values ($1,$2,$3,$4,$5,$6)
       returning id, name, health, plan, mrr, status, created_at as "createdAt"`,
      [tenantId, row.company, boundedInt(req.body?.health, 0, 100, 75), cleanString(req.body?.plan) || 'Starter', boundedNumber(req.body?.mrr, 0), 'Converted lead']
    );
    await pool.query('update leads set stage = $3, updated_at = now() where id = $1 and tenant_id = $2', [req.params.id, tenantId, 'Won']);
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'lead.convert', entityType: 'customer', entityId: result.rows[0].id, details: { leadId: req.params.id, company: row.company } });
    res.status(201).json({ ok: true, customer: result.rows[0] });
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
    await logAudit({ tenantId: getScopedTenantId(req), actorUserId: req.user.id, action: 'customer.create', entityType: 'customer', entityId: result.rows[0].id, details: { name: result.rows[0].name, status: result.rows[0].status } });
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
    await logAudit({ tenantId: getScopedTenantId(req), actorUserId: req.user.id, action: 'customer.update', entityType: 'customer', entityId: result.rows[0].id, details: { name: result.rows[0].name, status: result.rows[0].status } });
    res.json({ ok: true, customer: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/customers/:id', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query('delete from customers where id = $1 and tenant_id = $2 returning id, name', [req.params.id, tenantId]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'customer not found' });
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'customer.delete', entityType: 'customer', entityId: result.rows[0].id, details: { name: result.rows[0].name } });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/crm/notes', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const entityType = cleanString(req.query.entityType);
    const entityId = cleanString(req.query.entityId);
    const result = await pool.query(
      `select n.id, n.entity_type as "entityType", n.entity_id as "entityId", n.note,
              n.created_at as "createdAt", u.name as author
         from crm_notes n
         left join app_users u on u.id = n.created_by
        where n.tenant_id = $1
          and ($2::text is null or n.entity_type = $2)
          and ($3::text is null or n.entity_id = $3)
        order by n.created_at desc
        limit 100`,
      [tenantId, entityType || null, entityId || null]
    );
    res.json({ ok: true, notes: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/crm/notes', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const entityType = cleanString(req.body?.entityType);
    const entityId = cleanString(req.body?.entityId);
    const note = cleanString(req.body?.note);
    if (!entityType || !entityId || !note) return res.status(400).json({ ok: false, error: 'entityType, entityId, and note are required' });
    const result = await pool.query(
      `insert into crm_notes (tenant_id, entity_type, entity_id, note, created_by)
       values ($1,$2,$3,$4,$5)
       returning id, entity_type as "entityType", entity_id as "entityId", note, created_at as "createdAt"`,
      [tenantId, entityType, entityId, note, req.user.id]
    );
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'crm.note_create', entityType, entityId, details: { note: note.slice(0, 120) } });
    res.status(201).json({ ok: true, note: { ...result.rows[0], author: req.user.name } });
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
    await logAudit({ tenantId: getScopedTenantId(req), actorUserId: req.user.id, action: 'follow_up.create', entityType: 'follow_up_task', entityId: result.rows[0].id, details: { title: result.rows[0].title, status: result.rows[0].status } });
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
    await logAudit({ tenantId: getScopedTenantId(req), actorUserId: req.user.id, action: 'follow_up.update', entityType: 'follow_up_task', entityId: result.rows[0].id, details: { title: result.rows[0].title, status: result.rows[0].status } });
    res.json({ ok: true, task: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/follow-ups/:id', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query('delete from follow_up_tasks where id = $1 and tenant_id = $2 returning id, title', [req.params.id, tenantId]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'follow-up task not found' });
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'follow_up.delete', entityType: 'follow_up_task', entityId: result.rows[0].id, details: { title: result.rows[0].title } });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/scheduled-jobs', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query(
      `select id, name, job_type as "jobType", schedule, payload, status,
              next_run_at as "nextRunAt", last_run_at as "lastRunAt",
              retry_count as "retryCount", last_error as "lastError", created_at as "createdAt"
         from scheduled_jobs
        where tenant_id = $1
        order by next_run_at nulls last, created_at desc`,
      [tenantId]
    );
    res.json({ ok: true, jobs: result.rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/scheduled-job-runs', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const result = await pool.query(
      `select r.id, r.job_id as "jobId", j.name as "jobName", r.status,
              r.approval_id as "approvalId", r.output, r.error,
              r.started_at as "startedAt", r.finished_at as "finishedAt"
         from scheduled_job_runs r
         left join scheduled_jobs j on j.id = r.job_id
        where r.tenant_id = $1
        order by r.started_at desc
        limit 50`,
      [tenantId]
    );
    res.json({ ok: true, runs: result.rows });
  } catch (error) {
    next(error);
  }
});

app.post('/api/scheduled-jobs', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const name = cleanString(req.body?.name);
    const jobType = cleanString(req.body?.jobType) || 'ai_workflow';
    const schedule = cleanString(req.body?.schedule) || 'manual';
    const nextRunAt = cleanString(req.body?.nextRunAt) || null;
    const payload = req.body?.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
    if (!name) return res.status(400).json({ ok: false, error: 'job name is required' });
    const result = await pool.query(
      `insert into scheduled_jobs (tenant_id, name, job_type, schedule, payload, status, next_run_at, created_by)
       values ($1,$2,$3,$4,$5::jsonb,'Active',$6,$7)
       returning id, name, job_type as "jobType", schedule, payload, status,
                 next_run_at as "nextRunAt", last_run_at as "lastRunAt",
                 retry_count as "retryCount", last_error as "lastError", created_at as "createdAt"`,
      [tenantId, name, jobType, schedule, JSON.stringify(payload), nextRunAt, req.user.id]
    );
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'schedule.create', entityType: 'scheduled_job', entityId: result.rows[0].id, details: { name, jobType, schedule } });
    res.status(201).json({ ok: true, job: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/scheduled-jobs/:id', requireAuth, async (req, res, next) => {
  if (!requireTenantWorkspace(req, res)) return;
  try {
    const tenantId = getScopedTenantId(req);
    const status = cleanString(req.body?.status);
    if (status && !['Active', 'Paused', 'Archived'].includes(status)) return res.status(400).json({ ok: false, error: 'status must be Active, Paused, or Archived' });
    const result = await pool.query(
      `update scheduled_jobs
          set status = coalesce($3, status),
              next_run_at = coalesce($4, next_run_at),
              updated_at = now()
        where id = $1 and tenant_id = $2
        returning id, name, job_type as "jobType", schedule, payload, status,
                  next_run_at as "nextRunAt", last_run_at as "lastRunAt",
                  retry_count as "retryCount", last_error as "lastError", created_at as "createdAt"`,
      [req.params.id, tenantId, status || null, cleanString(req.body?.nextRunAt) || null]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'scheduled job not found' });
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'schedule.update', entityType: 'scheduled_job', entityId: result.rows[0].id, details: { status: result.rows[0].status } });
    res.json({ ok: true, job: result.rows[0] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/social/accounts', requireAuth, async (req, res, next) => {
  try {
    const tenantId = getScopedTenantId(req);
    if (!canManageSocialAccounts(req.user, tenantId)) {
      return res.status(403).json({ ok: false, error: 'Only tenant admins can view social accounts' });
    }
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
    if (!canManageSocialAccounts(req.user, tenantId)) {
      return res.status(403).json({ ok: false, error: 'Only tenant admins can configure social accounts' });
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
              credentials = excluded.credentials,
              status = excluded.status,
              updated_at = now()
       returning id, tenant_id as "tenantId", platform, handle, credentials, status,
                 created_at as "createdAt", updated_at as "updatedAt"`,
      [tenantId, platform, handle, JSON.stringify(encryptJson(credentials)), status, req.user.id]
    );
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'social_account.upsert', entityType: 'social_account', entityId: result.rows[0].id, details: { platform, handle, status, credentialKeys: Object.keys(credentials) } });
    res.status(201).json({ ok: true, account: maskSocialAccount(result.rows[0]) });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/social/accounts/:id', requireAuth, async (req, res, next) => {
  try {
    const tenantId = getScopedTenantId(req);
    if (!canManageSocialAccounts(req.user, tenantId)) {
      return res.status(403).json({ ok: false, error: 'Only tenant admins can remove social accounts' });
    }
    const result = await pool.query(
      'delete from social_accounts where id = $1 and tenant_id = $2 returning id, platform, handle',
      [req.params.id, tenantId]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'social account not found' });
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'social_account.delete', entityType: 'social_account', entityId: result.rows[0].id, details: { platform: result.rows[0].platform, handle: result.rows[0].handle } });
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
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'ai.agent_create', entityType: 'ai_agent', entityId: result.rows[0].id, details: { name: agent.name, model: agent.model, type: agent.type } });
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
    await logAudit({ tenantId: result.rows[0].tenantId, actorUserId: req.user.id, action: 'ai.agent_update', entityType: 'ai_agent', entityId: result.rows[0].id, details: { name: result.rows[0].name, model: result.rows[0].model, type: result.rows[0].type } });
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
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'ai.agent_run', entityType: 'approval', entityId: approval.id, details: { agent: agent.name, risk: approval.risk } });

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
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'ai.workflow_generated', entityType: 'approval', entityId: approval.id, details: { workflowType: workflow.type, title: workflow.title, actionType: action.type } });

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
    await logAudit({ tenantId, actorUserId: req.user.id, action: 'paperclip.task_create', entityType: 'approval', entityId: approval.id, details: { task: payload.task, model: payload.model } });
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
  if (!canDecideApprovals(req.user)) {
    return res.status(403).json({ ok: false, error: 'Approver or tenant admin access required' });
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
    await logAudit({ tenantId, actorUserId: req.user.id, action: `approval.${status}`, entityType: 'approval', entityId: result.rows[0].id, details: { title: result.rows[0].title, actionType: result.rows[0].actionType, execution } });
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
              u.team, u.initials, u.avatar_url, u.is_active, u.must_change_password,
              t.name as tenant_name, t.plan,
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
    `insert into app_users (tenant_id, name, email, password_hash, role, platform_role, team, initials, avatar_url, must_change_password)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)
     returning id, tenant_id as "tenantId", name, email, role, platform_role as "platformRole",
               team, initials, avatar_url as "avatarUrl", is_active as "isActive",
               must_change_password as "mustChangePassword", created_at as "createdAt"`,
    [tenantId, name, email, hashPassword(password), role, platformRole, team || null, initialsFor(name), avatarUrl || null]
  );
  return result.rows[0];
}

async function loadUserById(id) {
  const result = await pool.query(
    `select u.id, u.tenant_id, u.name, u.email, u.role, u.platform_role,
            u.team, u.initials, u.avatar_url, u.is_active, u.must_change_password,
            t.name as tenant_name, t.plan,
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

async function sendPasswordResetEmail({ tenantId, to, name, tenantName, token }) {
  const loginUrl = process.env.PUBLIC_APP_URL || 'http://38.247.188.228:3002';
  const resetUrl = `${loginUrl}${loginUrl.includes('?') ? '&' : '?'}resetToken=${encodeURIComponent(token)}`;
  const subject = `Reset your Octave CRM password`;
  const text = [
    `Hello ${name || ''},`,
    '',
    `Use this link to reset your Octave CRM password for ${tenantName || 'your company'}:`,
    resetUrl,
    '',
    'This link expires in 1 hour.'
  ].join('\n');
  const html = `<p>Hello ${escapeHtml(name || '')},</p><p>Use this link to reset your Octave CRM password for ${escapeHtml(tenantName || 'your company')}:</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>This link expires in 1 hour.</p>`;
  return sendMailWithConfig({ tenantId, to, subject, text, html });
}

async function sendMailWithConfig({ tenantId, to, subject, text, html }) {
  const config = await getBestEmailConfig(tenantId);
  if (!config?.enabled || !config.smtpHost || !config.fromEmail) {
    const skipped = { sent: false, skipped: true, reason: 'email configuration is not enabled' };
    await logEmailDelivery({ tenantId, to, subject, result: skipped });
    return skipped;
  }
  try {
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: Number(config.smtpPort || 587),
      secure: Boolean(config.smtpSecure),
      auth: config.smtpUser ? { user: config.smtpUser, pass: decryptSecret(config.smtpPass) || '' } : undefined
    });
    const info = await transporter.sendMail({
      from: `"${config.fromName || 'Octave CRM'}" <${config.fromEmail}>`,
      to,
      subject,
      text,
      html
    });
    const sent = { sent: true, messageId: info.messageId };
    await logEmailDelivery({ tenantId, to, subject, result: sent });
    return sent;
  } catch (error) {
    const failed = { sent: false, error: error.message };
    await logEmailDelivery({ tenantId, to, subject, result: failed });
    return failed;
  }
}

async function logEmailDelivery({ tenantId, to, subject, result }) {
  try {
    await pool.query(
      `insert into email_delivery_logs (tenant_id, recipient, subject, status, provider_message_id, error)
       values ($1,$2,$3,$4,$5,$6)`,
      [tenantId || null, to, subject, result.sent ? 'sent' : result.skipped ? 'skipped' : 'failed', result.messageId || null, result.error || result.reason || null]
    );
  } catch (error) {
    console.warn('Failed to log email delivery', error.message);
  }
}

async function logAudit({ tenantId, actorUserId, action, entityType, entityId, details = {} }) {
  try {
    await pool.query(
      `insert into audit_logs (tenant_id, actor_user_id, action, entity_type, entity_id, details)
       values ($1,$2,$3,$4,$5,$6::jsonb)`,
      [tenantId || null, actorUserId || null, action, entityType || null, entityId ? String(entityId) : null, JSON.stringify(details || {})]
    );
  } catch (error) {
    console.warn('Failed to write audit log', error.message);
  }
}

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function maskDelivery(delivery) {
  if (!delivery) return null;
  return {
    sent: Boolean(delivery.sent),
    skipped: Boolean(delivery.skipped),
    reason: delivery.reason,
    error: delivery.error
  };
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
  return user?.tenantId === tenantId && user.platformRole === 'tenant_admin';
}

function canManageSocialAccounts(user, tenantId) {
  return user?.tenantId === tenantId && user.platformRole === 'tenant_admin';
}

function canViewOperationalMetrics(user, tenantId) {
  return isPlatformAdmin(user) || (user?.tenantId === tenantId && user.platformRole === 'tenant_admin');
}

function canDecideApprovals(user) {
  return user?.platformRole === 'tenant_admin' || user?.platformRole === 'approver';
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
    mustChangePassword: Boolean(row.must_change_password),
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
  const credentials = decryptJson(row.credentials);
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

function encryptionKey() {
  return createHash('sha256').update(appSecret).digest();
}

function encryptSecret(value) {
  if (!value) return value;
  if (String(value).startsWith('enc:v1:')) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decryptSecret(value) {
  if (!value || !String(value).startsWith('enc:v1:')) return value || '';
  try {
    const [, , ivRaw, tagRaw, dataRaw] = String(value).split(':');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

function encryptJson(value = {}) {
  return { __encrypted: true, value: encryptSecret(JSON.stringify(value || {})) };
}

function decryptJson(value = {}) {
  if (!value || typeof value !== 'object') return {};
  if (value.__encrypted) {
    try {
      return JSON.parse(decryptSecret(value.value) || '{}');
    } catch {
      return {};
    }
  }
  return value;
}

function rateLimit(scope, max, windowMs) {
  return (req, res, next) => {
    const key = `${scope}:${req.ip}:${String(req.body?.email || '').toLowerCase()}`;
    const now = Date.now();
    const entry = loginAttempts.get(key) || { count: 0, resetAt: now + windowMs };
    if (entry.resetAt < now) {
      entry.count = 0;
      entry.resetAt = now + windowMs;
    }
    entry.count += 1;
    loginAttempts.set(key, entry);
    if (entry.count > max) {
      return res.status(429).json({ ok: false, error: 'Too many attempts. Try again later.' });
    }
    next();
  };
}

function toCsv(rows, fields) {
  return [
    fields.join(','),
    ...rows.map((row) => fields.map((field) => csvCell(row[field])).join(','))
  ].join('\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function parseCsv(csv) {
  const lines = String(csv || '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map((item) => item.trim());
  return lines.slice(1).map((line) => Object.fromEntries(splitCsvLine(line).map((value, index) => [headers[index], value.trim()])));
}

function splitCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
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
