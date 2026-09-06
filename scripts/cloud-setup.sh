#!/usr/bin/env bash
# Setup script for a Claude Code on the web (cloud) environment.
#
# A remote container clones the repo and nothing else -- no .env, no global
# CLIs. The environment's variables carry the secrets (every key in
# .env.example, plus RAILWAY_TOKEN). This script turns those into what the
# repo expects. See CLAUDE.md, "Cloud session setup".
#
#   Environment -> Setup script:   bash scripts/cloud-setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

# 1. Write the root .env from the environment. The bot and the Prisma CLI read
#    this file; Railway and Next do not. Gitignored, never committed.
KEYS=(
  DATABASE_URL DISCORD_TOKEN DISCORD_GUILD_ID DISCORD_GM_ROLE_ID
  DISCORD_TURN_PING_ROLE_ID DISCORD_CURSED_ROLE_ID DISCORD_CLIENT_ID
  DISCORD_CLIENT_SECRET AUTH_SECRET WEB_BASE_URL DISCORD_NO_ROMANCE_ROLE_ID
  GOOGLE_SHEETS_SERVICE_ACCOUNT_KEY TAGS_SHEET_ID RAILWAY_TOKEN RAILWAY_API_TOKEN
)
: > .env
for k in "${KEYS[@]}"; do
  v="${!k:-}"
  [ -n "$v" ] && printf '%s="%s"\n' "$k" "$v" >> .env
done
echo "cloud-setup: wrote .env ($(grep -c = .env) keys)"

# 2. Next.js loads env from its own project root, not the repo root.
ln -sfn ../.env web/.env
[ -f web/.env.local ] || ln -sfn ../.env web/.env.local

# 3. Railway CLI is not preinstalled.
command -v railway >/dev/null 2>&1 || npm i -g @railway/cli

# 4. Workspaces + prisma generate (root postinstall).
npm install

echo "cloud-setup: done. Note: DATABASE_URL is a raw-TCP port the sandbox proxy"
echo "cloud-setup: cannot carry, so prisma migrate / db:sync fail with P1001 here."
