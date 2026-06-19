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

Use the included `Dockerfile` or `docker-compose.yml` in Dokploy.

Recommended Dokploy setup:

1. Create a new application from this GitHub repository.
2. Select Dockerfile deployment.
3. Set the exposed container port to `80`.
4. Keep the health check path as `/health`.
5. Add domain and SSL settings in Dokploy.

The app is a static React/Vite build served by nginx. API requests under `/api` are proxied to the backend API container.

## Server Port Plan

For a direct host-port setup, use these mappings:

- Dokploy dashboard: `3000:80`
- Ollama/Open WebUI: `3001:80`
- Octave CRM web GUI: `3002:80`
- Paperclip server: `3100:80`
- Octave CRM API: `3200:3000`
- Ollama API: `11434:11434`

The included compose file maps Octave CRM to `3002:80`, Paperclip to `3100:80`, the API to `3200:3000`, and Ollama to `11434:11434`. Dokploy itself should be installed separately and mapped to `3000:80`. Ollama/Open WebUI should keep using `3001:80`.

In Dokploy, this app is expected to sit under project `Octave CRM` with the app/container name `App`. The compose service is therefore named `app` and uses `container_name: App`.

Set the Paperclip image and service credentials through environment variables:

```bash
PAPERCLIP_IMAGE=your-paperclip-image:latest
PAPERCLIP_BASE_URL=http://paperclip
OLLAMA_BASE_URL=http://ollama:11434
POSTGRES_USER=octave
POSTGRES_PASSWORD=change_me
POSTGRES_DB=octave_crm
```

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
- Ollama status, model discovery, and test-prompt endpoints
- Paperclip task orchestration endpoint
- Approval queue persistence and approve/reject endpoint
- Dokploy-compatible Docker/nginx deployment

Authentication and channel-specific publishing integrations should be attached next.

## Backend API

The included API service exposes:

- `GET /health`
- `GET /api/ai/ollama/status`
- `GET /api/ai/ollama/models`
- `POST /api/ai/ollama/test`
- `GET /api/ai/agents`
- `POST /api/ai/agents`
- `PUT /api/ai/agents/:id`
- `POST /api/ai/agents/:id/run`
- `GET /api/paperclip/status`
- `POST /api/paperclip/tasks`
- `GET /api/approvals`
- `POST /api/approvals`
- `PATCH /api/approvals/:id`

PostgreSQL schema and seed data live in `db/init/001_schema.sql`.
