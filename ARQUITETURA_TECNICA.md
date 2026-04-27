# ZiraDesk — Arquitetura Técnica do MVP
> Documento vivo — atualizar conforme o projeto evolui.

---

## 1. VISÃO GERAL

Sistema SaaS multitenant de CRM com módulos de omnichannel, 
gestão de clientes, tickets e administração.
Modelo de isolamento: Schema-per-tenant no PostgreSQL.

### Módulos do MVP (ordem de prioridade)
1. Super Admin (gestão de tenants e planos)
2. Painel Admin do Tenant (configurações, usuários, integrações)
3. CRM (perfil 360 de clientes)
4. Omnichannel (chat unificado: WhatsApp, Instagram, E-mail)
5. Gestão de Tickets

---

## 2. STACK TECNOLÓGICA

### Backend
- Runtime: Node.js 20 LTS
- Framework: Fastify 4
- Linguagem: TypeScript (strict)
- ORM: Prisma
- Banco: PostgreSQL 16
- Cache/Fila: Redis 7 + BullMQ
- Realtime: Socket.io 4
- Auth: JWT (15min) + Refresh Token httpOnly cookie (7 dias)
- Validação: Zod
- Uploads: MinIO (S3-compatible)
- Email: Resend
- Logs: Pino
- Testes: Vitest + Supertest

### Frontend
- Framework: React 18 + Vite
- Linguagem: TypeScript (strict)
- Roteamento: React Router v6
- Estado servidor: TanStack Query v5
- Estado cliente: Zustand
- Forms: React Hook Form + Zod
- Realtime: Socket.io-client
- Estilo: Tailwind CSS
- i18n: i18next + react-i18next

### Infraestrutura (MVP)
- Deploy: Railway.app
- CDN/Storage: Cloudflare R2
- DNS: Cloudflare (wildcard *.ziradesk.com.br)
- CI/CD: GitHub Actions
- Monitoramento: Sentry + Umami

---

## 3. IDENTIDADE VISUAL

- Nome: ZiraDesk
- Cor primária: #00C9A7 (teal) / hover: #00E8C0
- Tema: dark (#0E0F11 fundo, #141518 superfícies)
- Logo: ícone "Z" estilizado, fundo #0F172A, border-radius 12px
- Fonte: IBM Plex Sans
- Subdomínios: empresa.ziradesk.com.br

---

## 4. INTERNACIONALIZAÇÃO (i18n)

- Biblioteca: i18next + react-i18next
- Idiomas: pt-BR (padrão), en-US, es
- Escopo: interface, e-mails transacionais, erros da API
- Detecção: automática pelo browser, salva preferência no banco
- Estrutura: apps/web/src/locales/{idioma}/{namespace}.json
- Namespaces: common, auth, crm, omnichannel, tickets, admin
- Backend: header Accept-Language define idioma das mensagens de erro

---

## 5. ESTRATÉGIA MULTITENANT — SCHEMA PER TENANT

Cada tenant recebe um schema isolado no PostgreSQL.
O schema public é reservado para dados globais.
public/
tenants
plans
subscriptions
super_admins
tenant_{slug}/
users
clients
channels
conversations
messages
tickets
ticket_comments
audit_logs

### Resolução por subdomínio
empresa.ziradesk.com.br
→ middleware extrai "empresa"
→ busca tenant no schema public
→ SET search_path = tenant_empresa
→ queries operam no schema correto

---

## 6. MODELO DE BANCO — SCHEMA PUBLIC

```sql
plans: id, name, slug, price_month, price_year, 
       max_users, max_contacts, features(JSONB), 
       is_active, created_at

tenants: id, name, slug, schema_name, plan_id(FK),
         status, trial_ends_at, settings(JSONB), created_at

subscriptions: id, tenant_id(FK), plan_id(FK), status,
               current_period_start, current_period_end,
               payment_gateway, gateway_sub_id, created_at

super_admins: id, name, email, password_hash, created_at
```

## 7. MODELO DE BANCO — SCHEMA TENANT

```sql
users: id, name, email, password_hash, role, avatar_url,
       status, last_seen_at, language, settings(JSONB), created_at

clients: id, type, name, email, phone, document, website,
         status, address_*, birth_date, gender, occupation,
         income, segment, lead_source, responsible_id(FK),
         tags(TEXT[]), custom_fields(JSONB), created_at, updated_at

channels: id, type, name, credentials(JSONB criptografado),
          status, settings(JSONB), created_at

conversations: id, client_id(FK), channel_id(FK), channel_type,
               external_id, status, assigned_to(FK), subject,
               last_message, last_message_at, resolved_at,
               metadata(JSONB), created_at

messages: id, conversation_id(FK), sender_type, sender_id,
          content, content_type, media_url, external_id,
          status, is_internal, metadata(JSONB), created_at

tickets: id, client_id(FK), conversation_id(FK), title,
         description, status, priority, category,
         assigned_to(FK), resolved_at, due_date,
         tags(TEXT[]), custom_fields(JSONB), created_at, updated_at

ticket_comments: id, ticket_id(FK), user_id(FK), content,
                 is_internal, created_at

audit_logs: id, user_id, action, entity, entity_id,
            old_data(JSONB), new_data(JSONB), ip_address, created_at
```

---

## 8. ARQUITETURA DE API

### Padrão de resposta
```typescript
// Sucesso
{ success: true, data: {...}, meta: { page, total, per_page } }

// Erro
{ success: false, error: { code, message, details } }
```

### Rotas principais
/api/auth         → login, logout, refresh, forgot, reset
/api/super-admin  → tenants CRUD, planos CRUD, métricas
/api/admin        → settings, users, channels, stats
/api/crm          → clients CRUD, timeline, tags
/api/omnichannel  → conversations, messages, assign, resolve
/api/tickets      → tickets CRUD, comments
/api/webhooks     → whatsapp, instagram, email (sem JWT)

---

## 9. REALTIME — SOCKET.IO

### Rooms
tenant:{tenantId}       → todos os agentes do tenant
agent:{userId}          → notificações individuais
conversation:{id}       → agentes dentro de uma conversa

### Eventos servidor → cliente
conversation:message    → nova mensagem recebida
conversation:assigned   → conversa atribuída
conversation:status     → status alterado
conversation:typing     → cliente digitando
ticket:created          → novo ticket
ticket:updated          → ticket atualizado

---

## 10. SEGURANÇA E LGPD

- Senhas: bcrypt custo 12
- JWT: 15min access + 7 dias refresh em httpOnly cookie
- Rate limiting por IP e por tenant
- Credenciais de canais: AES-256 no banco
- Audit log em todas as alterações de dados de clientes
- HTTPS obrigatório via Cloudflare
- Validação Zod em todas as rotas
- Isolamento total entre schemas de tenants

---

## 11. ESTRUTURA DE PASTAS
ziradesk/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── config/        (env.ts, database.ts)
│   │   │   ├── middleware/    (tenant.ts, auth.ts, rbac.ts, language.ts)
│   │   │   ├── modules/       (auth, super-admin, admin, crm, omnichannel, tickets)
│   │   │   ├── jobs/          (BullMQ workers)
│   │   │   ├── socket/        (Socket.io)
│   │   │   └── server.ts
│   │   └── prisma/
│   └── web/
│       └── src/
│           ├── locales/       (pt-BR, en-US, es)
│           ├── layouts/       (TenantLayout, SuperAdminLayout, AuthLayout)
│           ├── pages/         (auth, super-admin, admin, crm, omnichannel, tickets)
│           ├── components/    (ui, crm, omnichannel, tickets)
│           ├── hooks/         (useAuth, useTenant, useSocket)
│           ├── stores/        (auth.store, socket.store)
│           ├── services/      (api.ts)
│           └── lib/           (i18n.ts)
└── packages/
    └── shared/                (@ziradesk/shared — tipos e schemas Zod)

---

## 12. PLANO DE SPRINTS

| Sprint | Módulo | Status | Estimativa |
|--------|--------|--------|------------|
| 0 | Fundação (monorepo, banco, auth, Socket.io) | ✅ Concluído | 3-5 dias |
| 1 | Super Admin (tenants, planos, dashboard) | 🔄 Em andamento | 2-3 dias |
| 2 | Admin do Tenant (usuários, canais, config) | ⏳ Pendente | 3-4 dias |
| 3 | CRM (clientes, perfil 360, timeline) | ⏳ Pendente | 4-5 dias |
| 4 | Tickets (CRUD, comentários, notificações) | ⏳ Pendente | 3-4 dias |
| 5 | Omnichannel (WhatsApp, Instagram, Email) | ⏳ Pendente | 7-10 dias |
| 6 | Polimento MVP (onboarding, testes, deploy) | ⏳ Pendente | 3-4 dias |

**Total estimado: 25-35 dias de desenvolvimento focado**

---

## 13. VARIÁVEIS DE AMBIENTE

```env
# App
NODE_ENV=production
PORT=3333
APP_URL=https://app.ziradesk.com.br
API_URL=https://api.ziradesk.com.br

# Database
DATABASE_URL=postgresql://user:pass@host:5432/ziradesk

# Redis
REDIS_URL=redis://host:6379

# Auth
JWT_SECRET=
JWT_REFRESH_SECRET=
ENCRYPTION_KEY=   # AES-256 para credenciais dos canais

# Storage
STORAGE_ENDPOINT=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
STORAGE_BUCKET=

# Email
RESEND_API_KEY=

# WhatsApp (Evolution API)
EVOLUTION_API_URL=
EVOLUTION_API_KEY=

# Meta (Instagram)
META_APP_ID=
META_APP_SECRET=
META_VERIFY_TOKEN=

# Sentry
SENTRY_DSN=
```

---

## 14. DECISÕES TÉCNICAS

| Decisão | Alternativa | Justificativa |
|---------|-------------|---------------|
| Fastify | Express | 2x mais rápido, TypeScript nativo |
| Schema-per-tenant | Row-level | Isolamento real, sem risco de vazamento |
| BullMQ | node-cron | Filas robustas, retry automático |
| Prisma | TypeORM | DX superior, type-safety completo |
| pnpm workspaces | npm/yarn | Mais rápido, melhor para monorepo |
| Railway | Heroku | Postgres + Redis + deploy integrado |
| Evolution API | Twilio | Open source, sem custo por mensagem |
| i18next | react-intl | Mais flexível, melhor DX, ampla adoção |
