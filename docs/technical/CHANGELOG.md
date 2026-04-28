# Changelog — ZiraDesk

## [0.5.0-backend] — Sprint 5A — Omnichannel Backend
### Adicionado
- Padronização de status: open, pending, resolved, bot (substituído in_service)
- Filtro assigned_to_me na listagem de conversas
- Criação de nova conversa via POST /api/omnichannel/conversations
- Rota de assign separada: POST /api/omnichannel/conversations/:id/assign
- Rota de transfer: POST /api/omnichannel/conversations/:id/transfer
- Socket.io: agent rooms (agent:{userId}) para notificações direcionadas
- Webhooks sem auth JWT: WhatsApp (Evolution API), Instagram (Meta Graph), Email (Resend inbound)
- Verificação HMAC-SHA256 no webhook WhatsApp via EVOLUTION_API_KEY
- Verificação de token no webhook Instagram via META_VERIFY_TOKEN
- Lookup cross-tenant por instance/page_id/email nas credenciais dos canais
- Processamento de webhooks em transações Prisma com SET LOCAL search_path
- Fila de mensagens BullMQ (3 tentativas, backoff exponencial 2s)
- Worker de envio real via Evolution API para WhatsApp
- config/redis.ts centralizado com ioredis
- utils/crypto.ts com decryptCredentials compartilhado

---

## [0.1.1] — i18n
### Adicionado
- i18next + react-i18next no frontend
- Suporte a pt-BR, en-US e es
- Detecção automática de idioma pelo browser
- Namespaces: common, auth
- Middleware de linguagem no backend (Accept-Language)
- Mensagens de erro da API internacionalizadas

---

## [0.1.0] — Sprint 0 — Fundação
### Adicionado
- Monorepo pnpm workspaces (apps/api, apps/web, packages/shared)
- PostgreSQL 16 + Redis 7 via Docker Compose
- Schema público com tabelas: plans, tenants, subscriptions, super_admins
- Autenticação JWT com access token (15min) + refresh token (7 dias) em httpOnly cookie
- Middleware de tenant por subdomínio com SET search_path
- Middleware de autenticação e RBAC
- Socket.io com rooms por tenant
- Axios com interceptor de refresh automático de token
- Zustand store de autenticação
- React Router v6 com guards RequireAuth e RequireSuperAdmin
- Tela de login e recuperação de senha
- Componentes UI base: Button, Input, Card
- i18n completo: pt-BR, en-US, es (interface + erros da API)
- Middleware de linguagem no backend (Accept-Language)
