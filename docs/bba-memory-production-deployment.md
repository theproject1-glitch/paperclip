# BBA Memory Production Deployment

**Audience**: operator-maintainers deploying the Casa Pariurilor BBA Memory subsystem.
**Scope**: production host requirements, Docker deployment, persistent volumes, smoke checks, monitoring, and rollback.

## Server Requirements

| Requirement | Minimum | Notes |
|---|---:|---|
| CPU | 2 vCPU | Browser automation benefits from spare headroom. |
| Memory | 4 GB | Use 8 GB if running Playwright and agents on the same host. |
| Disk | 20 GB SSD | Includes Paperclip home, BBA SQLite memory, traces, and browser profile. |
| OS | Linux host with Docker Engine | Windows is fine for development; production should run under Linux containers. |
| Network | Stable outbound HTTPS | Required for Paperclip, model providers, and bookmaker access. |

Paperclip uses Node.js 24 in the production image. BBA Memory uses Node's built-in `node:sqlite`, so no external database is required for the BBA journal.

## Environment

Create `.env.production` beside `docker-compose.yml`:

```env
PAPERCLIP_PORT=3000
PAPERCLIP_PUBLIC_URL=https://paperclip.example.com
PAPERCLIP_DEPLOYMENT_MODE=authenticated
PAPERCLIP_DEPLOYMENT_EXPOSURE=private
PAPERCLIP_INSTANCE_ID=default
BETTER_AUTH_SECRET=replace-with-a-long-random-secret

# Optional host path overrides.
PAPERCLIP_HOST_HOME=/home/paperclip/.paperclip
BBA_CHROMIUM_PROFILE_DIR=/home/paperclip/.paperclip/bba-playwright-profile
```

Store raw bookmaker credentials in Paperclip secrets, not in `.env.production`.

## Persistent Volumes

The Docker compose file mounts two persistent paths:

- `/paperclip`: Paperclip home, embedded data, config, logs, BBA Memory SQLite DB, and run artifacts.
- `/paperclip/.paperclip/bba-playwright-profile`: persistent Chromium profile used by pre-authenticated BBA browser sessions.

Back up the Paperclip home directory before upgrades:

```powershell
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Compress-Archive -Path "$env:PAPERCLIP_HOST_HOME\*" -DestinationPath "paperclip-backup-$stamp.zip"
```

## Docker Deploy

```powershell
git clone https://github.com/theproject1-glitch/paperclip.git
cd paperclip
git checkout production
docker compose --env-file .env.production up -d --build
docker compose ps
```

Expected:

- Container is `running`.
- Health status becomes `healthy`.
- `GET /health` returns HTTP 200.
- `GET /health/deep` returns HTTP 200 with `db_connected: true`.

## SSL and Reverse Proxy

Put Caddy, nginx, or a managed load balancer in front of the container.

Minimum proxy requirements:

- Forward `Host`, `X-Forwarded-Proto`, `X-Forwarded-For`, and `X-Request-ID`.
- Terminate TLS with a valid certificate.
- Route public traffic to `http://127.0.0.1:3000`.
- Keep `PAPERCLIP_PUBLIC_URL` aligned with the external HTTPS URL.

## Smoke Test

After deploy:

```powershell
.\scripts\deploy-smoke-test.ps1 -BaseUrl "https://paperclip.example.com" -CompanyId "test-co"
```

The script checks:

- `/health`
- `/health/deep`
- `/api/companies/<companyId>/bba-memory/recent-runs`
- `/api/companies/<companyId>/bba-memory/metrics`

Run it once before and once after a production upgrade.

## Monitoring

Scrape BBA metrics:

```text
GET /api/companies/<companyId>/bba-memory/metrics
```

Track:

- `bba_runs_total{outcome="success"}`
- `bba_runs_total{outcome="failure"}`
- `bba_idempotency_replays_total`
- `bba_rate_limited_total`

The idempotency and rate-limit counters are process-local. In multi-instance deployments, add a per-pod or per-container label at scrape time.

## Rollback

1. Stop the current container:

   ```powershell
   docker compose down
   ```

2. Check out the previous production tag:

   ```powershell
   git fetch origin --tags
   git checkout <previous-v-tag>
   ```

3. Restore the Paperclip home backup if the failed release changed persistent state.

4. Start the previous image:

   ```powershell
   docker compose --env-file .env.production up -d --build
   .\scripts\deploy-smoke-test.ps1 -BaseUrl "https://paperclip.example.com" -CompanyId "test-co"
   ```

## Operational Notes

- Keep #8 auto-retry out of the production demo path until it is separately reviewed.
- Do not wipe `BBA_MEMORY_DIR` unless you intentionally want to discard selector learning and run history.
- Keep the persistent Chromium profile backed up before browser or Playwright upgrades.
