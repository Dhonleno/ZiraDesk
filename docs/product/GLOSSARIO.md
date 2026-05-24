# Glossário — ZiraDesk

## Termos do Sistema

**Tenant**
Empresa cliente do ZiraDesk. Cada tenant tem seu próprio ambiente isolado, acessado pelo subdomínio empresa.ziradesk.com.br.

**Super Admin**
Administrador global do ZiraDesk. Tem acesso a todos os tenants, planos e métricas do sistema.

**Owner**
Dono do tenant. Tem acesso total ao ambiente da empresa, incluindo configurações de plano e cobrança.

**Admin**
Administrador do tenant. Pode gerenciar usuários, canais e configurações, mas não tem acesso a dados de cobrança.

**Agent**
Agente de atendimento. Acessa o omnichannel, CRM e tickets conforme permissões.

**Viewer**
Usuário somente leitura. Pode visualizar dados mas não executar ações.

**Canal**
Integração de comunicação configurada no tenant. Exemplos: WhatsApp Business, Instagram DM, E-mail.

**Conversa**
Interação entre um cliente e a equipe, originada em um canal específico. Uma conversa pode conter múltiplas mensagens.

**Status de conversa**
Estado operacional do atendimento omnichannel:
- `open`: conversa aberta. Sem agente (`assigned_to = null`) representa fila; com agente representa atendimento humano em andamento.
- `waiting`: envio ativo aguardando resposta do cliente.
- `closed`: atendimento encerrado com motivo/desfecho registrado.

**Fila de atendimentos**
Lista de conversas `open` sem agente atribuído. A fila é ordenada pelo momento de entrada (`queue_entered_at`) e permite que um agente assuma manualmente o atendimento.

**Envio ativo**
Atendimento iniciado pela equipe para contato outbound. É identificado por `conversation_type = outbound` e usa status `waiting` enquanto aguarda resposta do cliente.

**Motivo de encerramento**
Classificação cadastrável usada ao encerrar um atendimento. Fica registrada no atendimento junto com desfecho, observações, agente e data de encerramento.

**Ticket**
Demanda formal registrada para um cliente. Possui status, prioridade, categoria e responsável.

**Lead**
Cliente em fase de prospecção, ainda não convertido.

**Prospect**
Lead qualificado que demonstrou interesse real no produto/serviço.

**Schema**
Espaço isolado no banco de dados PostgreSQL destinado a um tenant específico. Garante que os dados de um tenant nunca se misturam com os de outro.

**Refresh Token**
Token de longa duração (7 dias) armazenado em cookie httpOnly, usado para renovar o access token sem exigir novo login.

**Access Token**
Token JWT de curta duração (15 minutos) usado para autenticar requisições à API.
