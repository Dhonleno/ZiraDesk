# ZiraDesk — O que o sistema é hoje

Data de referência: 18/06/2026

## Resumo executivo

O ZiraDesk é uma plataforma SaaS B2B para atendimento ao cliente, operação omnichannel, CRM e gestão de tickets. O sistema foi construído para empresas que precisam centralizar conversas, contatos, organizações, chamados, métricas de atendimento e configurações operacionais em um ambiente multi-tenant.

Na prática, o produto hoje funciona como uma central de atendimento com:

- Atendimento omnichannel em tempo real.
- CRM de contatos e organizações.
- Gestão de tickets internos e externos.
- Portal do cliente para abertura e acompanhamento de tickets.
- Administração do tenant com usuários, permissões, canais, filas, bot, pausas, templates e LGPD.
- Super administração para controlar tenants, planos e métricas globais.
- Integrações com WhatsApp/Meta Cloud API, Redmine, Twilio Voice, e-mail/SMTP, storage local/R2 e OpenAI para recursos de IA.

O estado atual pode ser descrito como um MVP avançado funcional, com boa parte dos fluxos principais já implementada. O foco mais importante para evolução não é começar do zero, mas consolidar confiabilidade operacional, testes automatizados, observabilidade e acabamento de alguns canais/integrações.

## Público-alvo

O sistema é voltado para empresas que atendem clientes por múltiplos canais e precisam controlar operação, histórico e qualidade de atendimento.

Usuários típicos:

- Super Admin: administra a plataforma ZiraDesk como um todo.
- Owner: dono do ambiente de uma empresa cliente.
- Admin: configura usuários, canais, regras e operação do tenant.
- Agent: atende clientes, assume conversas, cria tickets e acompanha contatos.
- Viewer: consulta dados com permissões reduzidas.
- Cliente final: acessa o portal para abrir e acompanhar tickets.

## Proposta de valor

O ZiraDesk centraliza a operação de atendimento para reduzir dispersão entre canais, melhorar controle de fila, registrar histórico de relacionamento e dar visibilidade gerencial sobre performance.

Em vez de uma empresa operar WhatsApp, planilhas, e-mail, tickets e contatos em ferramentas separadas, o ZiraDesk concentra esses elementos em um ambiente único por tenant.

## Como o sistema está organizado

O produto tem três grandes áreas de experiência:

1. Área do tenant

   É a aplicação usada por agentes, administradores e owners da empresa cliente. Inclui omnichannel, CRM, tickets, administração, perfil, privacidade e monitor.

2. Portal do cliente

   É a área externa para clientes finais. Permite login, abertura de tickets, acompanhamento de solicitações, comentários e gestão básica de privacidade/LGPD.

3. Super Admin

   É a área global da plataforma. Permite gerenciar tenants, planos e métricas administrativas do SaaS.

## Módulos existentes

### 1. Omnichannel

O omnichannel é o núcleo operacional do sistema.

Hoje ele contempla:

- Lista de conversas.
- Fila de atendimentos.
- Atendimento humano por agente.
- Envio e recebimento de mensagens.
- Mensagens em tempo real via Socket.io.
- Status de presença do agente.
- Pausas e disponibilidade.
- Transferência de atendimento.
- Solicitação de ajuda.
- Encerramento com motivo e desfecho.
- Histórico de conversas.
- Métricas, performance e metas.
- Monitor/TV dashboard.
- Upload e exibição de mídia.
- Tags de conversas.
- Campanhas outbound.
- Envio ativo com janela de atendimento do WhatsApp.

O fluxo principal é:

Cliente envia mensagem -> webhook recebe a mensagem -> sistema identifica tenant e canal -> cria ou atualiza contato/conversa -> salva mensagem -> notifica agentes em tempo real -> conversa entra em fila ou atendimento.

### 2. CRM

O CRM organiza os dados de relacionamento.

Hoje existem dois cadastros principais:

- Organizações.
- Contatos.

O módulo permite:

- Criar, editar, listar e remover organizações.
- Criar, editar, listar e remover contatos.
- Vincular contatos a organizações.
- Ver estatísticas da organização.
- Ver conversas e tickets relacionados.
- Gerenciar tags de contatos.
- Importar contatos.
- Controlar acesso ao portal para contatos.
- Aplicar regras de privacidade/PII em dados sensíveis.

O CRM substitui a antiga ideia de "clientes" isolados por uma estrutura mais flexível: organização + contatos.

### 3. Tickets

O módulo de tickets registra demandas formais que precisam de acompanhamento.

Hoje ele contempla:

- Listagem e filtros de tickets.
- Criação de tickets.
- Detalhe do ticket.
- Status, prioridade, tipo e categoria.
- Responsável.
- Comentários.
- Anexos.
- Checklist.
- Lançamento de tempo.
- Relações entre tickets.
- Timeline.
- Métricas.
- Exportação.
- Vínculo com contato, organização e conversa de origem.

O ticket pode nascer de uma conversa ou ser criado manualmente.

### 4. Portal do cliente

O portal permite que clientes finais interajam com a empresa sem acessar a área administrativa.

Hoje ele contempla:

- Login do cliente.
- Recuperação e reset de senha.
- Dashboard.
- Listagem de tickets.
- Detalhe de tickets.
- Criação de tickets.
- Comentários em tickets.
- Consentimento LGPD.
- Solicitações de privacidade.

O acesso ao portal é controlado a partir do contato no CRM.

### 5. Administração do tenant

A área administrativa permite configurar a operação de uma empresa.

Hoje há telas e rotas para:

- Usuários.
- Papéis/permissões.
- Canais.
- Horário comercial.
- Configuração de voz.
- Regras de atendimento.
- Bot/menu de atendimento.
- Autoatribuição.
- Motivos de pausa.
- Habilidades.
- Respostas rápidas.
- Templates WhatsApp.
- Tipos e categorias de tickets.
- Tags de conversa.
- Tags de contatos.
- Motivos e desfechos de encerramento.
- Agente de IA.
- Integrações.
- Webhooks.
- LGPD.
- Configuração de fila.
- Configurações gerais do tenant.
- Onboarding inicial.

### 6. Super Admin

O Super Admin administra o SaaS como produto.

Hoje ele contempla:

- Dashboard global.
- Gestão de tenants.
- Detalhe de tenant.
- Gestão de planos.
- Métricas globais.

É a camada usada para controlar clientes da plataforma, planos contratados e estado dos ambientes.

### 7. LGPD e privacidade

O sistema possui funcionalidades voltadas a privacidade e proteção de dados.

Hoje existem recursos para:

- Consentimento LGPD de usuários e contatos.
- Exportação de dados.
- Solicitação de anonimização.
- Painel administrativo de solicitações LGPD.
- Anonimização de conversas por identificador externo.
- Retenção/anonimização automatizada por job.
- Tratamento de PII em campos sensíveis.
- Documento público de DPO e schema de exportação LGPD.

### 8. Notificações, busca e realtime

O sistema possui mecanismos transversais para operação em tempo real:

- Socket.io para eventos de conversa, mensagens, tickets e presença.
- Central de notificações.
- Busca global.
- Toasts no frontend.
- Indicadores de presença e disponibilidade.

## Integrações atuais

### WhatsApp / Meta Cloud API

O WhatsApp é a integração de canal mais madura hoje.

O sistema contempla:

- Webhook de entrada.
- Validação de assinatura Meta.
- Recebimento de mensagens e status.
- Envio de mensagens.
- Templates WhatsApp.
- Sincronização com Meta Graph API.
- Janela de 24 horas.
- Campanhas e envio ativo.
- CSAT por WhatsApp.

### Instagram e e-mail

Existem webhooks e estruturas para Instagram e e-mail, mas há limitação conhecida no envio outbound: o worker de envio ainda indica Instagram e e-mail como não implementados para disparo.

### Redmine

Existe integração com Redmine para vínculo entre tickets do ZiraDesk e issues externas, incluindo configuração administrativa e webhook.

### Twilio Voice

Existe módulo de chamadas com Twilio Voice, incluindo token, status e configuração de voz por tenant.

### SMTP / Resend

O sistema possui configuração SMTP e uso de e-mail transacional para fluxos como autenticação, portal, notificações e LGPD.

### OpenAI

Existe módulo administrativo de agente de IA e serviços de ingestão/conhecimento, com worker de indexação.

### Storage local/R2

O sistema suporta storage local e R2 para arquivos como logos, avatares, mídias e anexos.

## Arquitetura técnica em alto nível

O projeto é um monorepo pnpm.

Principais partes:

- `apps/web`: frontend React + Vite + TanStack Query.
- `apps/api`: backend Fastify + Prisma + Socket.io.
- `packages/shared`: tipos e schemas compartilhados.

Infraestrutura usada:

- PostgreSQL como banco principal.
- Redis para filas, jobs e processamento assíncrono.
- BullMQ para workers.
- Socket.io para realtime.
- Docker Compose para ambiente local e produção.

## Multi-tenant

O ZiraDesk usa isolamento por schema PostgreSQL.

O schema `public` guarda dados globais:

- Planos.
- Tenants.
- Assinaturas.
- Super admins.
- Configurações globais como voz por tenant.

Cada tenant tem seu próprio schema com dados operacionais:

- Usuários.
- Canais.
- Conversas.
- Mensagens.
- Contatos.
- Organizações.
- Tickets.
- Configurações administrativas.
- Presença de agentes.
- Tags.
- Pausas.
- Filas.
- Histórico e dados LGPD.

Essa estratégia reduz o risco de mistura de dados entre empresas e permite aplicar `search_path` por tenant nas operações da API.

## Segurança e controle de acesso

O sistema possui:

- JWT com access token.
- Refresh token em cookie HTTP-only.
- Middleware de autenticação.
- Middleware de tenant.
- RBAC por permissões.
- Rate limit por tipo de rota.
- Helmet.
- CORS configurado.
- Validação de webhooks da Meta.
- Criptografia de credenciais sensíveis de canais.
- Guardas de permissão no frontend e backend.

## Jobs e processamento assíncrono

O backend inicia vários workers e jobs operacionais:

- Envio de mensagens.
- Fechamento por inatividade.
- Cleanup de CSAT.
- Expiração de conversas em espera.
- Cleanup de presença de agentes.
- Processamento de fila pendente.
- Retenção e SLA LGPD.
- Indexação de conhecimento.
- Recálculo de posição na fila.
- Expiração de fila após 24 horas.
- Envio e agendamento de campanhas.
- Importação assíncrona de contatos.

Esses jobs sustentam a operação contínua do sistema sem depender apenas de ações síncronas do usuário.

## Experiência visual e frontend

O frontend usa um design system próprio documentado.

Características principais:

- Layout autenticado com topbar, navegação lateral e áreas internas de rolagem.
- Tema dark/light.
- Tokens CSS centralizados.
- Componentes reutilizáveis de UI.
- Microcópia em PT-BR com suporte a i18n.
- Rotas protegidas por autenticação e permissões.

O sistema tem arquivos de tradução para `pt-BR`, `en-US` e `es`.

## Estado atual por área

| Área | Estado hoje |
| --- | --- |
| Multi-tenant | Implementado com schema por tenant |
| Auth e RBAC | Implementado |
| Super Admin | Funcional |
| Admin do tenant | Funcional e amplo |
| CRM | Funcional |
| Tickets | Funcional |
| Omnichannel | Funcional, com WhatsApp mais maduro |
| Portal do cliente | Funcional |
| Campanhas | Implementadas para fluxos de campanha/contatos/envio |
| Métricas/performance/metas | Implementadas |
| LGPD | Implementada em vários pontos |
| WhatsApp | Implementado via Meta Cloud API |
| Instagram outbound | Estrutura existe, envio ainda limitado |
| E-mail outbound omnichannel | Estrutura existe, envio ainda limitado |
| Testes automatizados | Existem testes em alguns módulos, mas ainda não cobrem todo o produto |
| Observabilidade | Existe logging, mas ainda há pontos com `console.*` em runtime |

## Limitações e pontos de atenção conhecidos

1. Envio outbound de Instagram e e-mail ainda não está completo no worker de mensagens.
2. CSAT possui ponto de parametrização pendente para expiração por tenant.
3. Observabilidade ainda precisa ser consolidada com logger estruturado em todos os pontos críticos.
4. Há necessidade de ampliar testes automatizados para fluxos críticos: auth, isolamento multi-tenant, webhooks, envio de mensagens, tickets e LGPD.
5. Existem resquícios/nomes legados relacionados a `client`, embora o modelo atual seja contatos e organizações.

## Como explicar o sistema em uma frase

O ZiraDesk é um SaaS multi-tenant de atendimento ao cliente que une omnichannel, CRM, tickets, portal do cliente, automações operacionais, métricas e governança LGPD em uma única plataforma para equipes de suporte e relacionamento.

## Como explicar o sistema em um pitch curto

O ZiraDesk ajuda empresas a centralizar e controlar o atendimento ao cliente. Ele recebe mensagens de canais como WhatsApp, organiza conversas em filas, permite que agentes atendam em tempo real, mantém histórico no CRM, transforma demandas em tickets, oferece portal para clientes acompanharem solicitações e entrega métricas de operação para gestores. Tudo isso em uma arquitetura SaaS multi-tenant, com isolamento de dados por empresa e recursos administrativos para configurar canais, usuários, permissões, bots, filas, templates e políticas de privacidade.

