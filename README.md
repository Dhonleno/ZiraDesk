# ZiraDesk

Plataforma SaaS de atendimento omnichannel com isolamento multi-tenant por schema PostgreSQL.

## Pré-requisitos

- Node.js 20+
- pnpm 9+
- Docker (para PostgreSQL e Redis)

## Setup inicial

```bash
# 1. Dependências
pnpm install

# 2. Infra local
docker compose up -d

# 3. Variáveis de ambiente
cp apps/api/.env.example apps/api/.env
# Edite apps/api/.env se necessário (padrão funciona com docker compose)

# 4. Migrations do banco
pnpm --filter @ziradesk/api db:migrate

# 5. Seed (planos + super admin + tenant demo)
pnpm --filter @ziradesk/api db:seed
```

## Rodando

```bash
# API (porta 3333) e Web (porta 5173) em paralelo
pnpm dev
```

## Credenciais padrão após seed

| Papel | E-mail | Senha | Workspace (dev) |
|---|---|---|---|
| Super Admin | admin@ziradesk.com | ZiraDesk@2025 | — |
| Demo Owner | owner@demo.ziradesk.com | _(gerada no seed)_ | `demo` |

> A senha do Demo Owner é exibida no output do seed. Execute `pnpm --filter @ziradesk/api db:seed` para ver.

## Estrutura

```
apps/
  api/    Fastify + Prisma + Socket.io
  web/    React + Vite + TanStack Query
packages/
  shared/ Tipos e schemas Zod compartilhados
```

## Rotas principais

| URL | Descrição |
|---|---|
| `/login` | Login (super admin ou tenant) |
| `/super-admin` | Painel do super administrador |
| `/omnichannel/conversations` | Atendimento omnichannel |
| `/crm/organizations` | CRM de organizações |
| `/crm/contacts` | CRM de contatos |
| `/admin/*` | Configurações do tenant |
