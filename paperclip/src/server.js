import express from 'express';

const app = express();
const port = Number(process.env.PORT || 80);
const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://ollama:11434';
const defaultModel = process.env.DEFAULT_MODEL || 'llama3.1:8b';

app.use(express.json({ limit: '1mb' }));

app.get('/health', async (_req, res) => {
  const models = await getOllamaModels();
  res.json({
    ok: true,
    service: 'octave-paperclip',
    ollamaBaseUrl,
    defaultModel,
    ollama: models
  });
});

app.get('/api/health', async (_req, res) => {
  const models = await getOllamaModels();
  res.json({
    ok: true,
    service: 'octave-paperclip',
    ollamaBaseUrl,
    defaultModel,
    ollama: models
  });
});

app.get('/api/models', async (_req, res) => {
  const result = await getOllamaModels();
  res.status(result.ok ? 200 : 502).json({
    ok: result.ok,
    defaultModel,
    ollamaBaseUrl,
    models: result.models || [],
    count: result.models?.length || 0,
    error: result.error
  });
});

app.post('/api/tasks', async (req, res) => {
  const body = req.body || {};
  const prompt = body.prompt || body.input?.prompt || body.input?.content || buildPrompt(body);
  const model = body.agent?.model || body.model || body.input?.model || defaultModel;

  const result = await runOllama(model, prompt, body.agent?.temperature);
  if (result.ok) {
    return res.status(202).json({
      ok: true,
      status: 'completed',
      engine: 'ollama',
      model,
      output: result.output,
      requireApproval: body.requireApproval !== false
    });
  }

  res.status(202).json({
    ok: true,
    status: 'queued-locally',
    engine: 'paperclip',
    model,
    output: `Task accepted for human approval. Ollama is not ready yet: ${result.error}`,
    requireApproval: body.requireApproval !== false
  });
});

app.listen(port, () => {
  console.log(`Octave Paperclip listening on ${port}`);
});

async function runOllama(model, prompt, temperature = 0.4) {
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
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: payload.error || `HTTP ${response.status}` };
    return { ok: true, output: payload.response || '' };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function getOllamaModels() {
  try {
    const response = await fetch(`${ollamaBaseUrl}/api/tags`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: payload.error || `HTTP ${response.status}` };
    return {
      ok: true,
      models: (payload.models || []).map((model) => ({
        name: model.name,
        modifiedAt: model.modified_at,
        size: model.size
      }))
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function buildPrompt(body) {
  return [
    'You are an Octave CRM local AI agent.',
    `Task: ${body.task || 'generic_ai_task'}`,
    `Tenant: ${body.tenantId || 'unknown'}`,
    `Input: ${JSON.stringify(body.input || {})}`,
    'Create a concise draft for human approval.'
  ].join('\n');
}
