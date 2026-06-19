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
