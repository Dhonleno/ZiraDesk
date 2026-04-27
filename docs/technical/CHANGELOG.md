# Changelog — ZiraDesk

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

## [0.1.1] — i18n
### Adicionado
- i18next + react-i18next no frontend
- Suporte a pt-BR, en-US e es
- Detecção automática de idioma pelo browser
- Namespaces: common, auth
- Middleware de linguagem no backend (Accept-Language)
- Mensagens de erro da API internacionalizadas
