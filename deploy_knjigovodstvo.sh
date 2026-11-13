#!/usr/bin/env bash
set -euo pipefail
# SUMMA_DEPLOY_PROTOCOL=1

APP_NAME="knjigovodstvoonline"
APP_PORT="3004"
BRANCH="main"

cd "$(dirname "$0")"

phase() { echo "::SUMMA_DEPLOY_PHASE::$1"; }
phase preflight
if [ "$(uname -s)" != "Linux" ] || [ "$(pwd -P)" != "/var/www/knjigovodstvoonline" ]; then
  echo "Deploy je dozvoljen samo u produkcijskom direktorijumu na serveru." >&2
  exit 1
fi
if [ "$(id -un)" != "deploy" ]; then
  echo "Deploy pokrenite kao korisnik deploy." >&2
  exit 1
fi
exec 9>"$(git rev-parse --git-path summa-deploy.lock)"
flock -n 9 || { echo "Deploy je već u toku." >&2; exit 1; }
if [ "$(git branch --show-current)" != "$BRANCH" ] || [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Deploy zahtijeva čistu main granu." >&2
  exit 1
fi

phase pull
echo "==> Pull latest code"
git pull --ff-only origin "$BRANCH"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"

phase dependencies
echo "==> Install dependencies"
npm ci --include=dev

phase migrations
echo "==> Apply database migrations"
npx --no-install prisma migrate deploy

phase generate
echo "==> Generate Prisma Client"
npx --no-install prisma generate

phase build
echo "==> Build Next.js app"
BANK_AUTOMATION_ENABLED=false SEP_AUTOMATION_ENABLED=false npm run build

# Enable only at runtime, after the build. The scheduler uses Europe/Podgorica.
export BANK_AUTOMATION_ENABLED="${BANK_AUTOMATION_ENABLED:-true}"
phase restart
echo "==> Restart PM2 app"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  PORT="$APP_PORT" pm2 restart "$APP_NAME" --update-env
else
  PORT="$APP_PORT" pm2 start npm --name "$APP_NAME" -- start
fi

pm2 save

phase health
echo "==> Check local HTTP response"
for attempt in {1..10}; do
  if curl --connect-timeout 5 --max-time 10 -fsS -I "http://127.0.0.1:${APP_PORT}" | head -n 1; then
    echo "==> App is responding"
    break
  fi

  if [ "$attempt" -eq 10 ]; then
    echo "ERROR: App did not respond on port ${APP_PORT}" >&2
    pm2 logs "$APP_NAME" --lines 40 --nostream
    exit 1
  fi

  echo "Waiting for app to start (${attempt}/10)..."
  sleep 2
done

echo "==> Deploy finished"
phase done
