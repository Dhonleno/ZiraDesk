# Fluxos de Produto — ZiraDesk

## Fluxo 1 — Cadastro de novo tenant
Super Admin acessa /super-admin/tenants
-> Clica em "Novo Tenant"
-> Preenche: nome, slug, plano, e-mail do owner
-> Sistema cria schema isolado no PostgreSQL
-> Sistema cria usuario owner com senha temporaria
-> Sistema envia e-mail de boas-vindas ao owner
-> Tenant ativo e acessivel em slug.ziradesk.com.br

## Fluxo 2 — Login de usuario
Usuario acessa empresa.ziradesk.com.br
-> Middleware identifica tenant pelo subdominio
-> Usuario insere e-mail e senha
-> API valida credenciais no schema do tenant
-> Retorna access token (15min) + seta refresh token em cookie httpOnly
-> Frontend armazena access token no Zustand store
-> Redireciona para dashboard

## Fluxo 3 — Recebimento de mensagem (Omnichannel)
Cliente envia mensagem no WhatsApp
-> WhatsApp dispara webhook para /api/webhooks/whatsapp
-> Sistema identifica o tenant pelo numero/token
-> Busca ou cria conversa para o cliente
-> Salva mensagem no banco
-> Se a conversa ainda estiver no bot, permanece aberta sem agente e fora de "Meus atendimentos"
-> Ao finalizar o menu do bot, conversa entra na fila com assigned_to vazio e queue_entered_at preenchido
-> Emite evento Socket.io para agentes do tenant
-> Atendimento aparece em tempo real na Fila de atendimentos

## Fluxo 4 — Atendimento de conversa
Agente visualiza a Fila de atendimentos
-> Sistema mostra conversas abertas sem agente, ordenadas pela espera
-> Agente clica em "Assumir"
-> Sistema atribui a conversa ao agente e remove da fila
-> Conversa passa a aparecer na aba "Aberto" como atendimento humano
-> Agente le historico e contexto do cliente
-> Agente digita e envia resposta
-> Mensagem e enviada via API do canal (WhatsApp, etc.)
-> Status da mensagem atualiza: enviado -> entregue -> lido

## Fluxo 4B — Encerramento de atendimento
Agente clica em "Encerrar" no atendimento aberto
-> Sistema abre modal com motivos e desfechos cadastrados em Configuracoes > Encerramento
-> Agente seleciona motivo, desfecho e opcionalmente informa observacoes
-> API recebe POST /api/omnichannel/conversations/:id/close
-> Sistema grava status closed, closure_reason, close_type_id, close_outcome_id e resolved_at
-> Conversa passa a aparecer na aba "Encerrados"

## Fluxo 5 — Criacao de ticket
Agente identifica demanda que precisa de acompanhamento
-> Clica em "Criar ticket" na conversa
-> Preenche: titulo, descricao, prioridade, categoria
-> Sistema vincula ticket a conversa e ao cliente
-> Ticket aparece na fila de tickets do tenant
-> Agente responsavel recebe notificacao em tempo real

## Fluxo 6 — Renovacao de token (automatico)
Frontend faz requisicao com access token expirado
-> API retorna 401
-> Interceptor do Axios detecta o 401
-> Chama POST /api/auth/refresh com o refresh token do cookie
-> API valida refresh token e retorna novo access token
-> Interceptor repete a requisicao original com novo token
-> Usuario nao percebe nada — experiencia continua

## Fluxo 10 — Onboarding de novo tenant
Owner faz primeiro login
-> Sistema detecta tenant novo (< 7 dias)
-> Checklist aparece no canto inferior direito
-> Owner completa os 5 passos guiados
-> Ao completar: confetti e checklist desaparece
