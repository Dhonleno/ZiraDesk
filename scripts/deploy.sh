#!/bin/bash
set -e

echo "🚀 ZiraDesk Deploy Script"
echo "========================="

echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

echo "🔨 Building shared package..."
pnpm --filter @ziradesk/shared build

echo "🗄️ Running database migrations..."
pnpm --filter @ziradesk/api db:migrate

echo "🌱 Running database seed..."
pnpm --filter @ziradesk/api db:seed

echo "🔨 Building API..."
pnpm --filter @ziradesk/api build

echo "🔨 Building Web..."
pnpm --filter @ziradesk/web build

echo "✅ Deploy completed successfully!"
