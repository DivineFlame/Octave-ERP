import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import pg from 'pg';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const tenantId = process.env.DEFAULT_TENANT_ID || 'northstar';
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
const paperclipBaseUrl = process.env.PAPERCLIP_BASE_URL || 'http://paperclip';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_req, res) => {
  const db = await checkDatabase();
  res.status(db.ok ? 200 : 503).json({ ok: db.ok, service: 'octave-crm-api', database: db.ok ? 'connected' : db.error });
});

app.get('/api/ai/ollama/status', async (_req, res) => {
  const result = await getOllamaTags();
  res.status(result.ok ? 200 : 502).json(result);
});

app.get('/api/ai/ollama/models', async (_req, res) => {
  const result = await getOllamaTags();
  res.status(result.ok ? 200 : 502).json({ ok: result.ok, models: result.models || [], error: result.error });
});

app.post('/api/ai/ollama/test', async (req, res) => {
  const { model, prompt, temperature } = req.body || {};
  if (!model || !prompt) return res.status(400).json({ ok: false, error: 'model and prompt are required' });
  try {
    const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false, options: { temperature: Number(temperature ?? 0.4) } })
    });
    const body = await response.json();
    if (!response.ok) return res.status(response.status).json({ ok: false, error: body.error || 'Ollama request failed' });
    res.json({ ok: true, response: body.response || '', raw: body });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message });
  }
});

app.get('/api/ai/agents', async (_req, res, next) => {
  try {
    const result = await pool.query(`select id, name, type, model, temperature, approval_rule as "approvalRule", status, tools, system_prompt as "systemPrompt" from ai_agents where tenant_id = $1 order by created_at`, [tenantId]);
    res.json({ ok: true, agents: result.rows });
  } catch (error) { next(error); }
});

app.post('/api/ai/agents', async (req, res, next) => {
  const agent = normalizeAgent(req.body);
  if (!agent.name || !agent.model) return res.status(400).json({ ok: false, error: 'name and model are required' });
  try {
    const result = await pool.query(
      `insert into ai_agents (tenant_id, name, type, model, temperature, approval_rule, status, tools, system_prompt) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id, name, type, model, temperature, approval_rule as "approvalRule", status, tools, system_prompt as "systemPrompt"`,
      [tenantId, agent.name, agent.type, agent.model, agent.temperature, agent.approvalRule, agent.status, agent.tools, agent.systemPrompt]
    );
    res.status(201).json({ ok: true, agent: result.rows[0] });
  } catch (error) { next(error); }
});

app.put('/api/ai/agents/:id', async (req, res, next) => {
  const agent = normalizeAgent(req.body);
  try {
    const result = await pool.query(
      `update ai_agents set name = coalesce($3, name), type = coalesce($4, type), model = coalesce($5, model), temperature = coalesce($6, temperature), approval_rule = coalesce($7, approval_rule), status = coalesce($8, status), tools = coalesce($9, tools), system_prompt = coalesce($10, system_prompt), updated_at = now() where id = $1 and tenant_id = $2 returning id, name, type, model, temperature, approval_rule as "approvalRule", status, tools, system_prompt as "systemPrompt"`,
      [req.params.id, tenantId, agent.name, agent.type, agent.model, agent.temperature, agent.approvalRule, agent.status, agent.tools, agent.systemPrompt]
    );
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'agent not found' });
    res.json({ ok: true, agent: result.rows[0] });
  } catch (error) { next(error); }
});

app.post('/api/ai/agents/:id/run', async (req, res, next) => {
  try {
    const agentResult = await pool.query('select * from ai_agents where id = $1 and tenant_id = $2', [req.params.id, tenantId]);
    if (!agentResult.rowCount) return res.status(404).json({ ok: false, error: 'agent not found' });
    const agent = agentResult.rows[0];
    const prompt = req.body?.prompt || 'Prepare a short marketing recommendation.';
    const output = await runAgent(agent, prompt);
    const approval = await createApproval({ title: `${agent.name} draft`, sourceAgentId: agent.id, risk: req.body?.risk || 'Medium', prompt, output, status: 'pending' });
    res.json({ ok: true, output, approval });
  } catch (error) { next(error); }
});

app.get('/api/paperclip/status', async (_req, res) => {
  try {
    const response = await fetch(`${paperclipBaseUrl}/health`);
    res.status(response.ok ? 200 : 502).json({ ok: response.ok, status: response.status });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message });
  }
});

app.post('/api/paperclip/tasks', async (req, res, next) => {
  const payload = { tenantId, task: req.body?.task || 'generic_ai_task', input: req.body?.input || {}, requireApproval: req.body?.requireApproval !== false };
  try {
    const paperclipResponse = await forwardToPaperclip(payload);
    const approval = await createApproval({ title: payload.task, sourceAgentId: null, risk: req.body?.risk || 'Medium', prompt: JSON.stringify(payload.input), output: JSON.stringify(paperclipResponse), status: 'pending' });
    res.status(202).json({ ok: true, task: paperclipResponse, approval });
  } catch (error) { next(error); }
});

app.get('/api/approvals', async (_req, res, next) => {
  try {
    const result = await pool.query(`select a.id, a.title, a.risk, a.status, a.prompt, a.output, a.created_at as "createdAt", a.decided_at as "decidedAt", ag.name as agent from approvals a left join ai_agents ag on ag.id = a.source_agent_id where a.tenant_id = $1 order by a.created_at desc`, [tenantId]);
    res.json({ ok: true, approvals: result.rows });
  } catch (error) { next(error); }
});

app.post('/api/approvals', async (req, res, next) => {
  try {
    const approval = await createApproval({ title: req.body?.title, sourceAgentId: req.body?.sourceAgentId || null, risk: req.body?.risk || 'Medium', prompt: req.body?.prompt || '', output: req.body?.output || '', status: req.body?.status || 'pending' });
    res.status(201).json({ ok: true, approval });
  } catch (error) { next(error); }
});

app.patch('/api/approvals/:id', async (req, res, next) => {
  const status = req.body?.status;
  if (!['approved', 'rejected', 'pending'].includes(status)) return res.status(400).json({ ok: false, error: 'status must be approved, rejected, or pending' });
  try {
    const result = await pool.query(`update approvals set status = $3, decided_by = $4, decided_at = case when $3 = 'pending' then null else now() end, decision_note = $5 where id = $1 and tenant_id = $2 returning id, title, risk, status, prompt, output, created_at as "createdAt", decided_at as "decidedAt"`, [req.params.id, tenantId, status, req.body?.decidedBy || 'admin', req.body?.decisionNote || null]);
    if (!result.rowCount) return res.status(404).json({ ok: false, error: 'approval not found' });
    res.json({ ok: true, approval: result.rows[0] });
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ ok: false, error: error.message });
});

app.listen(port, () => console.log(`Octave CRM API listening on ${port}`));

async function checkDatabase() {
  try { await pool.query('select 1'); return { ok: true }; }
  catch (error) { return { ok: false, error: error.message }; }
}

async function getOllamaTags() {
  try {
    const response = await fetch(`${ollamaBaseUrl}/api/tags`);
    const body = await response.json();
    if (!response.ok) return { ok: false, error: body.error || 'Ollama tags failed' };
    return { ok: true, baseUrl: ollamaBaseUrl, models: (body.models || []).map((model) => ({ name: model.name, modifiedAt: model.modified_at, size: model.size })) };
  } catch (error) { return { ok: false, baseUrl: ollamaBaseUrl, error: error.message }; }
}

async function runAgent(agent, prompt) {
  const paperclip = await tryPaperclipAgent(agent, prompt);
  if (paperclip.ok) return paperclip.output;
  const response = await fetch(`${ollamaBaseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: agent.model, prompt: `${agent.system_prompt || ''}\n\n${prompt}`, stream: false, options: { temperature: Number(agent.temperature || 0.4) } })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Ollama generation failed');
  return body.response || '';
}

async function tryPaperclipAgent(agent, prompt) {
  try {
    const response = await fetch(`${paperclipBaseUrl}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tenantId, agent, prompt, requireApproval: true }) });
    if (!response.ok) return { ok: false };
    const body = await response.json();
    return { ok: true, output: body.output || JSON.stringify(body) };
  } catch { return { ok: false }; }
}

async function forwardToPaperclip(payload) {
  try {
    const response = await fetch(`${paperclipBaseUrl}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    if (!response.ok) return { status: 'queued-locally', paperclipAvailable: false, payload };
    return await response.json();
  } catch { return { status: 'queued-locally', paperclipAvailable: false, payload }; }
}

async function createApproval({ title, sourceAgentId, risk, prompt, output, status }) {
  const result = await pool.query(`insert into approvals (tenant_id, source_agent_id, title, risk, prompt, output, status) values ($1,$2,$3,$4,$5,$6,$7) returning id, title, risk, status, prompt, output, created_at as "createdAt"`, [tenantId, sourceAgentId, title || 'AI generated draft', risk, prompt, output, status]);
  return result.rows[0];
}

function normalizeAgent(input = {}) {
  return { name: input.name, type: input.type || 'General', model: input.model, temperature: input.temperature == null ? null : Number(input.temperature), approvalRule: input.approvalRule || input.approval_rule, status: input.status || 'Ready', tools: Array.isArray(input.tools) ? input.tools : null, systemPrompt: input.systemPrompt || input.system_prompt || null };
}
