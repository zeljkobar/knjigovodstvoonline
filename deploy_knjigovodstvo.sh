#!/usr/bin/env bash
set -euo pipefail

APP_NAME="knjigovodstvoonline"
APP_PORT="3004"
BRANCH="main"

cd "$(dirname "$0")"

echo "==> Pull latest code"
git pull --ff-only origin "$BRANCH"

echo "==> Install dependencies"
npm ci

echo "==> Generate Prisma Client"
npx prisma generate

echo "==> Build Next.js app"
npm run build

echo "==> Restart PM2 app"
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  PORT="$APP_PORT" pm2 restart "$APP_NAME" --update-env
else
  PORT="$APP_PORT" pm2 start npm --name "$APP_NAME" -- start
fi

pm2 save

echo "==> Check local HTTP response"
for attempt in {1..10}; do
  if curl -fsS -I "http://127.0.0.1:${APP_PORT}" | head -n 1; then
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
