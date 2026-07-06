# Tela — Relatórios / Dashboard Analítico

| Campo | Valor |
|---|---|
| **Módulo** | Relatórios |
| **Arquétipo** | C. Dashboard (agregado, com período — **não** tempo real) |
| **Rota** | `/reports?range=30d&fila=…&canal=…&agente=…` |
| **Nav-rail ativo** | Relatórios |
| **Breadcrumb** | `Relatórios / Visão geral` |
| **Padrão específico** | Este PRD define o dashboard analítico: filtros de período, KPIs, gráficos, ranking e exportação. |
| **Permissões** | admin/owner: completo; agent: só seus próprios números; viewer: leitura |

## 1. Objetivo
Responder "como foi a operação no período?" — volume, produtividade, SLA, satisfação e por canal/fila/agente — para decisão de gestão. Diferente do **Monitor** (ao vivo, "agora"), aqui é **histórico e comparável**.

## 2. Usuários e cenários
- **Gestor:** "O SLA caiu este mês? Em qual fila?" → compara 30d vs período anterior.
- **Owner:** acompanha volume e CSAT por canal para decidir investimento.
- **Agente:** vê os próprios números (atendidos, TMA, CSAT) na visão pessoal.

## 3. Layout
```
.content → 1fr
└── .monitor-area
    ├── .page-head    h1 "Relatórios" + subtítulo do período + [Exportar] + [Atualizar]
    ├── .filter-bar   range-tabs (Hoje/7d/30d/Trimestre/Personalizado) + chips (Fila, Canal, Agente) + comparar com período anterior (toggle)
    └── .monitor-scroll
        ├── .kpi-strip   5 KPIs com delta vs período anterior + sparkline
        ├── .grid-2      [Volume ao longo do tempo (linha/área)] [Volume por canal (donut + breakdown)]
        ├── .grid-2      [SLA por fila (barras)] [Distribuição por hora/dia (heatmap ou barras)]
        └── .card        Ranking de agentes (tabela densa: atendidos, TMA, FRT, CSAT, SLA)
```

## 4. Dados exibidos (KPIs e séries)
| Métrica | Cálculo (origem) | Formato |
|---|---|---|
| Atendimentos | count `conversations` no período | mono + delta |
| Resolvidos | `status=resolved` | mono + delta |
| TMA (tempo médio de atendimento) | média duração resolvidas | "8m42s" mono; delta (menor é melhor → seta p/ baixo verde) |
| FRT (1ª resposta) | média até 1ª resposta do agente | mono + delta |
| SLA cumprido | % dentro do prazo | "88%" + delta em **pp**; meta destacada |
| CSAT / NPS | média das avaliações pós-resolução | nota + delta |
| Volume/tempo | série por dia/hora | linha/área SVG |
| Por canal | count agrupado | donut + lista (WhatsApp/IG/E-mail/Webchat) |
| SLA por fila | % por `category` | barras horizontais (ok/warn/risk) |
| Ranking agentes | por `users` | tabela: atendidos, TMA, FRT, CSAT, SLA, ocupação |

## 5. Ações
| Ação | Gatilho | Resultado | Permissão |
|---|---|---|---|
| Trocar período | range-tabs / data custom | recarrega métricas | todos |
| Comparar período | toggle | mostra deltas vs período anterior | todos |
| Filtrar (fila/canal/agente) | chips | recorta todos os gráficos | admin+ (agente: travado em si) |
| **Exportar** | botão | CSV/PDF do recorte atual | admin+ |
| Abrir detalhe | clique num agente/fila | drill-down (lista filtrada em Tickets/Inbox) | admin+ |

## 6. Filtros, período e comparação
- **Período:** Hoje · 7d · 30d · Trimestre · Personalizado (date range). Default 30d.
- **Comparar com período anterior:** liga os deltas (▲/▼ + vs).
- **Recortes:** Fila, Canal, Agente. Aplicam-se a todos os blocos simultaneamente.
- Mostrar sempre o período vigente no subtítulo ("1–30 mai · vs 1–30 abr").

## 7. Regras de negócio
- **Histórico, não ao vivo:** dados consolidados; cabeçalho mostra "Atualizado às HH:MM", botão Atualizar manual. Sem `.live-dot` pulsando (isso é do Monitor).
- **Delta com semântica correta:** para TMA/FRT, **menor é melhor** (queda = verde). Para volume/CSAT/SLA, **maior é melhor**.
- **SLA em pontos percentuais (pp)**, não %.
- **Agente** só vê os próprios números; filtros de agente travados nele.
- **Sem dados suficientes** num período → mostrar vazio do bloco específico, não quebrar a página.
- Exportação respeita o recorte (filtros + período) atual.

## 8. Estados
- **Carregando:** skeleton dos KPIs + placeholders dos gráficos (retângulos na proporção real).
- **Vazio (período sem dados):** por bloco — "Sem dados neste período" · "Ajuste o período ou os filtros."
- **Erro:** "Não foi possível carregar os relatórios." · [Tentar novamente].
- **Parcial:** se um bloco falha, os outros continuam; o bloco mostra erro próprio.
- **Sem permissão (agente em filtros de equipe):** filtros de agente desabilitados com dica.

## 9. Validações
- Date range custom: início ≤ fim; limite de janela (ex.: 12 meses).
- Exportar: confirmar formato; desabilitar se não há dados.

## 10. Microcópia-chave
- H1: "Relatórios" · Ações: "Exportar", "Atualizar"
- Períodos: "Hoje", "7 dias", "30 dias", "Trimestre", "Personalizado"
- Deltas: "▲ 12%", "▼ -1m12s", "-4 pp", "vs período anterior"
- Siglas mantidas: TMA, FRT, SLA, CSAT, NPS (não expandir).
- Vazio: "Sem dados neste período" / "Ajuste o período ou os filtros."

## 11. Realtime & eventos
Não em tempo real. Recarga manual ou ao trocar período/filtro. (Tempo real é responsabilidade do **Monitor**.)

## 12. Métricas de sucesso
Uso recorrente por gestores, exportações, decisões derivadas (qualitativo). Clareza: usuário entende o período/comparação sem ajuda.

## 13. Fora de escopo
Supervisão ao vivo (Monitor). Construtor de relatórios customizados/BI (futuro). Faturamento/billing analytics (Super Admin).

---

> **Monitor vs Relatórios:** Monitor = "o que está acontecendo agora" (ao vivo, acionável, alertas).
> Relatórios = "como foi o período" (histórico, comparável, exportável). Mesmos componentes visuais, intenções diferentes.

