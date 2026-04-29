# Huawei Cloud FlexusL — Server Setup Guide

## Server Details

| Item | Value |
|------|-------|
| **Provider** | Huawei Cloud FlexusL |
| **Instance** | hcss-ecs-10ed |
| **EIP (Public IP)** | 203.123.83.74 |
| **Private IP** | 172.31.8.64 |
| **OS** | Ubuntu (Linux) |
| **Node.js** | v18.x |
| **Domain** | apiv2.global-order.32d.one |
| **Server Port** | 3001 |
| **Server Path** | /home/global-order-server |

## Domain Setup

| Domain | Points To | Purpose |
|--------|-----------|---------|
| `apiv2.global-order.32d.one` | 203.123.83.74 (Huawei) | **Production** — all extension users |
| `api.global-order.32d.one` | Render | **Testing only** |
| `global-order.32d.one` | Website host | Website + webhooks (unchanged) |

## What Was Installed

1. **Node.js 18** — `curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && apt install -y nodejs`
2. **PM2** — `npm install -g pm2` (process manager, keeps server alive + auto-restart on reboot)
3. **Nginx** — `apt install -y nginx` (reverse proxy, routes port 80/443 → 3001)
4. **Certbot** — `apt install -y certbot python3-certbot-nginx` (SSL certificate, auto-renews)
5. **Git** — `apt install -y git`

## What Was Configured

### Security Group (Huawei Console)
Inbound rules added for ports: **22** (SSH), **80** (HTTP), **443** (HTTPS)

### Docker Cleanup
Stopped and disabled pre-installed Websoft9 Docker containers that were blocking ports 80/443:
```bash
docker stop websoft9-proxy nodejs_hhtnh websoft9-apphub websoft9-git websoft9-deployment
docker update --restart=no websoft9-proxy nodejs_hhtnh websoft9-apphub websoft9-git websoft9-deployment
```

### Server Code
Cloned from private GitHub repo using a Personal Access Token:
```bash
cd /home/global-order-server
git clone https://bckflpboys:<TOKEN>@github.com/bckflpboys/new-order-global-server.git .
```

### Environment Variables
- `.env.local` was included in the repo and renamed to `.env`:
```bash
mv .env.local .env
```

### PM2 (Process Manager)
```bash
pm2 start server.js --name "global-order-api"
pm2 save
pm2 startup
```
- Server auto-starts on reboot
- Check status: `pm2 status`
- View logs: `pm2 logs global-order-api`
- Restart: `pm2 restart global-order-api`

### Nginx (Reverse Proxy)
Config file: `/etc/nginx/sites-available/apiv2.global-order.32d.one`

Routes `apiv2.global-order.32d.one` (ports 80/443) → `localhost:3001`

### SSL (Let's Encrypt)
```bash
certbot --nginx -d apiv2.global-order.32d.one
```
- Certificate auto-renews via Certbot scheduled task
- Certificate path: `/etc/letsencrypt/live/apiv2.global-order.32d.one/`

### DNS
A record added at DNS provider:
- **Name:** `apiv2.global-order`
- **Value:** `203.123.83.74`

### Extension Update
`BASE_URL` in `core/api-client.js` changed to `https://apiv2.global-order.32d.one`

## Common Commands (run on Huawei server via SSH)

```bash
# Check server status
pm2 status

# View server logs
pm2 logs global-order-api

# Restart server
pm2 restart global-order-api

# Pull latest code from GitHub
cd /home/global-order-server && git pull

# Pull + restart
cd /home/global-order-server && git pull && pm2 restart global-order-api

# Check Nginx status
systemctl status nginx

# Renew SSL manually (usually auto)
certbot renew
```
