# Octave CRM

Octave CRM is a multi-tenant, multi-user CRM dashboard focused first on Digital & Social Media Marketing. The current module includes campaign planning, social publishing, lead capture, follow-up queues, human approval controls, and admin configuration UI for Paperclip-managed local Ollama agents.

## Local Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

To run the API locally:

```bash
cd api
npm install
npm run dev
```

Set `VITE_API_BASE_URL=http://localhost:3200` for local frontend-to-API testing when the API is exposed on port `3200`.

## Production Build

```bash
npm run build
```

## Dokploy Deployment

Use the included `docker-compose.yml` in Dokploy for the full stack.

Recommended Dokploy setup:

1. Create a new application from this GitHub repository.
2. Select Compose deployment.
3. Use project name `Octave CRM`.
4. Keep the web service/container name as `App`.
5. Add environment variables from `dokploy.env.example`.
6. Deploy and open `http://38.247.188.228:3002/`.

The app is a static React/Vite build served by nginx. Nginx proxies `/api` to the backend service, so the browser does not need direct access to the API port.

## Initial Login Credentials

Change these passwords after first login:

```text
Platform admin: admin@octave.local / Admin@12345
Tenant admin: ananya@example.com / Tenant@12345
Tenant user: karan@example.com / User@12345
```

Only the platform admin can create, restrict, or delete companies and configure Paperclip/Ollama AI agents. As a standard operating boundary, the platform admin does not see tenant workspace modules such as Marketing, Leads, Follow-ups, Customers, or approval queues. Tenant admins can create users, reset their tenant users' passwords, and configure tenant social handles. Tenant users can sign in only to their assigned tenant workspace and can change their own password from Settings.

The login screen does not expose seed credentials. Configure platform email in Settings before creating production tenants so tenant admin credentials can be sent from the platform admin email. Tenant admins can configure tenant email in Settings so newly created tenant users receive credentials from the tenant email identity.

## Server Port Plan

For a direct host-port setup, use these mappings:

- Dokploy dashboard: `3000:80`
- Ollama/Open WebUI: `3001:80`
- Octave CRM web GUI: `3002:80`
- Paperclip server: `3100:80`
- Backend API: `3200:3000`
- Ollama API: `11434:11434`

The included compose file maps Octave CRM to `3002:80`, Paperclip to `3100:80`, the API to `3200:3000`, and Ollama to `11434:11434`. Dokploy itself should be installed separately and mapped to `3000:80`. Ollama/Open WebUI should keep using `3001:80`.

In Dokploy, this app is expected to sit under project `Octave CRM` with the app/container name `App`. The compose service is therefore named `app` and uses `container_name: App`.

The repository includes a lightweight Paperclip-compatible orchestration service in `paperclip/`, so no external `paperclip:latest` image is required.

Set production variables in Dokploy:

```bash
PUBLIC_APP_URL=http://38.247.188.228:3002
CORS_ORIGIN=http://38.247.188.228:3002
POSTGRES_PASSWORD=change_this_strong_password
DEFAULT_OLLAMA_MODEL=llama3.1:8b
APP_SECRET=change_this_to_a_long_random_secret
VITE_API_BASE_URL=
```

After the stack starts, pull at least one Ollama model:

```bash
docker exec -it ollama ollama pull llama3.1:8b
```

If the server is small, choose a lighter model and update `DEFAULT_OLLAMA_MODEL`, for example:

```bash
docker exec -it ollama ollama pull llama3.2:3b
```

## Server Health Checks

Use these checks after Dokploy deploys the stack:

```bash
curl http://38.247.188.228:3002/health
curl http://38.247.188.228:3002/api/system/status
curl http://38.247.188.228:3200/health
curl http://38.247.188.228:3100/health
```

If `http://38.247.188.228:3002/` refuses the connection, the `App` container is not running or Dokploy has not published `3002:80`.

## Production Scope

This repository currently ships:

- Multi-tenant and multi-user workspace controls
- Database-backed digital and social media marketing campaign module
- Database-backed lead generation and qualification module
- Database-backed follow-up workbench
- Database-backed customer relationship dashboard
- Admin AI-agent configuration for Paperclip and Ollama
- Platform-admin company and tenant-user creation
- Platform admin creates companies and the initial tenant admin only
- Tenant admins manage tenant users, user password resets, and tenant social media credentials
- Login-based tenant isolation
- Human approval and audit-oriented workflow surfaces
- Backend API service
- PostgreSQL schema and seed data
- Ollama status, model discovery, model pull, and test-prompt endpoints
- Paperclip-compatible local orchestration service mapped to installed Ollama models
- Approval queue persistence and approve/reject endpoint
- Company restriction and company deletion with cascading tenant-user cleanup
- Self-service password changes and tenant-admin user password reset
- Tenant-scoped social media handles and credential storage for agent access
- Platform-admin separation from tenant operational modules and approval queues
- Bundled platform logo, tenant logo URL, and user avatar URL support
- Platform and tenant SMTP configuration with credential email delivery
- One-click agentic framework activation for default Paperclip/Ollama agents
- Tenant-scoped CRUD APIs for campaigns, leads, follow-up tasks, and customers
- Native AI workflow drafts for campaigns, follow-up emails, and follow-up tasks
- Approval execution that creates campaigns/tasks or sends SMTP email only after human approval
- Mandatory password change for newly created/reset users
- Password reset tokens, audit logs, and email delivery logs
- Admin/tenant-admin user activation, deactivation, and deletion controls
- Audit trail coverage for tenant, user, campaign, lead, customer, follow-up, social account, AI workflow, and approval actions
- Complete audit/email logs are visible only to platform admin; tenant admins and tenant users see only their own log entries
- AES-GCM encryption for newly saved SMTP passwords and social media credentials using `APP_SECRET`
- Local persistent upload storage for tenant logos, user avatars, and image assets
- CSV lead import/export and lead-to-customer conversion
- CRM notes/timeline records for leads, customers, and related entities
- Scheduled AI job records for recurring workflow planning
- Background worker container for scheduled AI jobs, retries, locking, run history, and approval draft creation
- Production observability endpoint for service status, email, audit, approval, and schedule counts
- Backup/restore helper scripts for PostgreSQL
- Dokploy-compatible Docker/nginx deployment

Channel-specific live publishing integrations still require provider OAuth/API approval for Meta, LinkedIn, X, YouTube, or other networks. The app now has the credential vault, social account registry, approval queue, and audit foundation needed to attach those connectors safely.

## Backend API

The included API service exposes:

- `GET /health`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/change-password`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/tenants`
- `POST /api/admin/tenants`
- `PATCH /api/admin/tenants/:id`
- `DELETE /api/admin/tenants/:id`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/:id`
- `DELETE /api/admin/users/:id`
- `POST /api/admin/users/:id/password`
- `GET /api/admin/audit-logs`
- `GET /api/admin/email-logs`
- `GET /api/system/observability`
- `GET /api/email/config`
- `PUT /api/email/config`
- `POST /api/email/test`
- `PATCH /api/settings/profile`
- `POST /api/uploads`
- `GET /api/social/accounts`
- `POST /api/social/accounts`
- `DELETE /api/social/accounts/:id`
- `GET /api/ai/ollama/status`
- `GET /api/ai/ollama/models`
- `GET /api/ai/ollama/installed`
- `POST /api/ai/ollama/test`
- `POST /api/ai/ollama/pull`
- `GET /api/ai/agents`
- `POST /api/ai/agents`
- `PUT /api/ai/agents/:id`
- `POST /api/ai/agents/:id/run`
- `POST /api/ai/workflows`
- `POST /api/ai/framework/activate`
- `GET /api/paperclip/status`
- `GET /api/paperclip/models`
- `POST /api/paperclip/tasks`
- `GET /api/approvals`
- `POST /api/approvals`
- `PATCH /api/approvals/:id`
- `GET /api/system/status`
- `GET /api/dashboard/summary`
- `GET /api/campaigns`
- `POST /api/campaigns`
- `PATCH /api/campaigns/:id`
- `DELETE /api/campaigns/:id`
- `GET /api/leads`
- `POST /api/leads`
- `GET /api/leads/export`
- `POST /api/leads/import`
- `POST /api/leads/:id/convert`
- `PATCH /api/leads/:id`
- `DELETE /api/leads/:id`
- `GET /api/crm/notes`
- `POST /api/crm/notes`
- `GET /api/scheduled-jobs`
- `POST /api/scheduled-jobs`
- `PATCH /api/scheduled-jobs/:id`
- `GET /api/scheduled-job-runs`
- `GET /api/follow-ups`
- `POST /api/follow-ups`
- `PATCH /api/follow-ups/:id`
- `DELETE /api/follow-ups/:id`
- `GET /api/customers`
- `POST /api/customers`
- `PATCH /api/customers/:id`
- `DELETE /api/customers/:id`

PostgreSQL schema and seed data live in `db/init/001_schema.sql`.

## Background Worker

Dokploy compose starts `octave-worker` from the API image:

- polls active scheduled jobs every `WORKER_POLL_MS`
- locks due jobs with PostgreSQL `FOR UPDATE SKIP LOCKED`
- runs the configured AI workflow through Paperclip/Ollama
- creates a human approval draft
- records run history in `scheduled_job_runs`
- retries failures up to `WORKER_MAX_RETRIES`, then pauses the job

Supported simple schedules include hourly, daily, weekly, monthly, or manual one-time jobs.

## Production Maintenance

Back up PostgreSQL from the Dokploy host:

```bash
scripts/backup-postgres.sh
```

Restore a backup:

```bash
scripts/restore-postgres.sh ./backups/octave-crm-YYYYMMDD-HHMMSS.sql
```

Run a basic deployment smoke check:

```bash
SMOKE_BASE_URL=http://38.247.188.228:3002 npm run smoke
```
