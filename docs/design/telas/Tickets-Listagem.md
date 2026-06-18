# Tela — Tickets · Listagem

| Campo | Valor |
|---|---|
| **Módulo** | Tickets |
| **Arquétipo** | A. Listagem (+ painel de detalhe lateral opcional) |
| **Rota** | `/tickets?status=open&q=…&fila=…&agente=…` |
| **Nav-rail ativo** | Atendimentos/Tickets (usar item de Atendimentos enquanto Tickets não tem ícone próprio) |
| **Breadcrumb** | `Tickets / Listagem` |
| **Padrão específico** | Este PRD define a listagem de tickets: tabela densa, filtros, KPIs, painel lateral opcional, ações e estados. |
| **Permissões** | agent/admin/owner: leitura + escrita; viewer: só leitura (esconder ações de escrita) |

## 1. Objetivo
Dar ao agente e ao supervisor uma fila de trabalho única: ver todos os tickets, filtrar pelos que importam agora, e abrir/atuar sem trocar de tela.

## 2. Usuários e cenários
- **Agente:** "Quais tickets são meus e estão abertos?" → filtra `assigned=eu, status=aberto`.
- **Supervisor:** "O que está urgente e sem dono?" → filtra `prioridade=urgente, agente=não atribuído`.
- **Admin:** acompanha SLA e redistribui tickets entre filas/agentes.

## 3. Layout
```
.content → 1fr  [+ .detail-panel 380px ao selecionar]
└── .list-area
    ├── .page-head     h1 "Tickets" + count-pill + [Novo ticket] (primária teal)
    ├── .kpi-row       4 KPIs: Abertos · Sem dono · Urgentes · SLA em risco
    ├── .filter-bar    busca + fchips (Status, Prioridade, Fila, Agente, Canal) + range-tabs
    ├── .seg-tabs      Todos · Aberto · Em atendimento · Aguardando · Resolvidos (com contadores)
    ├── .table-wrap    table.tickets (rola; sticky thead; min-width ~1100px)
    └── .tbl-foot      "X–Y de N" + paginação mono
```
Selecionar uma linha abre `.detail-panel` com resumo do ticket (ou navega para `Tickets-Detalhe`).

## 4. Dados exibidos
| Campo | Origem (`tickets`) | Formato |
|---|---|---|
| Prioridade | `priority` | barra lateral 3px: low=blue, medium=amber, high/urgent=red |
| ID | `id` (#curto) | mono, `--txt-3` |
| Título | `title` | 13px/500, truncar com ellipsis |
| Cliente/Org | join `clients.name` | 12px; avatar 32×32 por cliente |
| Fila/Categoria | `category` | `.q-tag` hierárquica com `›` |
| Status | `status` | pill: aberto=blue, em_atendimento=teal, aguardando=amber, resolvido=green, encerrado=neutro |
| Agente | join `users.name` | avatar 24×24 + nome; "não atribuído" em `--txt-3` |
| SLA | calc. `due_date` − agora | mono; pill ok/warn/risk; countdown se <1h |
| Atualizado | `updated_at` | data relativa ("há 18m", "2 dias") |
| Ações | — | `.row-actions` opacity:0 → hover: Abrir, Atribuir, ⋯ |

## 5. Ações
| Ação | Gatilho | Resultado | Permissão |
|---|---|---|---|
| **Novo ticket** (primária) | botão topo | modal de criação | agent+ |
| Abrir | clique na linha | painel lateral / detalhe | todos |
| Atribuir a mim | row-action | `assigned_to = eu` + toast | agent+ |
| Atribuir a… | row-action ⋯ | modal seleção de agente | admin+ |
| Mudar status | painel/detalhe | transição (ver §7) + toast | agent+ |
| Selecionar em lote | checkbox | barra de ações em massa (atribuir, mudar fila) | admin+ |

## 6. Filtros, busca e ordenação
- **Busca:** título, #ID, nome do cliente, e-mail.
- **Chips:** Status, Prioridade, Fila, Agente, Canal. Ativo vira `.has-val` (teal).
- **Abas de segmento:** por status, com contadores ao vivo.
- **Ordenar por:** Atualização recente (default), Prioridade, SLA (mais próximo de estourar), Criação.

## 7. Regras de negócio
- **Transições de status:** `aberto → em_atendimento → (aguardando ↔ em_atendimento) → resolvido → encerrado`. Não pular de `aberto` direto para `resolvido` sem passar por atendimento (exceto admin).
- **SLA:** `due_date` define o prazo. <1h = pill `warn` com countdown; vencido = `risk` vermelho. Urgente sem agente há >15min entra no KPI "SLA em risco".
- **Sem dono:** `assigned_to = null` destaca o ticket (agente "não atribuído" em vermelho suave).
- **Resolver** pede confirmação se houver mensagem do cliente sem resposta.
- Ticket `encerrado` é somente-leitura; reabrir é ação explícita (admin+).

## 8. Estados
- **Carregando:** skeleton de 8 linhas de tabela (mesma altura real).
- **Vazio (sem dados):** ícone teal · "Nenhum ticket por aqui" · "Novos chamados aparecem assim que um cliente abre um atendimento." · [Novo ticket].
- **Vazio (filtro):** ícone neutro · "Nada encontrado" · "Nenhum ticket para os filtros atuais." · [Limpar filtros].
- **Erro:** ícone red · "Não foi possível carregar os tickets." · [Tentar novamente].
- **Sem permissão (viewer tentando criar):** ações de escrita ocultas; tela funciona em leitura.
- **Realtime:** novo ticket entra no topo com highlight breve; contadores das abas e KPIs atualizam; sem reordenar sob o cursor.

## 9. Validações
- Novo ticket: `title` obrigatório (≥3 chars), cliente obrigatório, prioridade default `medium`, fila obrigatória.
- Atribuir a agente: só usuários ativos do tenant.
- Ação em lote: confirmar quando >10 tickets afetados.

## 10. Microcópia-chave
- H1: "Tickets" · Primária: "Novo ticket"
- Status: "Aberto", "Em atendimento", "Aguardando", "Resolvido", "Encerrado"
- Prioridade: "Baixa", "Média", "Alta", "Urgente"
- Row-actions: "Abrir", "Atribuir a mim", "Mais ações"
- Toast: "Ticket #4821 atribuído a você." · "Ticket #4821 resolvido."

## 11. Realtime & eventos
`ticket:created`, `ticket:updated` (ARQUITETURA_TECNICA.md §7) → atualizar linha/contadores/KPIs sem reload.

## 12. Métricas de sucesso
Tempo até primeira ação no ticket; % de tickets sem dono; % SLA cumprido. (Refletidos nos KPIs e no Monitor.)

## 13. Fora de escopo
Edição do conteúdo/conversa do ticket (isso é `Tickets-Detalhe`). Automação/regras de roteamento (Configurações).

