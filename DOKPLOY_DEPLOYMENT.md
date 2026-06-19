# Dokploy Deployment Checklist

If the logs show only Caddy startup messages, Dokploy is running this repository as a static application. That is the wrong deployment type for Octave CRM because the project requires multiple containers.

Create it as a Compose service:

1. Open Dokploy.
2. Go to project `Octave CRM`.
3. Add a new service.
4. Choose `Compose`.
5. Choose Compose Type `Docker Compose`.
6. Select this GitHub repository and branch `main`.
7. Set Compose Path to one of these:

```text
./compose.yml
```

or:

```text
./docker-compose.yml
```

8. Add environment variables from `dokploy.env.example`.
9. Deploy.

Expected containers:

```text
App
octave-api
paperclip
octave-postgres
ollama
```

If Dokploy shows only one Caddy container, delete that application and recreate it as a Compose service.

After deployment, run:

```bash
docker exec -it ollama ollama pull llama3.1:8b
```

Health checks:

```bash
curl http://38.247.188.228:3002/health
curl http://38.247.188.228:3002/api/system/status
curl http://38.247.188.228:3200/health
curl http://38.247.188.228:3100/health
```
