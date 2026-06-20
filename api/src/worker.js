import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const workerId = process.env.WORKER_ID || `worker-${Math.random().toString(16).slice(2)}`;
const pollMs = Number(process.env.WORKER_POLL_MS || 15000);
const batchSize = Number(process.env.WORKER_BATCH_SIZE || 3);
const maxRetries = Number(process.env.WORKER_MAX_RETRIES || 3);
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
const paperclipBaseUrl = process.env.PAPERCLIP_BASE_URL || 'http://paperclip';
let timer;

console.log(`Octave worker ${workerId} polling every ${pollMs}ms`);

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await ensureWorkerSchema();
await tick();
timer = setInterval(tick, pollMs);

async function tick() {
  try {
    const jobs = await claimDueJobs();
    for (const job of jobs) {
      await runJob(job);
    }
  } catch (error) {
    console.error('Worker tick failed', error);
  }
}

async function claimDueJobs() {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await client.query(
      `select *
         from scheduled_jobs
        where status = 'Active'
          and coalesce(next_run_at, now()) <= now()
          and (locked_at is null or locked_at < now() - interval '10 minutes')
          and retry_count <= $2
        order by coalesce(next_run_at, created_at)
        limit $1
        for update skip locked`,
      [batchSize, maxRetries]
    );
    const ids = result.rows.map((row) => row.id);
    if (ids.length) {
      await client.query(
        `update scheduled_jobs
            set locked_at = now(),
                locked_by = $2,
                updated_at = now()
          where id = any($1::uuid[])`,
        [ids, workerId]
      );
    }
    await client.query('commit');
    return result.rows;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function runJob(job) {
  const run = await pool.query(
    `insert into scheduled_job_runs (job_id, tenant_id, status)
     values ($1,$2,'running')
     returning id`,
    [job.id, job.tenant_id]
  );
  const runId = run.rows[0].id;
  try {
    const workflow = normalizeWorkflow(job.payload || {});
    const agent = await findWorkflowAgent(job.tenant_id, workflow.type);
    const prompt = buildWorkflowPrompt(workflow);
    const output = agent ? await runAgent(agent, prompt, job.tenant_id) : `Draft generated for approval:\n\n${prompt}`;
    const action = buildWorkflowAction(workflow, output);
    const approval = await createApproval({
      tenantId: job.tenant_id,
      title: workflow.title || job.name,
      sourceAgentId: agent?.id || null,
      risk: workflow.risk || 'Medium',
      prompt,
      output,
      status: 'pending',
      actionType: action.type,
      actionPayload: action.payload
    });
    const nextRunAt = computeNextRun(job.schedule, job.next_run_at);
    await pool.query(
      `update scheduled_jobs
          set last_run_at = now(),
              next_run_at = $2,
              locked_at = null,
              locked_by = null,
              retry_count = 0,
              last_error = null,
              updated_at = now()
        where id = $1`,
      [job.id, nextRunAt]
    );
    await pool.query(
      `update scheduled_job_runs
          set status = 'completed',
              approval_id = $2,
              output = $3,
              finished_at = now()
        where id = $1`,
      [runId, approval.id, output]
    );
    await logAudit({ tenantId: job.tenant_id, action: 'schedule.executed', entityType: 'scheduled_job', entityId: job.id, details: { approvalId: approval.id, workerId } });
    console.log(`Executed scheduled job ${job.id}: approval ${approval.id}`);
  } catch (error) {
    const retryCount = Number(job.retry_count || 0) + 1;
    await pool.query(
      `update scheduled_jobs
          set locked_at = null,
              locked_by = null,
              retry_count = $2,
              last_error = $3,
              status = case when $2 > $4 then 'Paused' else status end,
              updated_at = now()
        where id = $1`,
      [job.id, retryCount, error.message, maxRetries]
    );
    await pool.query(
      `update scheduled_job_runs
          set status = 'failed',
              error = $2,
              finished_at = now()
        where id = $1`,
      [runId, error.message]
    );
    await logAudit({ tenantId: job.tenant_id, action: 'schedule.failed', entityType: 'scheduled_job', entityId: job.id, details: { error: error.message, retryCount, workerId } });
    console.error(`Scheduled job ${job.id} failed`, error);
  }
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
  const body = await response.json().catch(() => ({}));
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
    const body = await response.json().catch(() => ({}));
    return { ok: true, output: body.output || JSON.stringify(body) };
  } catch {
    return { ok: false };
  }
}

async function createApproval({ tenantId, title, sourceAgentId, risk, prompt, output, status, actionType, actionPayload }) {
  const result = await pool.query(
    `insert into approvals (tenant_id, source_agent_id, title, risk, prompt, output, status, action_type, action_payload)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     returning id, title, risk, status`,
    [tenantId, sourceAgentId, title || 'Scheduled AI draft', risk, prompt, output, status, actionType || null, JSON.stringify(actionPayload || {})]
  );
  return result.rows[0];
}

function normalizeWorkflow(input = {}) {
  return {
    type: cleanString(input.type) || 'campaign_brief',
    title: cleanString(input.title) || 'Scheduled AI workflow draft',
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

function computeNextRun(schedule, previous) {
  const text = String(schedule || '').toLowerCase();
  if (text.includes('hour')) return new Date(Date.now() + 60 * 60 * 1000);
  if (text.includes('daily') || text.includes('day')) return new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (text.includes('weekly') || text.includes('week')) return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  if (text.includes('monthly') || text.includes('month')) {
    const date = previous ? new Date(previous) : new Date();
    date.setMonth(date.getMonth() + 1);
    return date;
  }
  return null;
}

async function logAudit({ tenantId, action, entityType, entityId, details = {} }) {
  await pool.query(
    `insert into audit_logs (tenant_id, action, entity_type, entity_id, details)
     values ($1,$2,$3,$4,$5::jsonb)`,
    [tenantId || null, action, entityType || null, entityId ? String(entityId) : null, JSON.stringify(details || {})]
  );
}

async function ensureWorkerSchema() {
  await pool.query(`
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
}

function normalizeTextArray(value) {
  if (Array.isArray(value)) return value.map(cleanString).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
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

async function shutdown() {
  clearInterval(timer);
  await pool.end();
  process.exit(0);
}
