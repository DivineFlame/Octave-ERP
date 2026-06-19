# Octave CRM

Octave CRM is a multi-tenant, multi-user CRM dashboard focused first on Digital & Social Media Marketing. The current module includes campaign planning, social publishing, lead capture, follow-up queues, human approval controls, and admin configuration UI for Paperclip-managed local Ollama agents.

## Local Development

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

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

The app is a static React/Vite build served by nginx. Future API services for Paperclip, Ollama, tenant data, leads, and approvals can be added as separate services in `docker-compose.yml`.

## Server Port Plan

For a direct host-port setup, use these mappings:

- Dokploy dashboard: `3000:80`
- Ollama/Open WebUI: `3001:80`
- Octave CRM web GUI: `3002:80`
- Paperclip server: `3100:80`

The included compose file maps Octave CRM to `3002:80` and Paperclip to `3100:80`. Dokploy itself should be installed separately and mapped to `3000:80`. Ollama/Open WebUI should keep using `3001:80`.

Set the Paperclip image and Ollama URL through environment variables:

```bash
PAPERCLIP_IMAGE=your-paperclip-image:latest
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

## Production Scope

This repository currently ships the production-ready frontend shell:

- Multi-tenant and multi-user workspace controls
- Digital and social media marketing module
- Lead generation and qualification module
- Follow-up workbench
- Customer relationship dashboard
- Admin AI-agent configuration for Paperclip and Ollama
- Human approval and audit-oriented workflow surfaces
- Dokploy-compatible Docker/nginx deployment

Backend persistence, authentication, Paperclip execution APIs, Ollama inference routing, and channel-specific publishing integrations should be attached as services behind this frontend.
