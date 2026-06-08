# Status do Sistema de Templates WhatsApp

**Data:** 6 de junho de 2026  
**Destinatário:** Engenharia de Sistemas  
**Produto:** ZiraDesk  
**Escopo:** Criação, sincronização, aprovação e uso de templates da Meta em atendimentos e campanhas

## 1. Resumo executivo

O ZiraDesk já possui um fluxo funcional para criar templates de texto diretamente na Meta, armazenar o identificador retornado, acompanhar o status e restringir o envio a templates aprovados e vinculados à Meta.

O sistema também consegue enviar campanhas com templates que tenham cabeçalhos de imagem, vídeo ou documento, desde que esses templates tenham sido criados previamente na Meta e sincronizados com o ZiraDesk.

A principal lacuna atual é a criação de templates avançados dentro do próprio ZiraDesk. O modal ainda não permite criar cabeçalhos de mídia, botões, templates de autenticação ou variantes completas por idioma. Como parte dos clientes não terá conhecimento ou acesso operacional ao Gerenciador do WhatsApp, recomenda-se centralizar todo o ciclo de vida dos templates no ZiraDesk.

## 2. Estado atual

### 2.1 Criação de templates

O modal de administração permite informar:

- Canal WhatsApp.
- Idioma.
- Nome técnico.
- Nome amigável.
- Categoria `MARKETING` ou `UTILITY`.
- Corpo da mensagem.
- Cabeçalho de texto opcional.
- Rodapé opcional.
- Variáveis posicionais, como `{{1}}` e `{{2}}`.
- Exemplos obrigatórios para as variáveis.

Ao enviar o formulário:

1. O backend valida o conteúdo.
2. O template é enviado para `/{WABA_ID}/message_templates`.
3. A Meta retorna o identificador e o status inicial.
4. O ZiraDesk persiste `meta_template_id`, status, componentes e data da sincronização.

O status não é mais definido pelo usuário. Ele é exibido como informação somente leitura e controlado pela Meta.

### 2.2 Status e sincronização

Os seguintes estados são representados:

- `approved`
- `pending`
- `rejected`
- `paused`
- `disabled`
- `in_appeal`
- `pending_deletion`

O webhook processa o evento `message_template_status_update` e atualiza automaticamente o registro local.

Também existe sincronização manual, que consulta os templates da WABA e atualiza:

- ID da Meta.
- Categoria.
- Idioma.
- Corpo.
- Cabeçalho.
- Tipo do cabeçalho.
- Rodapé.
- Botões.
- Componentes.
- Status.
- Data da última sincronização.

### 2.3 Templates legados

Templates antigos que existem apenas no banco local e ainda não possuem `meta_template_id` são submetidos à Meta quando salvos novamente.

Templates que já possuem vínculo com a Meta permitem alterar localmente apenas o nome amigável. Campos estruturais ficam bloqueados para evitar divergência entre o conteúdo aprovado e o conteúdo armazenado.

### 2.4 Uso em atendimentos e campanhas

Atendimentos ativos e mensagens de template exigem:

- Status `approved`.
- `meta_template_id`.
- Sincronização com a Meta.

Campanhas também validam status e vínculo com a Meta na API e novamente no job de envio.

Para templates sincronizados com cabeçalho de mídia, a campanha aceita:

- Imagem por URL pública.
- Vídeo por URL pública.
- Documento por URL pública.
- Nome do arquivo para documentos.

O job transforma esses dados nos componentes esperados pelo envio da Cloud API.

### 2.5 Versão da Graph API

A versão da Graph API foi centralizada na variável:

```env
META_GRAPH_VERSION=v23.0
```

Os pontos de criação, sincronização, envio e mídia não dependem mais diretamente da versão `v19.0`.

## 3. Validação realizada

Foi realizado um teste real usando:

- Tenant: `ZiraDesk Demo`.
- Canal: `WhatsApp Principal`.
- Graph API: `v23.0`.

Template criado:

```text
Nome: ziradesk_integracao_teste_20260606145058
Meta ID: 881171705001572
Categoria: UTILITY
Idioma: pt_BR
Status inicial: PENDING
```

A consulta posterior à Graph API retornou HTTP 200 e confirmou que os dados da Meta e do banco local estavam consistentes.

Também foi confirmado que o aplicativo está inscrito na WABA, condição necessária para receber atualizações de status por webhook.

Validações automatizadas:

- 46 testes de integração relacionados passaram.
- Type-check da API passou.
- Type-check do frontend passou.
- Build de produção do frontend passou.

Limitações do ambiente de desenvolvimento:

- O lint não executa porque o projeto usa ESLint 10 sem um arquivo `eslint.config.*`.
- O build completo da API encontrou `EPERM` ao substituir a DLL do Prisma, pois ela estava em uso por um processo local.

## 4. Limitações atuais

### 4.1 Criação de templates com mídia

O modal não cria templates com cabeçalho:

- `IMAGE`
- `VIDEO`
- `DOCUMENT`

Esses tipos só funcionam quando o template já foi criado na Meta e depois sincronizado.

### 4.2 Upload de mídia

O fluxo de campanha exige uma URL HTTP/HTTPS pública. Não existe upload direto de imagem, vídeo ou documento no modal de campanha.

Isso pode causar erros quando o usuário fornece:

- URL privada.
- URL temporária expirada.
- Arquivo com formato incompatível.
- Arquivo acima do limite permitido.
- URL que bloqueia o acesso da Meta.

### 4.3 Botões

Os botões importados da Meta são armazenados, mas o ZiraDesk ainda não oferece criação visual de:

- Resposta rápida.
- Abertura de URL.
- Ligação telefônica.
- URL com variável.
- Código promocional, quando disponível.

### 4.4 Autenticação

Templates `AUTHENTICATION` não são criados pelo modal atual. Eles exigem componentes e regras específicas de OTP.

### 4.5 Idiomas

O formulário atual oferece apenas:

- `pt_BR`
- `en_US`
- `es`

Não existe fluxo de tradução, duplicação ou agrupamento de variantes do mesmo template.

### 4.6 Rejeição e qualidade

O sistema apresenta o status, mas ainda não exibe:

- Motivo detalhado da rejeição.
- Qualidade do template.
- Alertas de pausa ou desativação.
- Histórico de alterações de status.
- Orientação para correção.
- Fluxo de recurso.

### 4.7 Exclusão

A remoção atual exclui o registro local. É necessário definir explicitamente se a ação também deve excluir o template na Meta ou se devem existir duas operações separadas.

## 5. Necessidade de evolução

Recomenda-se que o ZiraDesk seja a interface principal para todo o gerenciamento de templates.

O cliente não deve precisar conhecer:

- Graph API.
- IDs da WABA.
- Upload resumable da Meta.
- Estrutura JSON de componentes.
- Regras de exemplos e variáveis.
- Eventos de webhook.
- Gerenciador do WhatsApp.

O ZiraDesk deve traduzir essas regras em um editor orientado, validar o conteúdo antes do envio e apresentar os retornos da Meta em linguagem clara.

## 6. Proposta de evolução

### Fase 1: Mídia completa

- Adicionar seletor de tipo de cabeçalho:
  - Nenhum.
  - Texto.
  - Imagem.
  - Vídeo.
  - Documento.
- Implementar upload da mídia de exemplo.
- Obter e enviar o `header_handle` exigido pela Meta.
- Validar MIME type e tamanho.
- Exibir preview adequado ao tipo.
- Permitir upload da mídia da campanha.
- Manter URL pública como alternativa avançada.
- Armazenar arquivos no provedor configurado do ZiraDesk.

### Fase 2: Botões e idiomas

- Editor de botões com limites definidos pela Meta.
- Respostas rápidas.
- URL fixa ou parametrizada.
- Telefone.
- Preview interativo.
- Duplicação de template.
- Variantes por idioma.
- Agrupamento das traduções na listagem.

### Fase 3: Autenticação e governança

- Templates de autenticação e OTP.
- Expiração e botão de copiar código.
- Motivo de rejeição.
- Qualidade e alertas.
- Histórico de status.
- Recurso ou orientação operacional.
- Exclusão sincronizada com confirmação explícita.
- Auditoria de criação, alteração, sincronização e exclusão.

## 7. Requisitos técnicos recomendados

### Backend

- Criar um serviço dedicado para upload de mídia da Meta.
- Não expor tokens ou IDs sensíveis ao frontend.
- Persistir componentes completos retornados pela Meta.
- Tratar respostas parciais, timeout e indisponibilidade.
- Tornar as operações idempotentes.
- Registrar auditoria sem armazenar tokens nos logs.
- Implementar exclusão e consulta de rejeição pela API oficial.
- Criar rotina periódica de reconciliação como proteção ao webhook.

### Frontend

- Editor orientado por tipo de template.
- Campos condicionais por componente.
- Preview fiel ao WhatsApp.
- Contadores e limites visíveis.
- Mensagens de erro em PT-BR.
- Upload com progresso, cancelamento e tentativa novamente.
- Estados distintos para envio, análise, aprovação, rejeição e indisponibilidade.

### Segurança e operação

- Validar arquivos no servidor.
- Limitar tamanho e formatos.
- Aplicar URLs assinadas quando necessário.
- Evitar persistência de tokens em respostas e logs.
- Monitorar falhas de webhook.
- Alertar quando a assinatura da WABA estiver ausente.

## 8. Critérios de aceite

O gerenciamento poderá ser considerado centralizado quando um administrador conseguir:

1. Criar um template de texto ou mídia sem acessar a Meta.
2. Configurar variáveis e exemplos válidos.
3. Adicionar botões suportados.
4. Enviar o template para análise.
5. Acompanhar status e motivo de rejeição.
6. Corrigir e criar uma nova versão quando necessário.
7. Criar uma campanha usando upload direto da mídia.
8. Enviar somente templates aprovados e sincronizados.
9. Gerenciar idiomas e variantes.
10. Excluir ou desativar o template com clareza sobre o impacto local e na Meta.

## 9. Prioridade recomendada

**Prioridade alta:** Fase 1.

O sistema já envia campanhas com mídia, mas o template de mídia precisa ser criado fora do ZiraDesk. Essa dependência contradiz a proposta de centralização e cria uma barreira operacional relevante para clientes sem conhecimento da Meta.

Depois da Fase 1, a Fase 2 cobre a maior parte dos templates comerciais. A Fase 3 deve ser tratada como evolução especializada, devido às regras adicionais de autenticação, qualidade e governança.
