# Changelog — ZiraDesk

## [0.9.3] — Correção de anexos órfãos em tickets

### Corrigido
- Tickets: a listagem de anexos agora valida a existência do objeto no storage, remove registros órfãos e evita que o detalhe do ticket tente pré-carregar previews que resultariam em 404.
- Tickets: o autosave do detalhe consome cada patch debounced uma única vez, evitando loop de `PATCH` ao transferir/atribuir o ticket para outro agente.

## [0.9.2] — Skills v2, roteamento AND logic, reorganização de nav e bloqueadores de produção

### Adicionado
- Tickets: fila `queued`, auto-assign, claim e departamento no create (Bloco A)
- Tickets: presence status considerado no auto-assign (Bloco B)
- Tickets: e-mail de aviso de SLA 30min antes do vencimento (Bloco C)
- Tickets: aceitação explícita pelo agente designado
- Tickets: restrições de edição por status/role
- Tickets: pausa de SLA + escalação automática, CSAT por e-mail após resolução, notificações automáticas de e-mail ao contato, campo/modal de motivo de espera (`waiting_reason`), `ticket_number` sequencial com zero-padding
- Skills v2: novo modelo de dados (Fase 1), motor de roteamento AND logic com fallback inteligente (Fase 2), Admin UI + integração no BotMenu (Fase 3), métricas e limpeza do legado (Fase 4)
- Nav rail reorganizado: 12 itens → 8, com abas (Monitor+Fila, Análise = Métricas+Histórico+Performance, CRM = Contatos+Organizações)
- Nav lateral expansível
- Abrir atendimento diretamente pelo protocolo
- Script `apps/api/src/scripts/migrate-ticket-indexes.ts` — índices de `tickets` para tenants existentes

### Alterado
- Reestruturação visual do `TicketDetail` (arquétipo B)
- Refatoração visual do `Toaster` (estrutura zd-toast + ícones stroke-only)
- Melhorias visuais/UX da central de atendimento: bolha do cliente legível no tema claro, separador de mensagem de sistema, i18n da toolbar, hint Enter/Shift+Enter, painel de informações compactado
- `ensureTicketInfrastructure`: cache por schema (`Set<string>` via `current_schema()`) em vez de flag booleana global de processo — corrige tenants que ficavam sem o retrofit incremental de DDL

### Corrigido
- Guard de edição de ticket permitia agente fechar ticket resolvido
- SkillsV2: classe fantasma no header, selects cortados no modal de atribuição de agente
- Modal: `backdropFilter` blur removido (artefato de cor no overlay)
- Scroll vertical das colunas do kanban de tickets
- Busca de tickets por número e por status resolvido
- Categorias de ticket carregadas via API em vez de derivadas do lado do cliente
- i18n: nav rail, `OrganizationDetail`, componentes globais e páginas individuais (portal, campanhas, métricas, contatos, tickets, `CampaignDetail`, `ChecklistSection`, `TimeTrackingSection`)

### Removido
- Tipo `Ticket` duplicado em `packages/shared/src/types/ticket.ts` (não tinha consumidores)

### Segurança / Infraestrutura
- `tenantSchemaFromJwt.ts`: `schemaName` validado por regex (`^[a-z0-9_]+$`) antes de interpolar em `SET search_path` — fecha o vetor de injeção. **A race condition do `SET` sem `LOCAL` sob pool de conexões concorrente permanece — ver `ARQUITETURA_TECNICA.md` §16, é dívida técnica crítica, não foi resolvida nesta sessão.**
- `prisma/seed.ts`: seed do Super Admin agora falha (`throw`) se `SEED_SUPER_ADMIN_PASSWORD` não estiver definida — removido o fallback hardcoded (`ZiraDesk@2025`)
- Índices adicionados em `tickets(status)`, `tickets(assigned_to)`, `tickets(created_at)` e `tickets(department_id, status)` — ausentes desde a criação da tabela, agora presentes tanto no provisionamento de tenants novos quanto via script de migração para tenants existentes

### Documentação
- Auditoria completa de prontidão para produção (infra/deploy, banco/migrações, segurança, features críticas, testes, frontend, dívida técnica, config de produção, multitenancy, performance)
- `ARQUITETURA_TECNICA.md` §16 sincronizado: itens resolvidos marcados, novos itens registrados (race condition de `search_path`, bundle sem lazy-loading, CI não valida `apps/web`)

## [0.9.1] — Ajustes de Deploy Contabo
### Alterado
- Deploy de producao movido para workflow dedicado `.github/workflows/deploy-contabo.yml`
- Fluxo de deploy da VPS passou a usar `api-migrate` para `prisma migrate deploy`
- `docker-compose.production.yml` sobe apenas `postgres`, `redis`, `api`, `web` e `nginx` como servicos persistentes

### Corrigido
- Removida dependencia de `pnpm dlx` em runtime durante o deploy da Contabo
- Imagem final da API passou a embarcar o Prisma Client gerado no build
- Falha de restart da API em producao por `@prisma/client did not initialize yet`

### Documentacao
- `docs/technical/DEPLOY_VPS_DOCKER_COMPOSE.md` sincronizado com o workflow real da Contabo
- `docs/technical/DEPLOY.md` convertido para refletir a infra atual
- `ARQUITETURA_TECNICA.md` ajustado para VPS Contabo, dominios `.com` e portal desativado no Nginx

## [0.9.0] — Sprint de Estabilização
### Adicionado
- Abstração de storage com interface `StorageProvider`
- `R2StorageProvider` via `@aws-sdk/client-s3` (Cloudflare R2)
- `LocalStorageProvider` mantém comportamento de dev
- 78 testes de integração cobrindo: auth, middleware tenant, omnichannel webhooks, tickets, CRM, notifications, portal, super-admin, admin, calls, search, redmine, templates
- Portal: `POST /auth/forgot-password` e `POST /auth/reset-password`
- CI gate no GitHub Actions: testes obrigatórios antes do deploy Railway

### Alterado
- `settings.service.ts`, `profile.routes.ts`, `tickets.service.ts`: uploads migrados de disco local para `StorageProvider`
- Zero referências hardcoded a `public/uploads` no código

### Corrigido (correções de produção expostas pelos testes)
- Logout agora invalida sessão de fato (`auth:force_logout_after`)
- Tenant suspenso retorna 402 corretamente
- JWT de tenant A rejeitado em rotas de tenant B (403)
- HMAC inválido em webhooks retorna 401
- Webhooks WhatsApp/Instagram ignoram credenciais corrompidas sem quebrar
- `schemaName` propagado em tickets (`updateTicket`, `deleteTicket`, `attachments`)
- `schemaName` propagado em CRM (`organizations`, `contacts`)
- Vazamento de schema em eventos de tickets corrigido
- `channels.service.ts` e `channels.routes.ts` usam schema qualificado
- `tenants.service.ts` resiliente a schemas temporários durante agregação

### Documentação
- Sprint 3 (CRM) e Sprint 4 (Tickets) marcados como ✅ (estavam ❌)
- `ARQUITETURA_TECNICA.md` sincronizado com código real
- Nova seção 14: módulos além do MVP original
- Nova seção 15: dívida técnica conhecida

## [0.8.0] — Reestruturação do Omnichannel
### Adicionado
- Novo ciclo de status de conversas: `open`, `waiting` e `closed`.
- Migration multitenant para migrar status legados e adicionar `closure_reason`, `waiting_expires_at` e `queue_entered_at`.
- Nova fila operacional em `GET /api/omnichannel/queue`, com atribuição manual em `POST /api/omnichannel/queue/:id/assign-me`.
- Novo encerramento único em `POST /api/omnichannel/conversations/:id/close`, gravando motivo, desfecho, observações, agente e data de encerramento.
- Modal de encerramento consumindo os motivos/desfechos ativos cadastrados em `/api/omnichannel/close-config`.
- Job de expiração de conversas `waiting`, encerrando automaticamente envios ativos sem resposta.
- Separação de grupo e assunto do bot na fila de atendimento.

### Alterado
- Envio ativo passa a usar `status = waiting` com `conversation_type = outbound`.
- Conversas sem agente continuam com `status = open`, mas são tratadas como fila quando `assigned_to IS NULL`.
- Aba **Aberto** exibe apenas atendimentos atribuídos a agentes humanos.
- Página **Fila de atendimentos** exibe somente conversas abertas sem agente e mostra o tempo de espera na coluna **Espera**.
- Botão de encerramento simplificado para **Encerrar**.
- `omnichannelApi` passou a usar `closeConversation`, `getQueue`, `getQueueCount` e `assignMe`.

### Removido
- Fluxos legados baseados em `pending`, `resolved`, `bot`, `active_outbound` e `in_service`.
- Endpoint legado `/api/omnichannel/conversations/:id/resolve`.
- Modal legado `ResolveModal`.

### Compatibilidade
- Esta versão altera contrato de API e persistência. Rodar a migration Prisma antes do deploy da API/web.

## [0.7.0] — Sessão atual — Evolução pós-MVP
### Adicionado
- RBAC completo: middleware backend (requirePermission/requireAnyPermission),
  hook usePermission, PermissionGate, ProtectedRoute, tela de Permissões e Acessos
- Tipos compartilhados de permissões em packages/shared (Role, Permission, ROLE_PERMISSIONS)
- Validação x-hub-signature-256 nos webhooks Meta (WhatsApp + Instagram)
- Instagram outbound via Meta Graph API com retry inteligente e erros permanentes
- Email outbound via Resend com fallback de credenciais para .env
- CSAT expiration configurável por tenant (campo csatExpirationHours nas settings)
- Logger estruturado Pino com redact de dados sensíveis (substitui console.* de runtime)
- Super Admin Tenants: KPIs globais, colunas Usuários/Conversas/Trial até,
  dropdown de ações, impersonate, modal editar plano, confirmação de cancelamento
- Super Admin Dashboard: seções "Últimos tenants" e "Trials expirando em breve"
- Monitor em tempo real: subtítulo, contexto no SLA, CSAT com estrela
- Tela de Usuários: modal de confirmação Desativar/Reativar, badge "Você", estado vazio
- i18n Admin completo: nav lateral e Settings sem textos hardcoded
- Correção de presença: reconnect robusto, heartbeat manual 25s,
  grace period 5s, Page Visibility API
- Fix de logout involuntário na atribuição: auto-assign valida socket ativo,
  atribuição manual bloqueia agente offline (409)
- Filtros de notificação: sem notificação para conversas no bot (status=bot)
  e para conversas de outros agentes
- Balões de mensagem curtos: min-width e padding consistentes
- Remoção de Dashboard do painel Admin (redirect para Usuários)
- Remoção de EditClientModal.tsx órfão

### Corrigido
- Badge "Aguardando" em âmbar (era roxo) nas métricas de tickets
- i18n: pluralização "há 1 dia" (era "há 1 dias")
- Coluna Usuários: limite ilimitado exibe "—" em vez de "∞"
- Idioma padrão nas Settings agora aplica i18n.changeLanguage() imediatamente

---

## [0.6.1] — Sprint 6B — Preparação para produção
### Adicionado
- Code splitting com manualChunks (bundle < 500kB)
- Rota /health com verificação de banco e Redis
- Graceful shutdown (SIGTERM/SIGINT)
- CORS restrito para domínios ZiraDesk em produção
- Rate limiting por tipo de rota
- Dockerfile otimizado multi-stage para a API
- railway.toml para configuração de deploy
- scripts/deploy.sh automatizado
- docs/technical/DEPLOY.md completo

---

## [0.6.0] — Sprint 6 — Polimento MVP
### Adicionado
- Central de notificações in-app com badge e dropdown
- Busca global com atalho ⌘K/Ctrl+K
- Onboarding checklist para novos tenants
- Página de upgrade de plano
- Error boundary global
- Toast notifications em todas as ações
- Página 404 customizada
- Empty states em todas as listas

---

## [0.5.0] — Sprint 5B — Omnichannel Frontend completo
### Adicionado
- Layout 3 painéis: lista de conversas, chat e painel de info do contato
- Mensagens em tempo real via Socket.io (conversation:new_message, conversation:updated, conversation:created)
- Balões de mensagem com status de entrega (enviado / entregue / lido) e ícones de check
- Indicador de digitação animado (3 pontos pulsantes)
- Notas internas com fundo âmbar e label "NOTA INTERNA"
- Respostas rápidas como chips clicáveis no chat
- Auto-resize do textarea de mensagem
- Painel de info do contato com tabs: Contato, Canais, Histórico
- Mini-stats do contato: mensagens, atendimentos, 1º contato, engajamento
- Botão "Ver perfil completo" navegando para /crm/contacts?id=:id
- Ações rápidas: criar proposta, agendar, ver tickets, criar ticket
- Modal de criação de nova conversa (busca de contato + seleção de canal + assunto + mensagem inicial)
- Filtro "Meus atendimentos" com toggle animado na lista
- Unread dot e nome/preview em negrito para conversas com mensagens não lidas
- Badge de contagem de conversas no header da lista
- Botão "Novo atendimento" funcional na topbar e na lista (via CustomEvent)
- Namespace i18n `omnichannel` em pt-BR, en-US e es
- omnichannelApi em services/api.ts: listConversations, getConversation, createConversation, listMessages, sendMessage, resolve, assign, transfer

---

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
