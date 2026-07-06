# Analise de precificacao do ZiraDesk

Data da auditoria: 19/06/2026
Escopo: leitura de codigo, schemas, rotas, servicos, workers, frontend, documentacao e infraestrutura do repositorio local.
Regra aplicada: nao foram estimados precos, custos de mercado, capacidades, margens ou volumes sem evidencia no repositorio.

## 1. Resumo executivo

O ZiraDesk tem base real para operar como SaaS B2B multi-tenant: tenants sao provisionados em schemas PostgreSQL proprios, existem planos, assinaturas, Super Admin, RBAC, canais, omnichannel, CRM, tickets, portal, campanhas, metricas, LGPD, jobs BullMQ, Socket.io, deploy Docker Compose e backup operacional documentado para PostgreSQL e uploads.

Para precificacao, o produto esta parcialmente preparado. O codigo aplica limites automaticos de usuarios ativos por tenant (`Plan.maxUsers`) e contatos (`Plan.maxContacts`). Tambem ha `Plan.features` e middleware `requireFeature`, mas ele cobre apenas parte dos recursos, como campanhas/WhatsApp, templates, SMTP/e-mail, metricas/relatorios, webhooks e metas. Nao ha quota automatica consolidada para canais, numeros WhatsApp, mensagens, campanhas mensais, storage, tickets, voz, IA, e-mails, webhooks entregues ou API.

Risco critico: vender planos com franquias ou excedentes automaticos antes de criar um ledger de uso por tenant. O sistema registra dados operacionais, mas ainda nao mede tudo com confiabilidade de faturamento. Mensagens, storage, IA, voz, e-mail, webhooks, importacoes e API exigem medicao adicional.

Backup: agora existem scripts versionados em `ops/backup.sh` e `ops/restore.sh`, workflow manual em `.github/workflows/backup-manual.yml` e documentacao em `docs/technical/DEPLOY_VPS_DOCKER_COMPOSE.md`. O backup cobre dump PostgreSQL e uploads para Cloudflare R2. Redis nao esta coberto pelos scripts, e restore testado periodicamente nao foi confirmado.

Principais bloqueios para comercializacao automatizada:
- Billing recorrente, gateway de pagamento, checkout, faturas, cupons e conciliacao nao estao implementados.
- Entitlement por feature existe, mas e parcial e nao cobre todo o produto.
- Medicao de consumo por tenant ainda nao e suficiente para cobrar excedentes.
- Webchat aparece como tipo de canal/feature, mas o fluxo completo de widget/entrada nao foi confirmado.
- Capacidade maxima de tenants, usuarios simultaneos, mensagens e workers e capacidade nao medida.

## 2. Inventario funcional

| Modulo | Funcionalidades | Estado | Pronto para comercializacao? | Limitacoes |
| ------ | --------------- | ------ | ---------------------------- | ---------- |
| Multi-tenant SaaS | Tenants, schemas isolados, status, trial, planos, assinaturas, Super Admin | Funcional com limitacoes | Sim, com venda assistida | Billing automatico ausente; backup por tenant nao automatizado |
| Super Admin | Dashboard, tenants, planos, metricas globais, provisionamento, suspensao/ativacao/cancelamento | Funcional com limitacoes | Sim para operacao interna | Sem checkout, inadimplencia automatica ou financeiro completo |
| Usuarios e RBAC | Owner, admin, supervisor, agent, viewer; permissoes; limite de usuarios | Funcional com limitacoes | Sim | MFA nao encontrado; usuario simultaneo sem limite comercial |
| Entitlement por plano | `Plan.features`, `requireFeature`, `hasFeature`, flags no frontend | Parcial | Sim para recursos ja guardados | Cobertura incompleta; nao cobre todos os modulos/rotas |
| Omnichannel | Inbox, filas, atribuicao, transferencia, presenca, pausas, tags, notas, historico, realtime | Funcional com limitacoes | Sim | Sem quota por mensagem/canal; capacidade nao medida |
| WhatsApp | Webhook Meta, envio, templates, midia, janela 24h, campanhas, CSAT | Funcional com limitacoes | Sim, com configuracao Meta | Custos/limites Meta externos; multiplos numeros sem limite comercial |
| Instagram | Webhook, envio via Graph, configuracao de canal | Parcial | Com ressalvas | Midias e maturidade menores que WhatsApp; depende de permissoes Meta |
| E-mail | Entrada Resend, saida SMTP/Resend, conversas/tickets | Funcional com limitacoes | Sim, com configuracao | Threads/anexos de entrada nao confirmados como completos |
| Webchat/live chat | Feature `live_chat`, tipo de canal `webchat`, UI de canal | Parcial | Nao como canal completo | Widget/entrada publica nao confirmados |
| Voz/Twilio | Token, chamada ativa, incoming, TwiML, status, gravacoes, call records | Funcional com limitacoes | Como adicional | Sem quota/minutos por tenant; custo externo Twilio |
| CRM | Contatos, organizacoes, tags, importacao, filtros, PII, portal access | Funcional com limitacoes | Sim | Limite automatico so para contatos; importacao precisa validar quota |
| Tickets | CRUD, categorias, tipos, prioridade, comentarios, anexos, checklist, relacoes, tempo, metricas, exportacao | Funcional com limitacoes | Sim | Sem limite por tickets/storage; SLA comercial nao consolidado |
| Portal do cliente | Login, reset, dashboard, tickets, comentarios, LGPD/consentimento | Funcional com limitacao de deploy | Parcial | Vhost `suporte.{tenant}` documentado como desativado no deploy atual |
| Campanhas | Criacao, contatos, template, agendamento, worker, daily_limit, opt-out, relatorio | Funcional com limitacoes | Sim para WhatsApp | Sem franquia comercial mensal; worker compartilhado |
| IA/base de conhecimento | OpenAI por tenant, artigos, chunks, embeddings, resposta GPT | Experimental/funcional com limitacoes | Como beta/adicional | Sem medicao de tokens/custo; sem quota |
| LGPD | Consentimento, exportacao/anonimizacao, retencao, SLA, PII masking/audit | Funcional com limitacoes | Sim como diferencial corporativo | Exclusao em backups nao confirmada; backup por tenant ausente |
| Relatorios/metricas | Omnichannel, performance, tickets, monitor TV, Super Admin, CSV | Funcional com limitacoes | Sim | Agendamento/envio por e-mail/BI nao confirmados |
| Webhooks/API externa | Webhooks administrativos e dispatcher outbound | Funcional com limitacoes | Como recurso avancado | Sem metering de eventos/retries para billing |
| Storage local/R2 | Logos, avatares, anexos, midias, documentos IA; provider local/R2 | Funcional com limitacoes | Sim tecnicamente | Sem medicao por tenant; antivirus nao encontrado |
| Backup operacional | `pg_dump -Fc`, tar de uploads, R2, retencao, restore interativo, workflow manual | Funcional com limitacoes | Sim para operacao inicial | Redis nao incluido; teste de restore nao confirmado |

### 2.1 Multi-tenant

Tenants sao criados em `apps/api/src/modules/super-admin/tenants/tenants.service.ts`. O fluxo cria registro em `public.tenants`, schema isolado `tenant_{slug}`, usuario owner no schema do tenant e `Subscription` em `public.subscriptions`. O schema publico contem `plans`, `tenants`, `subscriptions`, `super_admins` e tabelas globais; os dados operacionais ficam nos schemas dos tenants.

O isolamento e aplicado por `apps/api/src/middleware/tenant.ts` e `apps/api/src/middleware/tenantSchemaFromJwt.ts`, que resolvem tenant e aplicam `SET search_path TO "{schemaName}", public`. Tenants com status `suspended` ou `cancelled` sao bloqueados. Backup individual por tenant e migracao individual sao tecnicamente possiveis por schema, mas nao ha ferramenta automatizada confirmada.

Limites por plano ja existem parcialmente: `Plan.maxUsers`, `Plan.maxContacts` e `Plan.features`. O sistema esta preparado para aplicar limites diferentes por plano somente onde ha validacao ou `requireFeature`.

### 2.2 Usuarios, agentes e permissoes

Os papeis estao em `packages/shared/src/types/rbac.ts`: `super_admin`, `owner`, `admin`, `supervisor`, `agent`, `viewer`. Owner/admin possuem gestao ampla; supervisor atua em operacao/metricas; agent responde e gerencia atendimento/tickets; viewer visualiza. O limite de usuarios ativos e aplicado em `apps/api/src/modules/admin/users/users.service.ts`.

Autenticacao usa JWT, refresh token e cookie HTTP-only em `apps/api/src/modules/auth/auth.service.ts` e `auth.routes.ts`. Ha force logout por Redis. MFA nao foi encontrado. Usuarios possuem `status`; bloqueio/suspensao de usuario existe como estado operacional. Auditoria e PII aparecem em `audit_logs` e servicos LGPD.

Usuarios simultaneos nao sao limitados comercialmente. Presenca/socket existe, mas nao ha ledger de sessoes confiavel para faturamento.

### 2.3 Canais de atendimento

| Canal | Entrada | Saida | Producao | Limitacoes | Custo externo provavel | Pode compor plano? |
| ----- | ------- | ----- | -------- | ---------- | ---------------------- | ------------------ |
| WhatsApp | Sim, webhook Meta | Sim, Graph API | Sim, com credenciais Meta | Custos/limites Meta; multiplos numeros sem quota | Meta/cliente ou repasse | Sim |
| Instagram | Sim, webhook | Sim, Graph API | Parcial | Midia e maturidade menores; depende de permissoes | Meta/cliente ou repasse | Sim, preferencialmente plano superior |
| E-mail | Sim, Resend inbound | Sim, SMTP tenant ou Resend | Funcional com configuracao | Threads/anexos nao totalmente confirmados | SMTP/Resend | Sim |
| Voz/Twilio | Sim, TwiML | Sim, Twilio Voice | Funcional com limitacoes | Sem quota/minutos; callbacks externos | Twilio | Sim, como adicional |
| Webchat | Nao confirmado | Nao confirmado | Nao confirmado | Tipo/feature existe, fluxo completo nao | Nao confirmado | Nao ainda |

Evidencias: WhatsApp em `webhooks/whatsapp.webhook.ts`, `send-message.job.ts` e `admin/templates`; Instagram em `webhooks/instagram.webhook.ts`; e-mail em `webhooks/email.webhook.ts` e `services/email.service.ts`; voz em `modules/calls` e `admin/voice-config`.

### 2.4 Omnichannel e operacao

Recursos confirmados: inbox, conversas, mensagens, fila, autoatribuicao, assumir fila, transferencia, solicitacao de ajuda, pausas, presenca, habilidades, horario comercial, bot/menu, encerramento com motivo/desfecho, tags, respostas rapidas, notas internas, uploads/midia, busca global, monitor, TV, metricas, CSAT, SLA operacional, realtime e notificacoes.

Esses recursos permitem segmentacao funcional entre planos basicos, profissionais e avancados, mas varios ainda precisam de entitlement de backend e frontend para bloqueio real.

### 2.5 CRM

CRM inclui contatos, organizacoes, relacao contato-organizacao, tags, importacao CSV/XLSX/VCF, historico de conversas/tickets, campos customizados, PII masking/reveal, duplicidade por telefone/documento/e-mail, filtros e portal access. `maxContacts` e aplicado na criacao individual em `contacts.service.ts`. A importacao usa `contactImportQueue` e worker; nao foi confirmado que respeita `maxContacts` linha a linha com a mesma regra.

Limites comerciais viaveis: contatos ja e viavel; organizacoes, importacoes mensais, campos customizados, exportacoes e storage exigem medicao/entitlement.

### 2.6 Tickets

Tickets possuem criacao, status, prioridade, tipo, categoria, responsavel, comentarios, anexos, checklist, relacoes, timeline, tempo trabalhado, metricas, exportacao CSV, vinculo com contato/organizacao/conversa, portal e Redmine. Recursos que podem ser premium: Redmine, exportacoes, metricas avancadas, checklist, horas, portal, categorias/tipos customizados e SLA avancado. Nao ha limite por quantidade de tickets ou storage.

### 2.7 Portal do cliente

Portal possui login, reset, dashboard, tickets, comentarios e LGPD/consentimentos em `apps/api/src/modules/portal` e telas `apps/web/src/pages/portal`. O deploy atual em `docs/technical/DEPLOY_VPS_DOCKER_COMPOSE.md` informa que `suporte.{tenant}.ziradesk.com` esta desativado por cobertura TLS. Pode ser add-on, mas requer entitlement e ajuste de deploy para producao publica.

### 2.8 Campanhas e envio ativo

Campanhas incluem criacao, contatos, templates WhatsApp, agendamento, lancamento, pausa, cancelamento, duplicacao, opt-out, falhas e relatorio. `campaigns.routes.ts` usa `requireFeature('whatsapp')`. `campaigns.schema.ts` define `daily_limit`; `campaign-send.job.ts` tem concorrencia 1 e batch interno. Nao ha franquia mensal por plano nem ledger confiavel de mensagens faturaveis.

Custos da Meta devem ficar separados da mensalidade ou ser repassados com medicao. O sistema registra campanhas e mensagens, mas ainda precisa normalizar volume faturavel por tenant/canal/template.

### 2.9 IA e base de conhecimento

IA usa OpenAI por tenant: `admin/ai/ai-admin.service.ts` armazena chave criptografada, `ai.service.ts` usa `text-embedding-3-small` e `gpt-4o`, `knowledge-index.job.ts` indexa artigos. O que esta pronto: configuracao, base de conhecimento, embeddings e resposta. O que esta parcial: governanca, quota, metering e faturamento. Custo variavel: tokens/embeddings/OpenAI. Para cobrar por uso, e necessario persistir `usage` da OpenAI por tenant, modelo, artigo, conversa e periodo.

### 2.10 Integracoes

| Integracao | Finalidade | Estado | Configuracao por tenant | Custo externo | Risco operacional |
| ---------- | ---------- | ------ | ----------------------- | ------------- | ----------------- |
| Meta WhatsApp Cloud API | Mensagens, templates, midia, status, campanhas | Funcional com limitacoes | Sim, em canais | Sim | Limites, templates, qualidade, custos |
| Instagram Graph | DM/webhook/envio | Parcial | Sim, em canais | Possivel | Permissoes e maturidade |
| Redmine | Sincronizar tickets/issues/webhook | Funcional com limitacoes | Sim | Cliente | API externa e mapeamento |
| Twilio Voice | Chamadas, token, gravacoes | Funcional com limitacoes | Config tenant/numeros | Sim | Minutos, callbacks, gravacoes |
| SMTP | Envio de e-mail tenant | Funcional | Sim | Cliente/plataforma | Entrega e credenciais |
| Resend | E-mail transacional/inbound | Funcional com limitacoes | Global/tenant conforme fluxo | Sim | Custo por e-mail e webhooks |
| OpenAI | IA e embeddings | Experimental/funcional | Sim, chave por tenant | Sim | Tokens sem ledger |
| Cloudflare R2 | Storage app e backup R2 via rclone | Funcional com limitacoes | App via env; backup via VPS | Sim | Crescimento e credenciais |
| Webhooks outbound | Eventos externos | Funcional com limitacoes | Sim | Indireto | Retries/eventos sem metering |
| PostgreSQL/pgvector | Dados e embeddings | Funcional | Schema por tenant | Infra | Crescimento e queries |
| Redis/BullMQ | Jobs, filas, presenca | Funcional | Infra compartilhada | Infra | Tenant ruidoso |

Incluidas no plano base: infraestrutura core, CRM, tickets e atendimento basico. Add-ons pagos: voz, Redmine, IA, webhooks avancados, portal, campanhas de alto volume, white-label. Cobrar por consumo: Meta, Twilio, OpenAI, e-mail, storage, trafego, webhooks/API.

### 2.11 Armazenamento e arquivos

Storage local/R2 esta em `apps/api/src/lib/storage`. Uploads confirmados: avatares, logos, anexos de tickets, midias omnichannel, midia de template Meta e documentos de base de conhecimento. Limites encontrados: avatar/logo 2 MB, ticket attachment 10 MB, contato import 10 MB, omnichannel media 16 MB, template media 100 MB.

Nao e possivel saber com confiabilidade quanto cada tenant consome. Ticket attachments guardam `file_size`, mas nao ha agregacao por tenant/modulo/storage. Existe exclusao pontual de anexos/logos antigos, mas cleanup geral de arquivos orfaos nao foi encontrado. Ha risco de crescimento descontrolado. Para cobrar storage, criar tabela de arquivos por tenant, tamanho, modulo, status, chave e ciclo de vida.

### 2.12 Banco, escalabilidade e backup

PostgreSQL usa schemas por tenant e pgvector para IA. Existem indices criados em servicos/migrations para varios modulos, mas capacidade maxima nao foi medida. Crescimento previsivel: mensagens, conversas, tickets, anexos, auditoria, notificacoes, campanhas, chunks IA e call records. Ha paginacao em varios endpoints, mas relatorios/agregacoes podem ficar pesados sem materializacao/indices adicionais.

Backup operacional: `ops/backup.sh` faz `pg_dump -Fc` do banco e tar dos uploads para R2, com retencao diaria e mensal; `.github/workflows/backup-manual.yml` executa backup manual via SSH; `ops/restore.sh` restaura dump e opcionalmente uploads. Redis nao e salvo pelo script. Restore em ambiente real nao foi confirmado. Backup individual por tenant nao foi implementado.

### 2.13 Redis, BullMQ, jobs e workers

| Worker ou job | Finalidade | Frequencia | Consumo potencial | Controle por tenant | Risco |
| ------------- | ---------- | ---------- | ----------------- | ------------------- | ----- |
| `send-message.job.ts` | Envio WhatsApp/Instagram/e-mail | Por fila | Alto em campanhas/mensagens | Dados incluem tenant/schema | Tenant ruidoso pode afetar fila |
| `campaign-send.job.ts` | Disparo de campanhas | Por lancamento/scheduler | Alto | Campanha tem tenant/schema | Sem quota mensal |
| `campaign-scheduler.job.ts` | Agendar campanhas | A cada 5 min | Medio | Varre campanhas | Reagenda volume alto |
| `contact-import.job.ts` | Importacao de contatos | Por upload | Medio/alto | Job tem tenant/schema | Importacoes grandes |
| `knowledge-index.job.ts` | Indexar IA | Por artigo | Alto e custo OpenAI | Job tem tenant/schema | Tokens sem controle |
| `process-pending-queue.job.ts` | Processar fila pendente | Periodico | Medio | MAX_ASSIGN_PER_TENANT = 5 | Carga por tenant limitada parcialmente |
| `recalculate-queue-positions.job.ts` | Recalcular fila | Por evento | Medio | Job tem tenant/schema | Eventos frequentes |
| `queue-expire-24h.job.ts` | Expirar fila 24h | Periodico | Baixo/medio | Varre tenants | Volume alto |
| `waiting-expiry.job.ts` | Encerrar waiting expirado | Periodico | Baixo/medio | Varre tenants | Volume alto |
| `inactivity.job.ts` | Inatividade | Agendado por conversa | Medio | Dados tenant/schema | Muitos timers/jobs |
| `cleanup-csat.job.ts` | Limpar CSAT expirado | Horario | Baixo | Varre tenants | Baixo |
| `presence-cleanup.job.ts` | Limpar presenca | A cada 2 min | Baixo/medio | Varre tenants | Baixo |
| `lgpd-sla.job.ts` | SLA LGPD | A cada 6h | Medio | Varre tenants | E-mails/alertas |
| `lgpd-retention.job.ts` | Retencao/anonimizacao | Diaria | Alto se massa grande | Varre tenants | Operacao sensivel |

Um tenant pode consumir recursos excessivos por campanhas, importacoes, IA ou alto volume de mensagens. Nao ha isolamento de filas por tenant nem prioridade comercial.

### 2.14 Realtime e Socket.io

Socket.io esta em `apps/api/src/socket/index.ts`. Ha salas por tenant, usuario e conversa, presenca de agentes e eventos operacionais. Redis e usado para presenca/filas, mas Redis adapter para escalar Socket.io horizontalmente nao foi confirmado. Usuarios simultaneos devem entrar na precificacao ou ao menos no monitoramento, pois impactam conexoes, memoria, broadcast e atualizacoes em tempo real. Capacidade nao medida.

### 2.15 Seguranca, auditoria e LGPD

Seguranca: Fastify Helmet, CORS, rate limit, JWT, refresh cookie HTTP-only, RBAC, tenant middleware, validacao de webhook Meta, criptografia de credenciais, logs/auditoria e PII masking. MFA nao encontrado. Antivírus de uploads nao encontrado. Nao recomendo restringir controles legais ou basicos por plano; LGPD basica, seguranca e isolamento devem existir em todos os planos. Diferenciais corporativos possiveis: logs/auditoria avancados, exportacoes, retencao customizada, SSO/MFA futuro, SLA e DPO/consultoria.

### 2.16 Relatorios, dashboards e metricas

Relatorios e dashboards encontrados: Home, Super Admin dashboard, metricas omnichannel, performance de agentes/equipe, metas, monitor/TV, historico com CSV, tickets metrics/export CSV, CRM stats, campanhas, CSAT e LGPD metrics. Periodos/filtros aparecem em varios endpoints. Agendamento de relatorios e envio por e-mail nao foram encontrados.

### 2.17 Branding e personalizacao

Existe: nome do tenant, logo, cor primaria, timezone/idioma, tema dark/light, templates WhatsApp, SMTP/remetente e mensagens operacionais. Parcial/nao confirmado: dominio customizado, portal totalmente customizado, white-label completo, login customizado e relatorios white-label. White-label exigiria entitlement, TLS/dominios, templates de e-mail/portal por tenant e revisao de marca.

### 2.18 Super Admin, planos e assinaturas

Super Admin possui CRUD de planos, tenants, status, trial, suspensao/ativacao/cancelamento, metrics globais e uso parcial. `Plan` inclui preco mensal/anual, limites e features; `Subscription` inclui status, gateway e gatewaySubId. O que falta para billing SaaS: gateway, checkout, webhooks financeiros, inadimplencia automatica, faturas, cupons, descontos, upgrade/downgrade automatico, cobranca proporcional e ledger de uso.

## 3. Matriz de maturidade

| Area | Maturidade | Evidencia | Observacao comercial |
| ---- | ---------- | --------- | -------------------- |
| Core SaaS multi-tenant | Media/alta | `schema.prisma`, `tenants.service.ts`, `tenantSchemaFromJwt.ts` | Bom para venda assistida |
| Entitlement | Media | `middleware/entitlement.ts`, rotas com `requireFeature` | Parcial; ampliar cobertura |
| Usuarios/RBAC | Alta | `rbac.ts`, `users.service.ts` | Limite de usuarios ja aplicavel |
| WhatsApp | Alta relativa | `whatsapp.webhook.ts`, `send-message.job.ts`, `templates.service.ts` | Canal ancora comercial |
| Instagram | Media | `instagram.webhook.ts`, `send-message.job.ts` | Vender com ressalvas |
| E-mail | Media | `email.webhook.ts`, `email.service.ts`, SMTP routes | Bom como canal adicional |
| Voz/Twilio | Media | `calls.routes.ts`, `calls.service.ts` | Add-on com custo externo |
| Webchat | Baixa | `PLAN_FEATURES`, `channels.schema.ts`, `AddChannelModal.tsx` | Nao vender como completo |
| CRM | Alta | `crm/contacts`, `crm/organizations` | Contatos ja limitaveis |
| Tickets | Alta | `tickets.routes.ts`, `tickets.service.ts` | Bom para planos profissionais |
| Portal | Media | `portal.routes.ts`, deploy docs | Depende de TLS/vhost |
| Campanhas | Media | `campaigns.service.ts`, workers | Precisa quota/antiabuso |
| IA | Baixa/media | `ai.service.ts`, `ai-admin.service.ts`, `knowledge-index.job.ts` | Cobrar como beta/adicional |
| LGPD | Media/alta | `lib/lgpd`, `legal.routes.ts`, PII | Diferencial corporativo |
| Billing | Baixa | `Plan`, `Subscription`, telas Super Admin | Sem automacao financeira |
| Observabilidade/faturamento | Baixa | ausencia de ledger consolidado | Bloqueia excedentes automaticos |

## 4. Matriz de recursos por possivel plano

Esta segmentacao e tecnica e preliminar, sem valores financeiros. Onde nao ha bloqueio/medicao automatica, marquei a necessidade.

| Recurso | Essencial | Profissional | Avancado | Enterprise |
| ------- | --------- | ------------ | -------- | ---------- |
| Usuarios | Usar `Plan.maxUsers` | Usar `Plan.maxUsers` | Usar `Plan.maxUsers` | Usar `Plan.maxUsers` ou ilimitado |
| Contatos | Usar `Plan.maxContacts` | Usar `Plan.maxContacts` | Usar `Plan.maxContacts` | Usar `Plan.maxContacts` ou ilimitado |
| CRM | Sim | Sim | Sim + campos/processos | Sim + migracao/custom |
| Tickets | Basico | Completo | Completo + metricas/export | Custom/SLA contratual |
| Omnichannel | Inbox e canal base | Filas/autoatribuicao | Monitor, performance, metas | Alto volume/governanca |
| WhatsApp | 1 canal sugerido; requer quota de numero | Multiplos canais; requer quota | Multiplos numeros; requer quota | Custom |
| Instagram | Nao ou adicional | Opcional | Sim | Sim/custom |
| E-mail | Opcional | Sim | Sim | Sim/custom |
| Webchat | Nao vender ainda | Nao vender ainda | Nao vender ainda | Desenvolvimento especifico |
| Portal | Requer entitlement e deploy | Sim apos TLS | Sim | Dominio/custom |
| Campanhas | Nao ou limitada; requer quota | Sim; requer quota mensal | Avancado; requer quota/antiabuso | Alto volume sob contrato |
| IA | Nao | Opcional beta | Sim; requer medicao | Chave propria/SLA |
| Voz | Add-on | Add-on | Sim/add-on | Contrato especifico |
| Redmine | Nao | Opcional | Sim | Custom |
| Webhooks | Nao | Opcional | Sim via `requireFeature('webhooks')` | Sim |
| Relatorios | Basicos/proprios | Equipe/tickets | Performance/TV/export | Custom/BI |
| Storage | Requer medicao | Requer medicao | Requer medicao | Requer medicao/SLA |
| Suporte | Padrao | Prioritario | Prioritario | SLA contratual |

Valores de seed em `apps/api/prisma/seed.ts` existem apenas como dados do projeto; nao foram tratados como recomendacao financeira desta auditoria.

## 5. Custos fixos e variaveis identificados

| Servico | Uso no ZiraDesk | Quem deve contratar | Custo fixo ou variavel | Metrica de consumo |
| ------- | --------------- | ------------------- | ---------------------- | ------------------ |
| VPS/hosting | API, web, Nginx, Postgres, Redis | Plataforma | Fixo/escala infra | CPU, RAM, disco, trafego |
| PostgreSQL/pgvector | Dados multi-tenant e IA | Plataforma | Fixo/escala infra | DB size, queries, conexoes |
| Redis/BullMQ | Filas, jobs, presenca, cache | Plataforma | Fixo/escala infra | Jobs, memoria, ops |
| Storage local/R2 | Uploads, anexos, logos, documentos, backups | Plataforma | Fixo/variavel | Bytes, objetos, trafego |
| Meta WhatsApp | Mensagens, templates, campanhas | Cliente ou repasse | Variavel | Conversas/mensagens/templates |
| Instagram/Meta | DMs e midias | Cliente ou repasse | Variavel/externo | Mensagens/midias |
| Twilio | Voz e gravacoes | Cliente ou repasse | Variavel | Minutos, chamadas, gravacoes |
| SMTP/Resend | E-mail inbound/outbound/transacional | Cliente ou plataforma | Variavel | E-mails enviados/recebidos |
| OpenAI | IA, embeddings, respostas | Cliente com chave propria ou plataforma | Variavel | Tokens, embeddings, chamadas |
| Cloudflare DNS/TLS/CDN | DNS, proxy, certificados | Plataforma | Fixo/variavel | Dominios, trafego, regras |
| Backups R2/rclone | Dump PostgreSQL e uploads | Plataforma | Variavel | GB, objetos, retencao |
| Observabilidade/logs | Logs, metricas, alertas | Plataforma | Variavel | Eventos, logs, traces |
| Redmine | Integracao externa | Cliente | Externo | Issues, webhooks, API calls |

## 6. Metricas disponiveis para faturamento

| Metrica | E medida atualmente? | Onde esta armazenada? | Confiavel para cobranca? | Alteracao necessaria |
| ------- | -------------------- | --------------------- | ------------------------ | -------------------- |
| Usuarios ativos | Sim | `users.status` por schema | Sim para limite atual | Snapshot mensal |
| Usuarios cadastrados | Sim | `users` | Parcial | Definir regra ativo/inativo |
| Agentes simultaneos | Parcial | Socket/Redis/agent_assignments | Nao | Ledger de sessoes/conexoes |
| Canais | Sim | `channels` | Parcial | Quota por tipo/status |
| Numeros WhatsApp | Parcial | `channels.credentials` | Nao | Normalizar `phone_number_id` |
| Conversas | Sim | `conversations` | Parcial | Definir conversa faturavel |
| Mensagens enviadas | Sim | `messages`, status externo | Parcial | Ledger por provider/canal |
| Mensagens recebidas | Sim | `messages` | Parcial | Ledger mensal por tenant |
| Templates | Sim | `whatsapp_templates` | Parcial | Quota/status de sync |
| Campanhas | Sim | `campaigns`, `campaign_contacts` | Parcial | Quota mensal e uso por disparo |
| Contatos | Sim | `contacts` | Sim para criacao individual | Garantir importacao respeitando limite |
| Organizacoes | Sim | `organizations` | Parcial | Quota se desejado |
| Tickets | Sim | `tickets` | Parcial | Quota/retencao por plano |
| Armazenamento | Parcial | `ticket_attachments.file_size` e storage | Nao | Registro central de arquivos |
| Chamadas | Sim | `call_records` | Parcial | Validar callbacks/tenant |
| Minutos de voz | Parcial | `call_records.duration` | Parcial | Ledger mensal e reconciliacao Twilio |
| E-mails | Parcial | `messages`, tickets, Resend/SMTP | Nao | Ledger inbound/outbound |
| Tokens de IA | Nao | Nao encontrado | Nao | Persistir usage OpenAI |
| Documentos indexados | Sim | `knowledge_articles`, `knowledge_chunks` | Parcial | Quota artigos/chunks |
| Eventos webhook | Parcial | configs/logs operacionais | Nao | Log de entregas/retries |
| Requisicoes API | Nao por tenant | Logs infra | Nao | API metering por tenant/chave |

## 7. Metricas ainda nao disponiveis

Medições necessárias para precificacao avancada:
- Storage por tenant, modulo, arquivo e periodo.
- Mensagens faturaveis por canal/provedor.
- Sessoes/conexoes simultaneas por tenant.
- Consumo OpenAI por tenant, modelo e token.
- Minutos Twilio reconciliados com callbacks e gravacoes.
- E-mails enviados/recebidos com provider/status.
- Webhooks entregues, falhados e retries.
- Requisicoes API por tenant/chave.
- Volume de importacoes por tenant.
- Exportacoes/relatorios gerados.
- Campanhas/envios por mes e por template.
- Tamanho de banco por schema/tenant.
- Uso de workers/fila por tenant.

## 8. Servicos profissionais separaveis

| Servico | Separar da mensalidade? | Esforco relativo | Evidencia/justificativa |
| ------- | ------------------------ | ---------------- | ----------------------- |
| Implantacao inicial | Sim | Medio | Tenants, DNS, canais, SMTP, Meta |
| Diagnostico operacional | Sim | Medio | Filas, bot, tags, regras |
| Configuracao Meta/WhatsApp | Sim | Medio/alto | WABA, tokens, templates, webhooks |
| Configuracao Twilio | Sim | Medio | Numero, TwiML, callbacks |
| Migracao/importacao de dados | Sim | Medio/alto | Importacao existe, mas qualidade/mapping variam |
| Integracao Redmine | Sim | Medio | Credenciais e webhook externo |
| Treinamento | Sim | Baixo/medio | Perfis e modulos operacionais |
| Criacao de bots/menus | Sim | Medio | Bot menus/opcoes existem |
| Templates WhatsApp | Sim | Medio | Aprovacao Meta e sync |
| Campanhas assistidas | Sim | Medio | Opt-out, listas, templates |
| Consultoria de atendimento | Sim | Alto | Processos, metricas, SLA |
| Customizacao/white-label | Sim | Alto/muito alto | Requer desenvolvimento e TLS/domino |
| Suporte premium/SLA | Sim | Medio/alto | Operacao critica e terceiros |
| Operacao assistida | Sim | Alto | Monitoramento continuo/campanhas |

## 9. Riscos comerciais

| Risco | Probabilidade | Impacto | Acao recomendada | Bloqueia venda? |
| ----- | ------------- | ------- | ---------------- | --------------- |
| Vender franquia de mensagens sem ledger | Alta | Alto | Implementar metering por tenant/canal | Bloqueia planos por consumo |
| Vender storage excedente sem metrica | Alta | Alto | Criar tabela de arquivos e quota | Bloqueia storage cobrado |
| Vender IA por uso sem tokens | Alta | Alto | Capturar usage OpenAI | Bloqueia IA por consumo |
| Billing/gateway ausente | Alta | Alto | Integrar gateway ou operar cobranca manual documentada | Bloqueia self-service |
| Entitlement incompleto | Alta | Alto | Aplicar `requireFeature`/guards em todos os modulos vendaveis | Bloqueia promessas automatizadas |
| Tenant ruidoso em workers globais | Media/alta | Alto | Quotas, prioridade e rate limit por tenant | Nao bloqueia MVP assistido |
| Portal com vhost desativado | Alta | Medio/alto | Reemitir certificado e restaurar vhost | Bloqueia venda do portal publico |
| Webchat sem fluxo completo | Alta | Alto | Implementar widget, entrada, rotas e testes | Bloqueia webchat |
| Redis fora do backup operacional | Media | Medio | Definir se Redis e descartavel ou incluir snapshot | Nao bloqueia se estado for efemero |
| Restore nao testado periodicamente | Media | Alto | Criar rotina de teste de restore | Bloqueia clientes criticos |
| Sem MFA | Media | Medio | Implementar para corporativo | Nao bloqueia MVP, limita enterprise |
| Antivirus upload ausente | Media | Medio/alto | Adicionar scan/validacao | Pode bloquear setores regulados |
| Capacidade nao medida | Alta | Alto | Benchmark e monitoramento | Bloqueia promessas de volume |
| Custos externos mal atribuidos | Alta | Alto | Contrato claro e metering | Bloqueia margem previsivel |

## 10. Checklist de prontidao

### Obrigatorio antes do primeiro cliente pagante

- Definir contrato comercial para Meta, Twilio, OpenAI, SMTP, R2 e trafego.
- Documentar o que esta incluido: usuarios e contatos sao os limites automaticos principais.
- Nao vender webchat como canal funcional.
- Nao vender excedentes automaticos sem medicao.
- Validar backup PostgreSQL/uploads e executar teste de restore.
- Decidir se Redis precisa entrar no backup ou se e estado descartavel.
- Validar deploy, certificados, dominios e portal.
- Documentar cobranca manual/trial/renovacao enquanto nao houver gateway.
- Criar checklist de onboarding de canais.

### Recomendado para os primeiros cinco clientes

- Ampliar entitlement por `Plan.features` para todos os modulos vendaveis.
- Dashboard interno de uso por tenant.
- Alertas de mensagens, campanhas, storage e workers.
- Quota de campanhas/envios por tenant.
- Garantir importacao respeitando `maxContacts`.
- Monitoramento BullMQ por tenant.
- Cleanup de arquivos orfaos.
- Manual de suporte para Meta, Twilio, Resend, OpenAI e R2.

### Necessario para escalar

- Gateway de pagamento e webhooks financeiros.
- Ledger de uso por tenant.
- Billing de excedentes.
- Rate limit por tenant e modulo.
- Separacao/prioridade de filas para tenants grandes.
- Redis adapter para Socket.io se houver multiplas APIs.
- Observabilidade com metricas, logs, tracing e alertas.
- Benchmarks de capacidade.
- Backup/restore testado periodicamente.
- Storage quota por tenant.
- Medicao de tokens IA, minutos de voz, e-mails e API.
- Relatorios financeiros e MRR real.

## 11. Recomendacoes tecnicas para habilitar precificacao

1. Criar camada de entitlement completa:
   - Padronizar `Plan.features`.
   - Aplicar `requireFeature` em backend para modulos vendaveis.
   - Manter guards frontend apenas como UX.
   - Cobrir portal, voz, Redmine, IA, exportacoes, TV, webhooks, campanhas e relatorios avancados.

2. Criar ledger de uso:
   - Tabela com `tenant_id`, `metric`, `quantity`, `period`, `source`, `metadata`, `created_at`.
   - Alimentar por eventos: mensagens, campanhas, uploads, chamadas, IA, e-mail, webhooks, API e importacoes.

3. Criar quotas e politicas:
   - Usuarios e contatos ja existem.
   - Adicionar canais, numeros, campanhas, mensagens, storage, IA, voz, tickets, API e exportacoes.
   - Definir comportamento ao exceder: bloquear, alertar ou permitir excedente.

4. Separar custos externos:
   - Definir por tenant se cliente usa chave propria, plataforma repassa ou esta incluido.
   - Registrar provider sem expor secrets.

5. Fortalecer operacao:
   - Testar restore.
   - Monitorar BullMQ.
   - Medir uso por tenant.
   - Alertas antiabuso.
   - Testes de carga.

6. Automatizar billing:
   - Gateway, checkout, portal financeiro, webhooks de pagamento.
   - Atualizar `Subscription.status` e `Tenant.status`.
   - Implementar upgrade/downgrade e historico financeiro.

## 12. Duvidas que dependem de decisao do proprietario

- Custos Meta, Twilio, OpenAI, SMTP, R2 e trafego serao pagos pelo cliente ou repassados?
- Quais recursos entram obrigatoriamente em todos os planos?
- Havera trial self-service ou trial criado manualmente por Super Admin?
- Ao exceder limite, o sistema deve bloquear, cobrar excedente ou apenas alertar?
- Portal sera modulo base ou adicional?
- IA usara chave propria do cliente, chave da plataforma ou ambos?
- Voz sera modulo padrao ou add-on?
- Redmine sera plano avancado ou projeto pago?
- White-label sera produto formal ou customizacao enterprise?
- Qual nivel de SLA/suporte sera prometido?
- Quais dados precisam de retencao por contrato/plano?
- Redis precisa ser persistido em backup ou pode ser reconstruido?

## 13. Lista dos arquivos analisados

Principais arquivos consultados:
- `ARQUITETURA_TECNICA.md`
- `docs/product/SISTEMA_ATUAL.md`
- `docs/technical/DEPLOY_VPS_DOCKER_COMPOSE.md`
- `docs/technical/CHANGELOG.md`
- `.github/workflows/backup-manual.yml`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-contabo.yml`
- `ops/backup.sh`
- `ops/restore.sh`
- `docker-compose.yml`
- `docker-compose.production.yml`
- `deploy/nginx/conf.d/ziradesk.conf`
- `apps/api/package.json`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/seed.ts`
- `apps/api/src/server.ts`
- `apps/api/src/config/env.ts`
- `apps/api/src/config/redis.ts`
- `apps/api/src/middleware/auth.ts`
- `apps/api/src/middleware/tenant.ts`
- `apps/api/src/middleware/tenantSchemaFromJwt.ts`
- `apps/api/src/middleware/rbac.ts`
- `apps/api/src/middleware/entitlement.ts`
- `packages/shared/src/types/rbac.ts`
- `packages/shared/src/types/tenant.ts`
- `apps/api/src/modules/super-admin/tenants/tenants.service.ts`
- `apps/api/src/modules/super-admin/plans/plans.service.ts`
- `apps/api/src/modules/admin/users/users.service.ts`
- `apps/api/src/modules/admin/channels/channels.service.ts`
- `apps/api/src/modules/admin/settings/settings.service.ts`
- `apps/api/src/modules/admin/smtp`
- `apps/api/src/modules/admin/templates`
- `apps/api/src/modules/admin/voice-config`
- `apps/api/src/modules/admin/ai/ai-admin.service.ts`
- `apps/api/src/modules/admin/webhooks`
- `apps/api/src/modules/webhooks/whatsapp.webhook.ts`
- `apps/api/src/modules/webhooks/instagram.webhook.ts`
- `apps/api/src/modules/webhooks/email.webhook.ts`
- `apps/api/src/modules/omnichannel`
- `apps/api/src/modules/crm`
- `apps/api/src/modules/tickets`
- `apps/api/src/modules/portal`
- `apps/api/src/modules/calls`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/integrations/redmine`
- `apps/api/src/modules/notifications`
- `apps/api/src/modules/search`
- `apps/api/src/jobs`
- `apps/api/src/socket/index.ts`
- `apps/api/src/lib/storage`
- `apps/api/src/services/email.service.ts`
- `apps/web/src/pages`
- `apps/web/src/components`
- `apps/web/src/hooks/useTwilioCall.ts`
- `apps/web/src/services/api.ts`

## 14. Evidencias tecnicas

Planos, assinaturas e limites:
- `apps/api/prisma/schema.prisma` define `Plan`, `Tenant`, `Subscription`, `maxUsers`, `maxContacts` e `features`.
- `packages/shared/src/types/tenant.ts` define `PLAN_FEATURES`: `whatsapp`, `email`, `live_chat`, `reports`, `api_access`, `custom_domain`, `sla`, `webhooks`.
- `apps/api/src/middleware/entitlement.ts` implementa `requireFeature` e `hasFeature`.
- `apps/api/src/modules/omnichannel/campaigns/campaigns.routes.ts` usa `requireFeature('whatsapp')`.
- `apps/api/src/modules/admin/templates/templates.routes.ts` usa `requireFeature('whatsapp')`.
- `apps/api/src/modules/admin/smtp/smtp.routes.ts` usa `requireFeature('email')`.
- `apps/api/src/modules/omnichannel/metrics/metrics.routes.ts`, `performance.routes.ts`, `goals.routes.ts` e `tickets-metrics.routes.ts` usam `requireFeature('reports')` ou `sla`.
- `apps/api/src/modules/admin/webhooks/webhooks.routes.ts` usa `requireFeature('webhooks')`.
- `apps/api/src/modules/admin/users/users.service.ts` valida `maxUsers`.
- `apps/api/src/modules/crm/contacts/contacts.service.ts` valida `maxContacts`.

Tenant e isolamento:
- `apps/api/src/modules/super-admin/tenants/tenants.service.ts` cria schema, owner e subscription.
- `apps/api/src/middleware/tenant.ts` resolve tenant por host/subdominio e bloqueia status suspenso/cancelado.
- `apps/api/src/middleware/tenantSchemaFromJwt.ts` aplica `search_path`.

Canais e comunicacao:
- `apps/api/src/modules/admin/channels/channels.schema.ts` aceita `whatsapp`, `instagram`, `email`, `webchat`.
- `apps/api/src/modules/webhooks/whatsapp.webhook.ts` processa mensagens, status, bot, fila, CSAT e IA.
- `apps/api/src/jobs/send-message.job.ts` envia WhatsApp, Instagram e e-mail.
- `apps/api/src/modules/webhooks/instagram.webhook.ts` processa Instagram.
- `apps/api/src/modules/webhooks/email.webhook.ts` processa e-mail inbound.
- `apps/api/src/services/email.service.ts` envia SMTP/Resend.
- `apps/api/src/modules/calls/calls.routes.ts` e `calls.service.ts` implementam Twilio.

Campanhas, jobs e filas:
- `apps/api/src/modules/omnichannel/campaigns/campaigns.infrastructure.ts` cria tabelas de campanhas.
- `apps/api/src/modules/omnichannel/campaigns/campaigns.schema.ts` define `daily_limit`.
- `apps/api/src/jobs/campaign-send.job.ts` processa campanhas com concorrencia 1.
- `apps/api/src/jobs/campaign-scheduler.job.ts` agenda a cada 5 minutos.
- `apps/api/src/jobs/queue.ts` define filas BullMQ.
- `apps/api/src/server.ts` importa workers no bootstrap.

IA:
- `apps/api/src/modules/admin/ai/ai-admin.service.ts` grava chave OpenAI criptografada e mascara retorno.
- `apps/api/src/modules/ai/ai.service.ts` usa embeddings `text-embedding-3-small`, chunks e `gpt-4o`.
- `apps/api/src/jobs/knowledge-index.job.ts` indexa artigos em fila.
- Nao foi encontrado ledger de tokens OpenAI.

Storage e arquivos:
- `apps/api/src/lib/storage/index.ts` seleciona provider `local` ou `r2`.
- `apps/api/src/lib/storage/local.provider.ts` grava em `public/uploads`.
- `apps/api/src/lib/storage/r2.provider.ts` usa variaveis `R2_*`.
- `apps/api/src/modules/tickets/tickets.service.ts` grava `ticket_attachments.file_size`, limita anexos a 10 MB e exclui anexos em delecoes pontuais.
- `apps/api/src/modules/omnichannel/media/media.routes.ts` limita media a 16 MB.
- `apps/api/src/modules/auth/profile.routes.ts` e `admin/settings.routes.ts` limitam avatar/logo a 2 MB.

Backup e infraestrutura:
- `ops/backup.sh` gera dump PostgreSQL e tar de uploads, envia para R2 e aplica retencao.
- `ops/restore.sh` restaura dump PostgreSQL e opcionalmente uploads, com confirmacao interativa.
- `.github/workflows/backup-manual.yml` executa `/home/deploy/scripts/backup.sh` via SSH e lista R2.
- `docs/technical/DEPLOY_VPS_DOCKER_COMPOSE.md` documenta backup diario, R2, restore e logs.
- `docker-compose.production.yml` sobe Postgres, Redis, API, Web e Nginx, com uploads persistidos em `../data/uploads`.
- `deploy/nginx/conf.d/ziradesk.conf` e a documentacao de deploy indicam restricoes atuais do portal por TLS.

Seguranca e LGPD:
- `apps/api/src/server.ts` registra Helmet, CORS e rate limit.
- `apps/api/src/middleware/meta-signature.ts` valida assinatura Meta.
- `apps/api/src/middleware/rbac.ts` e `packages/shared/src/types/rbac.ts` definem permissoes.
- `apps/api/src/lib/lgpd` e `apps/api/src/modules/legal` implementam fluxos LGPD.
- `apps/api/src/utils/crypto.ts` e servicos de canais/AI/Redmine criptografam credenciais sensiveis.
