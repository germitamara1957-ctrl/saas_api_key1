# AI Gateway — VPS Deployment Guide

## Requirements

| Tool | Minimum version |
|------|----------------|
| Docker | 24+ |
| Docker Compose | v2 (plugin) |
| RAM | 1 GB (2 GB recommended) |
| Disk | 5 GB |
| Node.js (non-Docker) | 22+ |
| pnpm (non-Docker) | 10+ |

---

## Option A — Docker (Recommended)

### 1. Clone the repository

```bash
git clone https://github.com/germitamara1957-ctrl/fullapikey.git /opt/ai-gateway
cd /opt/ai-gateway
```

### 2. Configure environment variables

```bash
cp .env.example .env
nano .env
```

Fill in all required variables. Generate secrets:

```bash
# JWT_SECRET (48 random bytes → 96 hex chars)
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# ENCRYPTION_KEY (32 random bytes → 64 hex chars)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Add Google Cloud credentials (required for Vertex AI)

```bash
# Upload your GCP service account key JSON to the server
scp gcp-key.json user@your-vps:/opt/ai-gateway/gcp-key.json

# Then in .env set:
# GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/gcp-key.json
# GOOGLE_CLOUD_PROJECT=your-gcp-project-id
# GOOGLE_CLOUD_LOCATION=us-central1
```

Uncomment the volume mount in `docker-compose.yml`:
```yaml
volumes:
  - ./gcp-key.json:/run/secrets/gcp-key.json:ro
```

### 4. Build and start

```bash
docker compose build
docker compose up -d
```

Migrations run automatically on first start inside the container.

### 5. Verify

```bash
# Check service health
docker compose ps

# View logs
docker compose logs -f api
docker compose logs -f frontend

# Test the health endpoint
curl http://localhost/api/healthz
```

The platform is now reachable on **port 80**:
- **Dashboard / Admin panel**: `http://YOUR_VPS_IP/`
- **API**: `http://YOUR_VPS_IP/api/` and `http://YOUR_VPS_IP/v1/`

---

## Option B — PM2 + Nginx (Bare Metal)

### 1. Install Node.js 22+ and pnpm

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g pnpm@10 pm2
```

### 2. Clone and install dependencies

```bash
git clone https://github.com/germitamara1957-ctrl/fullapikey.git /opt/ai-gateway
cd /opt/ai-gateway
pnpm install
```

### 3. Configure environment

```bash
cp .env.example .env
nano .env
```

Set `MIGRATIONS_DIR=/opt/ai-gateway/lib/db/migrations` in `.env`.

### 4. Build the API server

```bash
pnpm --filter @workspace/api-server run build
```

This produces `artifacts/api-server/dist/migrate.mjs` and `dist/index.mjs`.

### 5. Build the Dashboard

```bash
NODE_ENV=production BASE_PATH=/ pnpm --filter @workspace/dashboard run build
# Output: artifacts/dashboard/dist/public/
```

### 6. Start with PM2

```bash
mkdir -p /var/log/ai-gateway
pm2 start ecosystem.config.cjs   # runs migrations then starts the API
pm2 save
pm2 startup   # follow the printed command to enable auto-start
```

### 7. Configure Nginx (HTTP first, HTTPS after)

```bash
sudo apt-get install -y nginx

# Copy dashboard build
sudo mkdir -p /var/www/ai-gateway
sudo cp -r /opt/ai-gateway/artifacts/dashboard/dist/public/. /var/www/ai-gateway/

# Install site config (HTTP)
sudo cp /opt/ai-gateway/nginx.conf /etc/nginx/sites-available/ai-gateway
sudo ln -s /etc/nginx/sites-available/ai-gateway /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

---

## HTTPS with Let's Encrypt

```bash
sudo apt-get install -y certbot python3-certbot-nginx

# Obtain and auto-configure certificate
sudo certbot --nginx -d yourdomain.com

# Verify auto-renewal works
sudo certbot renew --dry-run
```

For a hardened HTTPS setup (TLS 1.3, HSTS, OCSP stapling) use the template:

```bash
sudo cp /opt/ai-gateway/docker/nginx-ssl.conf /etc/nginx/sites-available/ai-gateway
# Edit the file to replace yourdomain.com, then reload nginx
sudo nginx -t && sudo systemctl reload nginx
```

---

## Google Cloud / Vertex AI Setup

The platform proxies Gemini, Imagen, and Veo via the Google Cloud Vertex AI API.
You need a GCP project with the Vertex AI API enabled.

### 1. Enable Vertex AI API

```bash
gcloud services enable aiplatform.googleapis.com --project=YOUR_PROJECT_ID
```

### 2. Create a Service Account

```bash
gcloud iam service-accounts create ai-gateway-sa \
  --display-name="AI Gateway Service Account" \
  --project=YOUR_PROJECT_ID

gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:ai-gateway-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud iam service-accounts keys create gcp-key.json \
  --iam-account=ai-gateway-sa@YOUR_PROJECT_ID.iam.gserviceaccount.com
```

### 3. Set environment variables

```env
GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
GOOGLE_CLOUD_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/opt/ai-gateway/gcp-key.json   # bare metal
# or /run/secrets/gcp-key.json inside Docker
```

### Supported models

| Family | Models |
|--------|--------|
| Gemini 2.5 | gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite |
| Gemini 3.0 | gemini-3.0-pro-preview, gemini-3.0-flash-preview, gemini-3.0-pro-image-preview |
| Gemini 3.1 | gemini-3.1-pro-preview, gemini-3.1-flash-lite-preview, gemini-3.1-flash-image-preview |
| Imagen | imagen-4.0-generate-001 |
| Veo | veo-3.0-generate-preview |
| Partners | Grok, DeepSeek, Kimi, MiniMax, Gemma (23 models total) |

---

## Database Migrations

Migrations run **automatically** on every startup (via `migrate.mjs` before `index.mjs`).

To run them manually:

```bash
# Docker
docker compose exec api node ./artifacts/api-server/dist/migrate.mjs

# PM2 / bare metal
node --enable-source-maps /opt/ai-gateway/artifacts/api-server/dist/migrate.mjs
```

To generate a new migration after schema changes (development only):

```bash
pnpm --filter @workspace/db generate
pnpm --filter @workspace/db migrate
```

---

## Updating (rolling restart)

```bash
cd /opt/ai-gateway
bash deploy.sh --all
# or manually:
git pull && docker compose build && docker compose up -d
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | JWT signing key (min 32 chars) |
| `ENCRYPTION_KEY` | ✅ | AES-256 key (64 hex chars) |
| `ADMIN_EMAIL` | ✅ | Initial admin email |
| `ADMIN_PASSWORD` | ✅ | Initial admin password |
| `GOOGLE_CLOUD_PROJECT` | ✅ | GCP project ID |
| `GOOGLE_CLOUD_LOCATION` | ❌ | Vertex AI region (default: us-central1) |
| `GOOGLE_APPLICATION_CREDENTIALS` | ❌ | Path to GCP service account JSON |
| `APP_BASE_URL` | ✅ | Public URL for email links |
| `REDIS_URL` | ❌ | Redis URL (falls back to PostgreSQL if absent) |
| `SMTP_HOST` | ❌ | SMTP server (emails logged if absent) |
| `SMTP_PORT` | ❌ | Default: 587 |
| `SMTP_USER` | ❌ | SMTP login |
| `SMTP_PASS` | ❌ | SMTP password |
| `SMTP_FROM` | ❌ | Sender address |
| `PORT` | ❌ | API port (default: 8080) |
| `SCRYPT_N` | ❌ | Password hash cost (default: 32768) |
| `CORS_ORIGINS` | ❌ | Comma-separated allowed origins |
| `LOG_LEVEL` | ❌ | trace/debug/info/warn/error (default: info) |
| `SENTRY_DSN` | ❌ | Sentry DSN for error tracking |
| `MIGRATIONS_DIR` | ❌ | Path to migrations folder |

---

## First Login

1. Open `https://yourdomain.com/admin/login`
2. Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`
3. Go to **Providers** → add your Google Cloud project and verify models list
4. Go to **Plans** → configure tiers and model access
5. Go to **Model Costs** → verify 23 models are seeded

---

## Troubleshooting

```bash
# API container logs
docker compose logs --tail=100 api

# Restart only the API
docker compose restart api

# Test health endpoint (should return {"status":"ok",...})
curl http://localhost/api/healthz

# Check DB connectivity from API container
docker compose exec api node -e "
  import('@workspace/db').then(({pool})=>
    pool.query('SELECT NOW()').then(r=>console.log('DB OK',r.rows[0]))
  )
"

# Run migrations manually inside the container
docker compose exec api node ./artifacts/api-server/dist/migrate.mjs
```
