# Tela — Tickets · Detalhe

| Campo | Valor |
|---|---|
| **Módulo** | Tickets |
| **Arquétipo** | B. Registro/Detalhe |
| **Rota** | `/tickets/:id` |
| **Nav-rail ativo** | Atendimentos/Tickets |
| **Breadcrumb** | `Tickets / #4821` |
| **Padrão específico** | Este PRD define o detalhe do ticket: hero, tabs, thread, painel de propriedades, ações e estados. |
| **Permissões** | agent/admin/owner: ler + comentar + mudar status; viewer: só leitura |

## 1. Objetivo
Resolver um chamado: ver todo o contexto (cliente, histórico, conversa de origem), registrar trabalho (comentários internos/públicos), e mover o ticket pelo fluxo até o fechamento.

## 2. Usuários e cenários
- **Agente:** lê o problema, comenta internamente, responde o cliente, muda status, resolve.
- **Agente que recebeu transferência:** precisa do histórico completo para continuar sem pedir tudo de novo.
- **Supervisor:** revisa SLA, prioridade e reatribui.

## 3. Layout
```
.content → 1fr
└── .detail-panel → .detail-scroll
    ├── .detail-hero
    │   ├── título do ticket (editável inline) + #ID
    │   ├── pills: status, prioridade, fila, canal de origem
    │   ├── metadados: cliente/org (link), aberto há, SLA (countdown), agente
    │   ├── ações: [Resolver] (primária) · Atribuir · Transferir · ⋯
    │   └── .hero-kpis: Tempo aberto · Respostas · 1ª resposta (FRT) · Reaberturas
    ├── .detail-tabs: Conversa · Detalhes · Atividade · Relacionados
    └── .tab-body (.tab-grid 1.4fr / 1fr)
        ├── ESQ: thread (mensagens + notas internas) · composer (Responder / Nota interna)
        └── DIR: .dsec Cliente · .dsec Propriedades (status/prioridade/fila/agente/SLA) · .dsec Tags · .dsec Tickets relacionados
```

## 4. Dados exibidos
| Campo | Origem | Formato |
|---|---|---|
| Título | `tickets.title` | editável inline (admin+/dono) |
| #ID | `tickets.id` | mono |
| Status / Prioridade | `status` / `priority` | pills semânticas |
| Fila | `category` | `.q-tag` com `›` |
| Cliente/Org | `clients` | nome + avatar; link para CRM |
| Aberto há / Atualizado | `created_at` / `updated_at` | data relativa |
| SLA | `due_date` | mono + countdown/pill |
| Agente | `assigned_to` → `users` | avatar + nome |
| Thread | `messages` (via `conversation_id`) | balões; nota interna (`is_internal`) destacada em amber |
| Comentários | `ticket_comments` | público vs interno (`is_internal`) |
| Tags | `tags[]` | tag-pills |

## 5. Ações
| Ação | Gatilho | Resultado | Permissão |
|---|---|---|---|
| **Resolver** (primária) | botão hero | status=resolvido (+ CSAT opcional) + toast | agent+ |
| Responder cliente | composer (aba pública) | mensagem enviada ao canal de origem | agent+ |
| Nota interna | composer (toggle) | comentário `is_internal` (não vai ao cliente) | agent+ |
| Mudar status/prioridade | selects no painel direito | transição + toast | agent+ |
| Atribuir / Transferir | hero | modal de agente/fila | agent/admin |
| Editar título | clique no título | inline edit | admin+/dono |
| Reabrir | em ticket resolvido/encerrado | status=em_atendimento | admin+ |
| Vincular ticket/organização | aba Relacionados | relação criada | agent+ |

## 6. Filtros, busca e ordenação
Não se aplica (tela de um registro). A thread pode ter toggle "Mostrar notas internas" e filtro por tipo de evento na aba Atividade.

## 7. Regras de negócio
- **Composer com dois modos:** "Responder" (vai ao cliente) e "Nota interna" (fica no time). O modo ativo deve ser **visualmente inequívoco** (nota interna com fundo amber) — evitar enviar nota ao cliente por engano.
- **Transições de status:** iguais à listagem (§7 daquele PRD). Mudar para `aguardando` exige motivo curto (ex.: "aguardando cliente").
- **SLA:** primeira resposta (FRT) e resolução têm prazos; estourar marca o ticket e alimenta o Monitor.
- **Resolver** sem resposta pendente: ok. Com mensagem do cliente sem resposta: confirmar.
- **Editar** dados sensíveis (cliente, fila) registra `audit_logs` (LGPD).
- Ticket `encerrado`: somente leitura; só admin reabre.

## 8. Estados
- **Carregando:** skeleton do hero + 4 balões fantasma + painel direito fantasma.
- **Vazio (thread sem mensagens):** "Sem mensagens ainda" · "Este ticket foi criado manualmente. Comece uma resposta ou registre uma nota interna."
- **Erro:** "Não foi possível carregar o ticket." · [Tentar novamente].
- **Sem permissão (viewer):** composer oculto; selects desabilitados; só leitura.
- **Realtime:** nova mensagem do cliente entra na thread ao vivo com highlight; status/atribuição mudados por outro agente refletem no painel sem reload.

## 9. Validações
- Resposta/nota: não enviar vazio; aviso ao sair com rascunho não enviado.
- Mudar para `aguardando`: motivo obrigatório.
- Reabrir: confirmação.
- Título: mínimo 3 caracteres.

## 10. Microcópia-chave
- Primária: "Resolver" · Secundárias: "Atribuir", "Transferir", "Reabrir"
- Composer: aba "Responder" / "Nota interna"; placeholder "Escreva uma resposta…" / "Nota visível só para o time…"
- Toast: "Ticket #4821 resolvido." · "Resposta enviada." · "Nota interna adicionada."
- Confirmação: "Resolver com resposta pendente?" · "O cliente enviou uma mensagem ainda não respondida."

## 11. Realtime & eventos
`conversation:message` (nova mensagem na conversa de origem), `ticket:updated` (status/atribuição). Atualizar thread e painel sem roubar foco do composer.

## 12. Métricas de sucesso
FRT (primeira resposta), tempo de resolução, taxa de reabertura, CSAT pós-resolução.

## 13. Fora de escopo
Listagem/fila de tickets (`Tickets-Listagem`). Configuração de SLAs e roteamento (Configurações).

