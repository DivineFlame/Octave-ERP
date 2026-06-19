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
- Digital and social media marketing module
- Lead generation and qualification module
- Follow-up workbench
- Customer relationship dashboard
- Admin AI-agent configuration for Paperclip and Ollama
- Human approval and audit-oriented workflow surfaces
- Backend API service
- PostgreSQL schema and seed data
- Ollama status, model discovery, model pull, and test-prompt endpoints
- Paperclip-compatible local orchestration service
- Approval queue persistence and approve/reject endpoint
- Dokploy-compatible Docker/nginx deployment

Authentication and channel-specific publishing integrations should be attached next.

## Backend API

The included API service exposes:

- `GET /health`
- `GET /api/ai/ollama/status`
- `GET /api/ai/ollama/models`
- `POST /api/ai/ollama/test`
- `POST /api/ai/ollama/pull`
- `GET /api/ai/agents`
- `POST /api/ai/agents`
- `PUT /api/ai/agents/:id`
- `POST /api/ai/agents/:id/run`
- `GET /api/paperclip/status`
- `POST /api/paperclip/tasks`
- `GET /api/approvals`
- `POST /api/approvals`
- `PATCH /api/approvals/:id`
- `GET /api/system/status`

PostgreSQL schema and seed data live in `db/init/001_schema.sql`.
