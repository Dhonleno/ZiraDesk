# Fluxos de Produto — ZiraDesk

## Fluxo 1 — Cadastro de novo tenant
Super Admin acessa /super-admin/tenants
→ Clica em "Novo Tenant"
→ Preenche: nome, slug, plano, e-mail do owner
→ Sistema cria schema isolado no PostgreSQL
→ Sistema cria usuário owner com senha temporária
→ Sistema envia e-mail de boas-vindas ao owner
→ Tenant ativo e acessível em slug.ziradesk.com.br

## Fluxo 2 — Login de usuário
Usuário acessa empresa.ziradesk.com.br
→ Middleware identifica tenant pelo subdomínio
→ Usuário insere e-mail e senha
→ API valida credenciais no schema do tenant
→ Retorna access token (15min) + seta refresh token em cookie httpOnly
→ Frontend armazena access token no Zustand store
→ Redireciona para dashboard

## Fluxo 3 — Recebimento de mensagem (Omnichannel)
Cliente envia mensagem no WhatsApp
→ WhatsApp dispara webhook para /api/webhooks/whatsapp
→ Sistema identifica o tenant pelo número/token
→ Busca ou cria conversa para o cliente
→ Salva mensagem no banco
→ Emite evento Socket.io para agentes do tenant
→ Mensagem aparece em tempo real no chat do agente

## Fluxo 4 — Atendimento de conversa
Agente recebe nova conversa no omnichannel
→ Clica na conversa para abrir
→ Sistema marca conversa como "em atendimento"
→ Agente lê histórico e contexto do cliente
→ Agente digita e envia resposta
→ Mensagem é enviada via API do canal (WhatsApp, etc.)
→ Status da mensagem atualiza: enviado → entregue → lido

## Fluxo 5 — Criação de ticket
Agente identifica demanda que precisa de acompanhamento
→ Clica em "Criar ticket" na conversa
→ Preenche: título, descrição, prioridade, categoria
→ Sistema vincula ticket à conversa e ao cliente
→ Ticket aparece na fila de tickets do tenant
→ Agente responsável recebe notificação em tempo real

## Fluxo 6 — Renovação de token (automático)
Frontend faz requisição com access token expirado
→ API retorna 401
→ Interceptor do Axios detecta o 401
→ Chama POST /api/auth/refresh com o refresh token do cookie
→ API valida refresh token e retorna novo access token
→ Interceptor repete a requisição original com novo token
→ Usuário não percebe nada — experiência contínua
