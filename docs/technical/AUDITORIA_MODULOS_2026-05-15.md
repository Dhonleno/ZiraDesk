# Auditoria de Módulos e Estrutura — ZiraDesk

Data: 2026-05-15
Escopo: mapeamento completo de arquivos + análise de estado por módulo + débitos técnicos.

## 1) Estrutura de arquivos

### apps/web/src/pages/

```text
apps/web/src/pages\admin\AIAgent.tsx
apps/web/src/pages\admin\AutoAssign.tsx
apps/web/src/pages\admin\BotMenu.tsx
apps/web/src/pages\admin\BusinessHours.tsx
apps/web/src/pages\admin\Channels.tsx
apps/web/src/pages\admin\CloseConfig.tsx
apps/web/src/pages\admin\ConversationTags.tsx
apps/web/src/pages\admin\PauseReasons.tsx
apps/web/src/pages\admin\QuickReplies.tsx
apps/web/src/pages\admin\Roles.tsx
apps/web/src/pages\admin\Settings.tsx
apps/web/src/pages\admin\Skills.tsx
apps/web/src/pages\admin\TicketTypes.tsx
apps/web/src/pages\admin\Users.tsx
apps/web/src/pages\auth\ForgotPassword.tsx
apps/web/src/pages\auth\Login.tsx
apps/web/src/pages\crm\Contacts.tsx
apps/web/src/pages\crm\Organizations.tsx
apps/web/src/pages\NotFound.tsx
apps/web/src/pages\omnichannel\Conversations.tsx
apps/web/src/pages\omnichannel\Metrics.tsx
apps/web/src/pages\portal\PortalCreateTicket.tsx
apps/web/src/pages\portal\PortalDashboard.tsx
apps/web/src/pages\portal\PortalLogin.tsx
apps/web/src/pages\portal\PortalTicketDetail.tsx
apps/web/src/pages\portal\PortalTickets.tsx
apps/web/src/pages\profile\Profile.css
apps/web/src/pages\profile\Profile.tsx
apps/web/src/pages\settings\Upgrade.tsx
apps/web/src/pages\super-admin\Dashboard.tsx
apps/web/src/pages\super-admin\Plans.tsx
apps/web/src/pages\super-admin\TenantDetail.tsx
apps/web/src/pages\super-admin\Tenants.tsx
apps/web/src/pages\tickets\CreateTicket.tsx
apps/web/src/pages\tickets\TicketDetail.tsx
apps/web/src/pages\tickets\Tickets.tsx
apps/web/src/pages\tv\TVDashboard.tsx
```

### apps/web/src/components/

```text
apps/web/src/components\admin\AddChannelModal.tsx
apps/web/src/components\admin\EditChannelModal.tsx
apps/web/src/components\admin\EditUserModal.tsx
apps/web/src/components\admin\InviteUserModal.tsx
apps/web/src/components\admin\ResetPasswordModal.tsx
apps/web/src/components\crm\ContactAvatar.tsx
apps/web/src/components\crm\ContactBadge.tsx
apps/web/src/components\crm\ContactCard.tsx
apps/web/src/components\crm\ContactDetail.tsx
apps/web/src/components\crm\CreateContactModal.tsx
apps/web/src/components\crm\CreateOrganizationModal.tsx
apps/web/src/components\crm\EditClientModal.tsx
apps/web/src/components\crm\EditContactModal.tsx
apps/web/src/components\crm\EditOrganizationModal.tsx
apps/web/src/components\crm\LinkOrganizationModal.tsx
apps/web/src/components\crm\OrganizationCard.tsx
apps/web/src/components\crm\OrganizationDetail.tsx
apps/web/src/components\crm\OrganizationStats.tsx
apps/web/src/components\crm\SelectChannelModal.tsx
apps/web/src/components\layout\PageShell.tsx
apps/web/src/components\omnichannel\AgentStatsModal.tsx
apps/web/src/components\omnichannel\AudioRecorder.tsx
apps/web/src/components\omnichannel\CallWidget.tsx
apps/web/src/components\omnichannel\ChatArea.tsx
apps/web/src/components\omnichannel\ConversationList.tsx
apps/web/src/components\omnichannel\ConversationTimer.tsx
apps/web/src/components\omnichannel\CreateConversationModal.tsx
apps/web/src/components\omnichannel\InfoPanel.tsx
apps/web/src/components\omnichannel\MediaUpload.tsx
apps/web/src/components\omnichannel\MessageMedia.tsx
apps/web/src/components\omnichannel\MessageStatus.tsx
apps/web/src/components\omnichannel\PauseModal.tsx
apps/web/src/components\omnichannel\RequestHelpModal.tsx
apps/web/src/components\omnichannel\ResolveModal.tsx
apps/web/src/components\omnichannel\TagDropdown.tsx
apps/web/src/components\omnichannel\TransferModal.tsx
apps/web/src/components\onboarding\OnboardingChecklist.tsx
apps/web/src/components\portal\PortalGuard.tsx
apps/web/src/components\portal\PortalUserMenu.tsx
apps/web/src/components\super-admin\CreatePlanModal.tsx
apps/web/src/components\super-admin\CreateTenantModal.tsx
apps/web/src/components\tickets\AssignTicketModal.tsx
apps/web/src/components\tickets\ChecklistSection.tsx
apps/web/src/components\tickets\CreateTicketModal.tsx
apps/web/src/components\tickets\createTicketShared.ts
apps/web/src/components\tickets\SourceBadge.tsx
apps/web/src/components\tickets\TicketCard.tsx
apps/web/src/components\tickets\TicketComments.tsx
apps/web/src/components\tickets\TicketPriorityBadge.tsx
apps/web/src/components\tickets\TicketRelations.tsx
apps/web/src/components\tickets\TicketStatusBadge.tsx
apps/web/src/components\tickets\TimeTrackingSection.tsx
apps/web/src/components\ui\Badge.tsx
apps/web/src/components\ui\Button.tsx
apps/web/src/components\ui\Card.tsx
apps/web/src/components\ui\ConfirmModal.tsx
apps/web/src/components\ui\ErrorBoundary.tsx
apps/web/src/components\ui\FloatingChatBubble.css
apps/web/src/components\ui\FloatingChatBubble.tsx
apps/web/src/components\ui\GlobalSearch.tsx
apps/web/src/components\ui\Input.tsx
apps/web/src/components\ui\Lightbox.tsx
apps/web/src/components\ui\Modal.tsx
apps/web/src/components\ui\NotificationCenter.tsx
apps/web/src/components\ui\Pagination.tsx
apps/web/src/components\ui\PermissionGate.tsx
apps/web/src/components\ui\PhoneInput.tsx
apps/web/src/components\ui\Skeleton.tsx
apps/web/src/components\ui\Toaster.tsx
```

### apps/web/src/hooks/

```text
apps/web/src/hooks\useAgentStatus.ts
apps/web/src/hooks\useAuth.ts
apps/web/src/hooks\useDebounce.ts
apps/web/src/hooks\useFFmpeg.ts
apps/web/src/hooks\useNotification.ts
apps/web/src/hooks\usePermission.ts
apps/web/src/hooks\usePortalUser.ts
apps/web/src/hooks\useTenant.ts
apps/web/src/hooks\useTwilioCall.ts
```

### apps/web/src/stores/

```text
apps/web/src/stores\auth.store.ts
apps/web/src/stores\notification.store.ts
apps/web/src/stores\toast.store.ts
```

### apps/web/src/layouts/

```text
apps/web/src/layouts\AdminLayout.tsx
apps/web/src/layouts\AuthLayout.tsx
apps/web/src/layouts\PortalLayout.tsx
apps/web/src/layouts\SuperAdminLayout.tsx
apps/web/src/layouts\TenantLayout.tsx
```

### apps/api/src/modules/

```text
apps/api/src/modules\admin\ai\ai-admin.routes.ts
apps/api/src/modules\admin\ai\ai-admin.service.ts
apps/api/src/modules\admin\auto-assign\auto-assign.routes.ts
apps/api/src/modules\admin\auto-assign\auto-assign.schema.ts
apps/api/src/modules\admin\auto-assign\auto-assign.service.ts
apps/api/src/modules\admin\auto-assign\index.ts
apps/api/src/modules\admin\bot\bot.routes.ts
apps/api/src/modules\admin\bot\bot.schema.ts
apps/api/src/modules\admin\bot\bot.service.ts
apps/api/src/modules\admin\business-hours\business-hours.routes.ts
apps/api/src/modules\admin\business-hours\business-hours.schema.ts
apps/api/src/modules\admin\business-hours\business-hours.service.ts
apps/api/src/modules\admin\channels\channels.routes.ts
apps/api/src/modules\admin\channels\channels.schema.ts
apps/api/src/modules\admin\channels\channels.service.ts
apps/api/src/modules\admin\close-config\close-config.routes.ts
apps/api/src/modules\admin\close-config\close-config.schema.ts
apps/api/src/modules\admin\close-config\close-config.service.ts
apps/api/src/modules\admin\conversation-tags\conversation-tags.routes.ts
apps/api/src/modules\admin\conversation-tags\conversation-tags.schema.ts
apps/api/src/modules\admin\conversation-tags\conversation-tags.service.ts
apps/api/src/modules\admin\index.ts
apps/api/src/modules\admin\onboarding\onboarding.routes.ts
apps/api/src/modules\admin\onboarding\onboarding.service.ts
apps/api/src/modules\admin\pause-reasons\index.ts
apps/api/src/modules\admin\pause-reasons\pause-reasons.routes.ts
apps/api/src/modules\admin\pause-reasons\pause-reasons.schema.ts
apps/api/src/modules\admin\pause-reasons\pause-reasons.service.ts
apps/api/src/modules\admin\quick-replies\quick-replies.routes.ts
apps/api/src/modules\admin\quick-replies\quick-replies.schema.ts
apps/api/src/modules\admin\quick-replies\quick-replies.service.ts
apps/api/src/modules\admin\settings\settings.routes.ts
apps/api/src/modules\admin\settings\settings.schema.ts
apps/api/src/modules\admin\settings\settings.service.ts
apps/api/src/modules\admin\skills\index.ts
apps/api/src/modules\admin\skills\skills.routes.ts
apps/api/src/modules\admin\skills\skills.schema.ts
apps/api/src/modules\admin\skills\skills.service.ts
apps/api/src/modules\admin\stats\stats.routes.ts
apps/api/src/modules\admin\stats\stats.service.ts
apps/api/src/modules\admin\ticket-types\index.ts
apps/api/src/modules\admin\ticket-types\ticket-types.routes.ts
apps/api/src/modules\admin\ticket-types\ticket-types.schema.ts
apps/api/src/modules\admin\ticket-types\ticket-types.service.ts
apps/api/src/modules\admin\users\users.routes.ts
apps/api/src/modules\admin\users\users.schema.ts
apps/api/src/modules\admin\users\users.service.ts
apps/api/src/modules\ai\ai.service.ts
apps/api/src/modules\ai\ingest.service.ts
apps/api/src/modules\auth\auth.routes.ts
apps/api/src/modules\auth\auth.schema.ts
apps/api/src/modules\auth\auth.service.ts
apps/api/src/modules\auth\profile.routes.ts
apps/api/src/modules\calls\calls.routes.ts
apps/api/src/modules\calls\calls.schema.ts
apps/api/src/modules\calls\calls.service.ts
apps/api/src/modules\crm\contacts\contacts.routes.ts
apps/api/src/modules\crm\contacts\contacts.schema.ts
apps/api/src/modules\crm\contacts\contacts.service.ts
apps/api/src/modules\crm\crm.infrastructure.ts
apps/api/src/modules\crm\index.ts
apps/api/src/modules\crm\organizations\organizations.routes.ts
apps/api/src/modules\crm\organizations\organizations.schema.ts
apps/api/src/modules\crm\organizations\organizations.service.ts
apps/api/src/modules\notifications\notifications.routes.ts
apps/api/src/modules\notifications\notifications.service.ts
apps/api/src/modules\omnichannel\availability.routes.ts
apps/api/src/modules\omnichannel\close-config.routes.ts
apps/api/src/modules\omnichannel\conversations\auto-assign.service.ts
apps/api/src/modules\omnichannel\conversations\conversations.routes.ts
apps/api/src/modules\omnichannel\conversations\conversations.schema.ts
apps/api/src/modules\omnichannel\conversations\conversations.service.ts
apps/api/src/modules\omnichannel\conversations\csat.infrastructure.ts
apps/api/src/modules\omnichannel\conversations\csat.service.ts
apps/api/src/modules\omnichannel\conversations\index.ts
apps/api/src/modules\omnichannel\conversations\protocols.ts
apps/api/src/modules\omnichannel\conversations\socket-payload.ts
apps/api/src/modules\omnichannel\index.ts
apps/api/src/modules\omnichannel\media\index.ts
apps/api/src/modules\omnichannel\media\media.routes.ts
apps/api/src/modules\omnichannel\media\media.service.ts
apps/api/src/modules\omnichannel\metrics\metrics.routes.ts
apps/api/src/modules\omnichannel\metrics\metrics.service.ts
apps/api/src/modules\omnichannel\monitor.routes.ts
apps/api/src/modules\omnichannel\monitor.service.ts
apps/api/src/modules\omnichannel\pause.routes.ts
apps/api/src/modules\omnichannel\pause.schema.ts
apps/api/src/modules\omnichannel\pause.service.ts
apps/api/src/modules\omnichannel\presence.constants.ts
apps/api/src/modules\omnichannel\transfer.routes.ts
apps/api/src/modules\omnichannel\tv.service.ts
apps/api/src/modules\portal\index.ts
apps/api/src/modules\portal\portal.routes.ts
apps/api/src/modules\portal\portal.schema.ts
apps/api/src/modules\portal\portal.service.ts
apps/api/src/modules\search\search.routes.ts
apps/api/src/modules\search\search.service.ts
apps/api/src/modules\super-admin\index.ts
apps/api/src/modules\super-admin\metrics\metrics.routes.ts
apps/api/src/modules\super-admin\metrics\metrics.service.ts
apps/api/src/modules\super-admin\plans\plans.routes.ts
apps/api/src/modules\super-admin\plans\plans.schema.ts
apps/api/src/modules\super-admin\plans\plans.service.ts
apps/api/src/modules\super-admin\tenants\tenants.routes.ts
apps/api/src/modules\super-admin\tenants\tenants.schema.ts
apps/api/src/modules\super-admin\tenants\tenants.service.ts
apps/api/src/modules\tickets\index.ts
apps/api/src/modules\tickets\tickets-metrics.routes.ts
apps/api/src/modules\tickets\tickets-metrics.service.ts
apps/api/src/modules\tickets\tickets.routes.ts
apps/api/src/modules\tickets\tickets.schema.ts
apps/api/src/modules\tickets\tickets.service.ts
apps/api/src/modules\webhooks\email.webhook.ts
apps/api/src/modules\webhooks\index.ts
apps/api/src/modules\webhooks\instagram.webhook.ts
apps/api/src/modules\webhooks\whatsapp.webhook.ts
```

### apps/api/src/middleware/

```text
apps/api/src/middleware\auth.ts
apps/api/src/middleware\index.ts
apps/api/src/middleware\language.ts
apps/api/src/middleware\meta-signature.ts
apps/api/src/middleware\rbac.ts
apps/api/src/middleware\tenant.ts
apps/api/src/middleware\tenantSchemaFromJwt.ts
```

### apps/api/src/jobs/

```text
apps/api/src/jobs\cleanup-csat.job.ts
apps/api/src/jobs\inactivity.job.ts
apps/api/src/jobs\index.ts
apps/api/src/jobs\knowledge-index.job.ts
apps/api/src/jobs\presence-cleanup.job.ts
apps/api/src/jobs\queue.ts
apps/api/src/jobs\send-message.job.ts
```

### apps/api/src/socket/

```text
apps/api/src/socket\index.ts
```

### packages/shared/src/

```text
packages/shared/src\index.ts
packages/shared/src\schemas\auth.schema.ts
packages/shared/src\schemas\index.ts
packages/shared/src\types\contact.ts
packages/shared/src\types\conversation.ts
packages/shared/src\types\index.ts
packages/shared/src\types\organization.ts
packages/shared/src\types\rbac.ts
packages/shared/src\types\tenant.ts
packages/shared/src\types\ticket.ts
packages/shared/src\types\user.ts
```

## 2) Estado atual por módulo (implementado / incompleto / faltante vs roadmap)

### Super Admin
- Implementado:
  - Frontend com Dashboard, Tenants, TenantDetail e Plans.
  - Backend com `/stats`, CRUD de planos e tenants, e métricas.
- Incompleto / atenção:
  - Não há evidência de suíte de testes automatizados para fluxos críticos.
- Gap vs roadmap:
  - Sprint 1 funcionalmente coberto; falta robustez de testes e hardening final.

### Admin do Tenant
- Implementado:
  - Gestão de settings, usuários, canais, horário comercial, bot menu, auto-assign, pause reasons, skills, tags, ticket types, close config e AI Agent.
- Incompleto / atenção:
  - Complexidade alta sem cobertura de testes automatizados detectável.
- Gap vs roadmap:
  - Sprint 2 coberto em escopo funcional.

### CRM (Organizations + Contacts)
- Implementado:
  - Páginas de organizações e contatos, modais de criação/edição, detalhes, vinculação e stats.
  - Backend com rotas e serviços dedicados para organizations e contacts.
- Incompleto / atenção:
  - Arquivo legado possivelmente órfão: `apps/web/src/components/crm/EditClientModal.tsx` (não encontrado uso).
- Gap vs roadmap:
  - Sprint 3 coberto funcionalmente; pendência de limpeza de legado e testes.

### Omnichannel
- Implementado:
  - Conversas, mensagens, assign/transfer/resolve, monitor/metrics, pause/availability, media upload, realtime via Socket.io.
  - Webhooks WhatsApp/Instagram/Email e worker de envio.
- Incompleto / atenção:
  - `send-message.job.ts` registra explicitamente:
    - Instagram: `send not implemented yet`
    - Email: `send not implemented yet`
  - TODO em CSAT:
    - Expiração fixa em 48h, pendente parametrização por tenant.
- Gap vs roadmap:
  - Sprint 5 parcialmente pendente no outbound para Instagram/Email e no refinamento de configurações CSAT por tenant.

### Tickets
- Implementado:
  - Listagem, detalhe, criação, comentários, relações, checklist, time tracking e métricas.
  - Portal de tickets (login, dashboard, lista, detalhe, criação).
- Incompleto / atenção:
  - Sem suíte de testes detectada.
- Gap vs roadmap:
  - Sprint 4 e parte de Portal cobertos funcionalmente.

### Auth / Middleware / Infra
- Implementado:
  - JWT, refresh, RBAC, middleware de tenant, idioma, assinatura de webhook.
  - `/health`, rate limit por tipo de rota, graceful shutdown, CORS restrito em produção.
- Incompleto / atenção:
  - Logs de runtime ainda misturam `console.*` e logger estruturado (Pino), especialmente em workers/webhooks/socket.

### Shared package
- Implementado:
  - Tipos e schemas compartilhados para auth, tenant, user, conversation, ticket, contact, organization.
- Incompleto / atenção:
  - Sem testes/validações automatizadas específicas detectáveis.

### Qualidade geral (transversal)
- Não foram encontrados arquivos `*.test.ts`/`*.spec.ts` em `apps/` e `packages/`.
- Débito principal atual: observabilidade/logging inconsistente + lacunas funcionais pontuais de envio omnichannel.

## 3) Débitos técnicos (TODO/FIXME/HACK/XXX/not implemented...)

### Resultado bruto solicitado
```text
apps\web\src\components\admin\EditUserModal.tsx:123:          placeholder={t('tenantAdmin.settings.maxConversationsAgentDesc')}
apps\web\src\components\admin\EditChannelModal.tsx:148:                placeholder="Deixe em branco para manter o atual"
apps\web\src\components\admin\AddChannelModal.tsx:164:                <Input label="SMTP Host" placeholder="smtp.gmail.com" {...register('smtp_host')} />
apps\web\src\components\admin\AddChannelModal.tsx:165:                <Input label="SMTP Port" placeholder="587" {...register('smtp_port')} />
apps\web\src\components\admin\AddChannelModal.tsx:219:      <Input label="Phone Number ID" required placeholder="704423209430762" {...register('phoneNumberId')} />
apps\web\src\components\admin\AddChannelModal.tsx:220:      <Input label="WABA ID" required placeholder="1922786558561358" {...register('wabaId')} />
apps\web\src\components\admin\AddChannelModal.tsx:222:      <Input label="Verify Token" required placeholder="ziradesk-webhook-2025" {...register('verifyToken')} />
apps\web\src\components\crm\ContactDetail.tsx:460:                placeholder={t('contacts.notes.placeholder')}
apps\web\src\components\omnichannel\CreateConversationModal.tsx:310:                      placeholder={t('form.clientPlaceholder')}
apps\web\src\components\omnichannel\CreateConversationModal.tsx:406:              placeholder={t('form.subjectPlaceholder')}
apps\web\src\components\omnichannel\CreateConversationModal.tsx:483:                  placeholder={t('form.templateNamePlaceholder')}
apps\web\src\components\omnichannel\CreateConversationModal.tsx:499:                  placeholder="pt_BR"
apps\web\src\components\omnichannel\CreateConversationModal.tsx:515:                  placeholder={t('form.templateParamsPlaceholder')}
apps\web\src\components\omnichannel\CreateConversationModal.tsx:537:              placeholder={t(selectedType === 'outbound' ? 'form.initialMessageOutboundPlaceholder' : 'form.initialMessagePlaceholder')}
apps\api\prisma\seed.ts:119:    console.log(`  · Conversas mock já existem (${count})`);
apps\web\src\components\omnichannel\TransferModal.tsx:219:                placeholder={t('transfer.searchAgent')}
apps\web\src\components\omnichannel\TransferModal.tsx:399:              placeholder={t('transfer.reasonPlaceholder')}
apps\web\src\components\omnichannel\ChatArea.tsx:2369:                        placeholder={t('chat.templateNamePlaceholder')}
apps\web\src\components\omnichannel\ChatArea.tsx:2386:                        placeholder="pt_BR"
apps\web\src\components\omnichannel\ChatArea.tsx:2404:                      placeholder={t('chat.templateParamsPlaceholder')}
apps\web\src\components\omnichannel\ChatArea.tsx:2524:                  placeholder={
apps\web\src\components\omnichannel\ResolveModal.tsx:250:                placeholder={t('resolve.commentPlaceholder')}
apps\web\src\components\omnichannel\ConversationList.tsx:804:            placeholder={t('search')}
apps\web\src\components\omnichannel\PauseModal.tsx:79:            placeholder={t('tenantAdmin.pause.notes')}
apps\web\src\components\crm\EditOrganizationModal.tsx:150:                placeholder="11 3333-4444"
apps\web\src\components\omnichannel\MediaUpload.tsx:173:              placeholder={t('media.caption')}
apps\web\src\components\crm\OrganizationDetail.tsx:377:                placeholder={t('organizations.notes.placeholder')}
apps\web\src\components\crm\EditContactModal.tsx:127:              placeholder="11 99999-9999"
apps\web\src\components\crm\EditContactModal.tsx:159:              placeholder={t('contacts.fields.tagsHint')}
apps\web\src\components\ui\PhoneInput.tsx:17:  placeholder?: string | undefined;
apps\web\src\components\ui\PhoneInput.tsx:179:  placeholder,
apps\web\src\components\ui\PhoneInput.tsx:290:          placeholder={placeholder}
apps\web\src\components\crm\LinkOrganizationModal.tsx:75:            placeholder={t('contacts.linkModal.search')}
apps\web\src\components\crm\CreateOrganizationModal.tsx:171:                  placeholder="11 3333-4444"
apps\web\src\components\crm\CreateOrganizationModal.tsx:176:            <Input label={t('organizations.fields.website')} type="url" placeholder="https://..." {...register('website')} />
apps\web\src\components\crm\EditClientModal.tsx:138:                placeholder="11 3333-4444"
apps\web\src\components\crm\EditClientModal.tsx:158:                placeholder="11 99999-9999"
apps\web\src\components\crm\EditClientModal.tsx:193:              placeholder="Digite e pressione Enter para adicionar"
apps\web\src\components\tickets\ChecklistSection.tsx:111:            placeholder="Descrição da tarefa..."
apps\web\src\components\crm\CreateContactModal.tsx:117:              placeholder="11 99999-9999"
apps\web\src\components\crm\CreateContactModal.tsx:149:              placeholder={t('contacts.fields.tagsHint')}
apps\api\src\jobs\send-message.job.ts:347:        console.log('[Instagram] send not implemented yet');
apps\api\src\jobs\send-message.job.ts:351:        console.log('[Email] send not implemented yet');
apps\web\src\components\tickets\CreateTicketModal.tsx:468:                placeholder={t('tickets.form.searchClient')}
apps\web\src\components\tickets\CreateTicketModal.tsx:521:                placeholder={t('tickets.form.searchOrganization', { defaultValue: 'Buscar organizacao...' })}
apps\web\src\components\tickets\CreateTicketModal.tsx:622:            <input type="text" placeholder="Digite e pressione Enter" value={tagInput}
apps\web\src\components\ui\Input.tsx:49:          placeholder={props.placeholder}
apps\web\src\components\ui\GlobalSearch.tsx:135:            placeholder="Buscar contatos, tickets e conversas..."
apps\web\src\components\tickets\AssignTicketModal.tsx:50:          placeholder={t('tickets.form.searchUser')}
apps\web\src\components\super-admin\CreateTenantModal.tsx:310:                placeholder={t('superAdmin.tenants.createWizard.placeholders.name')}
apps\web\src\components\super-admin\CreateTenantModal.tsx:317:                placeholder={t('superAdmin.tenants.createWizard.placeholders.slug')}
apps\web\src\components\super-admin\CreateTenantModal.tsx:336:                  <option value="">{t('superAdmin.tenants.createWizard.placeholders.plan')}</option>
apps\web\src\components\super-admin\CreateTenantModal.tsx:355:                placeholder={t('superAdmin.tenants.createWizard.placeholders.trialDays')}
apps\web\src\components\super-admin\CreateTenantModal.tsx:372:                placeholder={t('superAdmin.tenants.createWizard.placeholders.owner')}
apps\web\src\components\super-admin\CreateTenantModal.tsx:380:                placeholder={t('superAdmin.tenants.createWizard.placeholders.ownerEmail')}
apps\web\src\components\super-admin\CreatePlanModal.tsx:95:            placeholder="Pro"
apps\web\src\components\super-admin\CreatePlanModal.tsx:101:            placeholder="pro"
apps\web\src\components\super-admin\CreatePlanModal.tsx:112:            placeholder="197.00"
apps\web\src\components\super-admin\CreatePlanModal.tsx:120:            placeholder="1970.00"
apps\web\src\pages\tickets\Tickets.tsx:430:                placeholder={t('tickets.searchPlaceholder')}
apps\web\src\pages\tickets\TicketDetail.tsx:921:                  placeholder={t('tickets.detail.newTagPlaceholder')}
apps\web\src\pages\tickets\CreateTicket.tsx:335:                placeholder="Descreva o problema ou solicitação..."
apps\web\src\pages\tickets\CreateTicket.tsx:346:                placeholder="Adicione detalhes, passos para reproduzir e contexto..."
apps\web\src\pages\tickets\CreateTicket.tsx:368:                  placeholder={form.tags.length ? '' : 'Digite e pressione Enter...'}
apps\web\src\pages\tickets\CreateTicket.tsx:538:                    placeholder="Buscar contato..."
apps\web\src\pages\tickets\CreateTicket.tsx:585:                    placeholder="Buscar organização..."
apps\web\src\components\tickets\TicketComments.tsx:773:              data-placeholder={
apps\web\src\components\tickets\TicketRelations.tsx:169:                placeholder="Buscar ticket pelo título ou ID..."
apps\web\src\components\tickets\TimeTrackingSection.tsx:105:                placeholder="0"
apps\web\src\components\tickets\TimeTrackingSection.tsx:117:                placeholder="0"
apps\web\src\components\tickets\TimeTrackingSection.tsx:133:            placeholder="O que foi feito? (opcional)"
apps\web\src\pages\super-admin\Tenants.tsx:394:            placeholder={t('superAdmin.tenants.search')}
apps\web\src\pages\super-admin\Tenants.tsx:647:            placeholder={t('superAdmin.tenants.cancelConfirmPlaceholder', { name: cancelTenant?.name ?? '' })}
apps\web\src\pages\profile\Profile.tsx:81:            placeholder="Seu nome"
apps\web\src\pages\profile\Profile.tsx:95:            placeholder="+55 11 99999-9999"
apps\web\src\pages\profile\Profile.tsx:122:            placeholder="Conte um pouco sobre você..."
apps\web\src\pages\profile\Profile.tsx:212:            placeholder="••••••••"
apps\web\src\pages\profile\Profile.tsx:222:            placeholder="Mínimo 8 caracteres"
apps\web\src\pages\profile\Profile.tsx:232:            placeholder="Repita a nova senha"
apps\web\src\pages\profile\Profile.tsx:494:                  <div className="profile-avatar-placeholder">{currentInitial}</div>
apps\web\src\pages\portal\PortalTicketDetail.tsx:70:          placeholder="Adicionar comentário"
apps\web\src\pages\portal\PortalLogin.tsx:48:              placeholder="seu@email.com"
apps\web\src\pages\portal\PortalLogin.tsx:60:              placeholder="••••••••"
apps\web\src\pages\portal\PortalCreateTicket.tsx:46:          placeholder="Resumo do problema"
apps\web\src\pages\portal\PortalCreateTicket.tsx:73:          placeholder="Descreva o que está acontecendo"
apps\web\src\pages\crm\Organizations.tsx:103:              placeholder={t('organizations.search')}
apps\web\src\pages\crm\Contacts.tsx:129:            placeholder={t('contacts.search')}
apps\web\src\pages\auth\Login.tsx:74:              placeholder={t('login.emailPlaceholder')}
apps\web\src\pages\auth\Login.tsx:82:              placeholder="meu-tenant"
apps\web\src\pages\auth\Login.tsx:93:                placeholder={t('login.passwordPlaceholder')}
apps\web\src\pages\auth\ForgotPassword.tsx:92:                placeholder="voce@empresa.com"
apps\api\src\modules\omnichannel\conversations\csat.service.ts:172:  // TODO: mover 48h para settings.csatExpirationHours por tenant.
apps\web\src\pages\admin\AIAgent.tsx:231:                  placeholder="Assistente"
apps\web\src\pages\admin\AIAgent.tsx:242:                  placeholder={configForm.openai_api_key ? '••••••••' : 'sk-...'}
apps\web\src\pages\admin\AIAgent.tsx:254:                  placeholder={t('tenantAdmin.aiAgent.systemPromptPlaceholder')}
apps\web\src\pages\admin\AIAgent.tsx:280:                  placeholder="0.5"
apps\web\src\pages\admin\AIAgent.tsx:330:                    placeholder={t('tenantAdmin.aiAgent.titlePlaceholder')}
apps\web\src\pages\admin\AIAgent.tsx:337:                    placeholder={t('tenantAdmin.aiAgent.contentPlaceholder')}
apps\web\src\pages\admin\AIAgent.tsx:358:                    placeholder="https://..."
apps\web\src\pages\admin\AIAgent.tsx:365:                    placeholder={t('tenantAdmin.aiAgent.titlePlaceholder')}
apps\web\src\pages\admin\AIAgent.tsx:410:                    placeholder={t('tenantAdmin.aiAgent.titlePlaceholder')}
apps\web\src\pages\admin\CloseConfig.tsx:1073:                  placeholder={t('tenantAdmin.closeConfig.labelPlaceholder')}
apps\web\src\pages\admin\BusinessHours.tsx:540:                  placeholder="Nome do feriado"
apps\web\src\pages\admin\BusinessHours.tsx:621:              placeholder={t('tenantAdmin.businessHours.awayMessagePlaceholder')}
apps\web\src\pages\admin\Users.tsx:352:              placeholder={t('tenantAdmin.users.search')}
apps\web\src\pages\admin\PauseReasons.tsx:102:            placeholder={t('tenantAdmin.pauseReasons.fields.label')}
apps\web\src\pages\admin\PauseReasons.tsx:109:            placeholder={t('tenantAdmin.pauseReasons.fields.icon')}
apps\web\src\pages\admin\PauseReasons.tsx:118:            placeholder={t('tenantAdmin.pauseReasons.fields.sort')}
apps\web\src\pages\admin\QuickReplies.tsx:210:              placeholder={t('tenantAdmin.quickReplies.search')}
apps\web\src\pages\admin\QuickReplies.tsx:311:                    placeholder={t('tenantAdmin.quickReplies.shortcutPlaceholder')}
apps\web\src\pages\admin\QuickReplies.tsx:360:                  placeholder={t('tenantAdmin.quickReplies.contentPlaceholder')}
apps\web\src\pages\admin\TicketTypes.tsx:290:                  placeholder="🎫"
apps\web\src\pages\admin\Settings.tsx:484:                placeholder={t('tenantAdmin.settings.csat.messagePlaceholder')}
apps\web\src\pages\admin\Settings.tsx:558:                    placeholder={t('tenantAdmin.settings.inactivity.warningMessageHint')}
apps\web\src\pages\admin\Settings.tsx:651:                placeholder="{{agent}}"
apps\web\src\pages\admin\Settings.tsx:675:              placeholder={t('tenantAdmin.settings.maxConversationsDesc')}
```

### Curadoria (alto sinal)
- `apps/api/src/jobs/send-message.job.ts:347` → Instagram outbound não implementado.
- `apps/api/src/jobs/send-message.job.ts:351` → Email outbound não implementado.
- `apps/api/src/modules/omnichannel/conversations/csat.service.ts:172` → TODO para parametrizar expiração CSAT por tenant.

Observação: o termo `placeholder` aparece majoritariamente em campos de formulário (não é, por si só, débito técnico).

## 4) Console logs esquecidos (produção)

### Resultado bruto solicitado
```text
apps\api\prisma\seed.ts:49:    console.log(`  ✓ Plano "${plan.name}"`);
apps\api\prisma\seed.ts:59:    console.log(`  · Super Admin já existe (${email})`);
apps\api\prisma\seed.ts:67:  console.log(`  ✓ Super Admin criado`);
apps\api\prisma\seed.ts:68:  console.log(`    email:  ${email}`);
apps\api\prisma\seed.ts:69:  console.log(`    senha:  ${password}`);
apps\api\prisma\seed.ts:76:    console.log(`  · Tenant demo já existe (slug: ${slug})`);
apps\api\prisma\seed.ts:99:  console.log(`  ✓ Tenant demo criado (schema: ${tenant.schemaName})`);
apps\api\prisma\seed.ts:100:  console.log(`    email:  ${ownerEmail}`);
apps\api\prisma\seed.ts:101:  console.log(`    senha:  ${tempPassword}`);
apps\api\prisma\seed.ts:102:  console.log(`    slug:   ${slug}  ← use como "Workspace" no login em dev`);
apps\api\prisma\seed.ts:108:    console.log('  · Tenant demo não encontrado, pulando');
apps\api\prisma\seed.ts:119:    console.log(`  · Conversas mock já existem (${count})`);
apps\api\prisma\seed.ts:130:  console.log('  ✓ Canais');
apps\api\prisma\seed.ts:146:  console.log('  ✓ Agente extra');
apps\api\prisma\seed.ts:160:  console.log('  ✓ Contatos');
apps\api\prisma\seed.ts:200:  console.log(`  ✓ ${conversations.length} conversas`);
apps\api\prisma\seed.ts:263:  console.log(`  ✓ ${messages.length} mensagens`);
apps\api\prisma\seed.ts:269:    console.log('  · Tenant demo não encontrado para respostas rápidas, pulando');
apps\api\prisma\seed.ts:303:  console.log(`  ✓ ${DEFAULT_QUICK_REPLIES.length} respostas rápidas`);
apps\api\prisma\seed.ts:307:  console.log('\n━━━ ZiraDesk Seed ━━━\n');
apps\api\prisma\seed.ts:309:  console.log('Planos:');
apps\api\prisma\seed.ts:312:  console.log('\nSuper Admin:');
apps\api\prisma\seed.ts:315:  console.log('\nTenant Demo:');
apps\api\prisma\seed.ts:318:  console.log('\nConversas Mock:');
apps\api\prisma\seed.ts:321:  console.log('\nRespostas rápidas:');
apps\api\prisma\seed.ts:324:  console.log('\n━━━ Seed concluído ━━━\n');
apps\api\prisma\seed.ts:329:    console.error('\n✗ Seed falhou:', err.message ?? err);
apps\api\src\socket\index.ts:203:        console.warn('[Socket] Invalid user:online payload userId mismatch', {
apps\api\src\socket\index.ts:230:        console.error('[Socket] Connect handler error:', err);
apps\api\src\socket\index.ts:237:        console.error('[Socket] user:online handler error:', err);
apps\api\src\socket\index.ts:245:        console.warn('[Socket] Invalid user:heartbeat payload userId mismatch', {
apps\api\src\socket\index.ts:255:          console.error('[Socket] user:heartbeat handler error:', err);
apps\api\src\socket\index.ts:264:          console.error('[Socket] Heartbeat handler error:', err);
apps\api\src\socket\index.ts:302:            console.log(`[Socket] Agent ${userId} went offline`);
apps\api\src\socket\index.ts:304:            console.error('[Socket] Disconnect handler error:', err);
apps\api\src\server.ts:169:    console.log(`[Server] Received ${signal}, shutting down gracefully`);
apps\api\src\server.ts:178:  console.error(err);
apps\api\src\scripts\reset-tenant-demo.ts:31:  console.log(`Limpando dados do ${SCHEMA}...`);
apps\api\src\scripts\reset-tenant-demo.ts:284:  console.log(`${SCHEMA} resetado com sucesso!`);
apps\api\src\scripts\reset-tenant-demo.ts:285:  console.log('Tabelas criadas: organizations, contacts');
apps\api\src\scripts\reset-tenant-demo.ts:286:  console.log('Tabelas atualizadas: conversations (contact_id, organization_id), tickets (contact_id, organization_id, source_conversation_id)');
apps\api\src\scripts\reset-tenant-demo.ts:287:  console.log('Tabela removida: clients, skills, agent_skills');
apps\api\src\scripts\reset-tenant-demo.ts:288:  console.log('Tabelas criadas: agent_bot_skills, ticket_events');
apps\api\src\scripts\reset-tenant-demo.ts:294:  console.error('Erro no reset:', err);
apps\api\src\scripts\normalize-contact-phones.ts:27:      console.log(`[${schema}] contatos: tabela inexistente, pulando`);
apps\api\src\scripts\normalize-contact-phones.ts:88:    console.log(`[${schema}] contatos analisados=${contacts.length} atualizados=${updatedInSchema}`);
apps\api\src\scripts\normalize-contact-phones.ts:91:  console.log(`Total analisados=${totalScanned} | Total atualizados=${totalUpdated}`);
apps\api\src\scripts\normalize-contact-phones.ts:94:    console.log('Contatos com valores inválidos (não alterados):');
apps\api\src\scripts\normalize-contact-phones.ts:96:      console.log(`- [${row.schema}] contato=${row.contactId} campo=${row.field} valor="${row.value}" erro="${row.error}"`);
apps\api\src\scripts\normalize-contact-phones.ts:103:    console.error(err);
apps\api\src\scripts\generate-missing-protocols.ts:27:    console.log(`[${tenant.slug}] ${conversations.length} conversas sem protocolo`);
apps\api\src\scripts\generate-missing-protocols.ts:40:    console.log(`[${tenant.slug}] Protocolos gerados OK`);
apps\api\src\scripts\generate-missing-protocols.ts:46:    console.error('Falha ao gerar protocolos:', error);
apps\api\src\scripts\encrypt-channel.ts:44:      console.log(`Channel ${channel.id} credentials already encrypted or invalid; skipped`);
apps\api\src\scripts\encrypt-channel.ts:54:    console.log(`Channel ${channel.id} credentials encrypted`);
apps\api\src\scripts\encrypt-channel.ts:60:    console.error(error);
apps\web\src\hooks\useTwilioCall.ts:70:            console.log('[Twilio] Device registered');
apps\web\src\hooks\useTwilioCall.ts:75:          console.error('[Twilio] Device error:', error);
apps\web\src\hooks\useTwilioCall.ts:109:        console.error('[Twilio] Init error:', error);
apps\web\src\hooks\useTwilioCall.ts:168:      console.error('[Twilio] Call error:', error);
apps\api\src\modules\webhooks\whatsapp.webhook.ts:359:      console.log(`[WhatsApp] Channel ${channel.id} decrypted keys: [${Object.keys(credentials).join(', ')}] | phoneNumberId="${channelPhoneNumberId ?? 'undefined'}" (seeking: "${phoneNumberId}")`);
apps\api\src\modules\webhooks\whatsapp.webhook.ts:381:    console.warn(`[WhatsApp] Using .env fallback for phoneNumberId ${phoneNumberId}; channel credentials are missing phoneNumberId`);
apps\api\src\modules\webhooks\whatsapp.webhook.ts:386:    console.warn(`[WhatsApp] Ambiguous .env fallback for phoneNumberId ${phoneNumberId}; ${envFallbackMatches.length} channels without phoneNumberId`);
apps\api\src\modules\webhooks\whatsapp.webhook.ts:607:    console.warn(`[WhatsApp] No channel found for phoneNumberId: ${phoneNumberId}`);
apps\api\src\modules\webhooks\whatsapp.webhook.ts:731:    console.log('[WhatsApp] contactId:', contactId, 'channelId:', channelId);
apps\api\src\modules\webhooks\whatsapp.webhook.ts:742:    console.log('[WhatsApp Webhook] Looking for conversation:', { contactId, channelId });
apps\api\src\modules\webhooks\whatsapp.webhook.ts:788:    console.log('[WhatsApp Webhook] Found conversation:', convRows[0] ?? null);
apps\api\src\modules\webhooks\whatsapp.webhook.ts:1625:      console.error('[AI Agent] Erro ao processar conversa ativa:', err instanceof Error ? err.message : err);
apps\api\src\modules\webhooks\whatsapp.webhook.ts:1800:      console.error('[AI Agent] Erro ao processar mensagem:', err instanceof Error ? err.message : err);
apps\api\src\modules\webhooks\whatsapp.webhook.ts:1831:  console.log(`[WhatsApp] Message processed: ${senderName} → ${content.substring(0, 50)}`);
apps\api\src\modules\webhooks\whatsapp.webhook.ts:1951:        console.error('[WhatsApp Status] Delivery failed', JSON.stringify({
apps\web\src\components\ui\ErrorBoundary.tsx:19:    console.error('Erro capturado pelo ErrorBoundary:', error, info);
apps\web\src\services\socket.ts:97:    console.warn('[Socket] disconnected:', reason);
apps\web\src\services\socket.ts:107:    console.error('[Socket] reconnection failed — showing offline warning');
apps\api\src\modules\calls\calls.routes.ts:135:        console.error('[Twilio] Error checking tenant conversation', {
apps\api\src\modules\calls\calls.routes.ts:191:        console.error('[Twilio] Error checking tenant call record', {
apps\api\src\config\env.ts:31:  console.error('❌ Variáveis de ambiente inválidas:');
apps\api\src\config\env.ts:32:  console.error(parsed.error.flatten().fieldErrors);
apps\api\src\modules\omnichannel\conversations\csat.service.ts:91:    console.error('[CSAT] Failed to send WhatsApp message', {
apps\api\src\modules\omnichannel\conversations\csat.service.ts:181:  console.log(`[CSAT] Sent to conversation ${conversationId}`);
apps\api\src\modules\omnichannel\conversations\auto-assign.service.ts:427:    console.error('[AutoAssign] Failed to notify customer after assignment', {
apps\api\src\modules\omnichannel\conversations\auto-assign.service.ts:555:      console.log(`[AutoAssign] No agent with skill for option ${requiredBotOptionId}. Keeping in queue.`);
apps\api\src\jobs\inactivity.job.ts:259:  console.log(`[Inactivity] Conversation ${conversationId} closed`);
apps\api\src\jobs\inactivity.job.ts:271:  console.error(`[Inactivity] Job ${job?.id} failed`, err);
apps\api\src\jobs\cleanup-csat.job.ts:52:    console.log(`[CSAT Cleanup] Updated ${totalUpdated} expired CSAT records`);
apps\api\src\jobs\cleanup-csat.job.ts:65:  console.error(`[CSAT Cleanup] Job ${job?.id} failed`, err);
apps\api\src\jobs\cleanup-csat.job.ts:78:  console.error('[CSAT Cleanup] Failed to schedule hourly cleanup job', err);
apps\api\src\jobs\presence-cleanup.job.ts:74:  console.error(`[Presence Cleanup] Job ${job?.id} failed`, err);
apps\api\src\jobs\presence-cleanup.job.ts:87:  console.error('[Presence Cleanup] Failed to schedule cleanup job', err);
apps\api\src\jobs\knowledge-index.job.ts:42:  console.error(`[KnowledgeIndex] Job ${job?.id} failed:`, err.message);
apps\api\src\jobs\send-message.job.ts:81:    console.warn('[WhatsApp Worker] Could not resolve tenant schema to persist external_id', {
apps\api\src\jobs\send-message.job.ts:104:    console.warn('[WhatsApp Worker] Could not resolve tenant schema to persist failed status', {
apps\api\src\jobs\send-message.job.ts:265:    console.log('[WhatsApp Worker] Executing job:', job.id);
apps\api\src\jobs\send-message.job.ts:266:    console.log('[WhatsApp Worker] Job data:', JSON.stringify(sanitizeJobData(job.data)));
apps\api\src\jobs\send-message.job.ts:287:        console.log('[WhatsApp Send] Job data:', JSON.stringify(sanitizeJobData(job.data), null, 2));
apps\api\src\jobs\send-message.job.ts:288:        console.log('[WhatsApp Send] PhoneNumberId:', phoneNumberId);
apps\api\src\jobs\send-message.job.ts:289:        console.log('[WhatsApp Send] Sending to:', sanitizedPhone);
apps\api\src\jobs\send-message.job.ts:290:        console.log('[WhatsApp Send] Payload:', JSON.stringify(body, null, 2));
apps\api\src\jobs\send-message.job.ts:304:        console.log('[WhatsApp Send] Response:', responseText);
apps\api\src\jobs\send-message.job.ts:335:            console.log('[WhatsApp Worker] external_id persisted:', {
apps\api\src\jobs\send-message.job.ts:347:        console.log('[Instagram] send not implemented yet');
apps\api\src\jobs\send-message.job.ts:351:        console.log('[Email] send not implemented yet');
apps\api\src\jobs\send-message.job.ts:359:  console.error(`[WhatsApp Worker] Job ${job?.id} FAILED:`, err);
apps\api\src\jobs\send-message.job.ts:361:    console.error('[WhatsApp Worker] Job data was:', sanitizeJobData(job.data));
apps\api\src\jobs\send-message.job.ts:366:  console.log(`[WhatsApp Worker] Processing job ${job.id}:`, job.data);
apps\api\src\jobs\send-message.job.ts:370:  console.log(`[WhatsApp Worker] Job ${job.id} completed successfully`);
apps\web\src\components\omnichannel\AudioRecorder.tsx:413:        console.error('[AudioRecorder] preload failed:', err);
apps\web\src\components\omnichannel\AudioRecorder.tsx:670:        console.error('[AudioRecorder] send failed:', error);
```

### Priorização de limpeza (`console.*` em runtime)
1. `apps/api/src/jobs/send-message.job.ts` (alto volume, inclusive dados de payload)
2. `apps/api/src/modules/webhooks/whatsapp.webhook.ts` (logs de debug extensos)
3. `apps/api/src/socket/index.ts`
4. `apps/web/src/hooks/useTwilioCall.ts`
5. `apps/web/src/services/socket.ts`

Observação: logs em `apps/api/prisma/seed.ts` e `apps/api/src/scripts/*` são esperados para scripts operacionais.

## 5) Avaliação geral (pronto vs atenção)

### O que está pronto
- Base multitenant, autenticação, RBAC e módulos principais do MVP estão implementados.
- Cobertura funcional ampla em Super Admin, Admin, CRM, Tickets e Omnichannel UI.
- Infra mínima de produção (health, rate limit, deploy docs) já está presente.

### O que precisa atenção imediata
1. Completar outbound de Instagram/Email no worker de mensagens.
2. Parametrizar CSAT expiration por tenant (remover hardcode de 48h).
3. Padronizar logging (substituir `console.*` de runtime por logger estruturado com níveis e redaction).
4. Remover/renomear artefatos legados de `client` (ex.: `EditClientModal.tsx` órfão) para consolidar `organization/contact`.
5. Introduzir testes automatizados (mínimo smoke/integration para auth, tenant isolation, webhooks, envio de mensagens e tickets).

### Leitura de maturidade
- Estado atual: **MVP avançado funcional**, com foco recomendado em **confiabilidade operacional** e **qualidade de manutenção** antes de expansão de features.
