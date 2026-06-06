#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "==> Apply database migrations"
npx prisma migrate deploy

echo "==> Generate Prisma Client"
npx prisma generate

echo "==> Migrations finished"
