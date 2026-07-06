# Home — Dashboard operacional

## Visão geral

- Rota: `/home`
- Arquétipo: C. Dashboard / Monitor
- Público: `owner`, `admin` e `supervisor`
- Objetivo: mostrar um resumo operacional em tempo real logo após o login de perfis de gestão.

## Dados

A tela usa apenas endpoints existentes:

- `GET /api/omnichannel/monitor`
- `GET /api/omnichannel/metrics/overview`
- `GET /api/omnichannel/performance`

Polling:

- Monitor: 30s
- Overview e performance: 60s

## Layout

Dentro de `PageShell padding={0}`:

- `.monitor-area`: coluna, altura total, `overflow: hidden`
- `.page-head`: saudação, subtítulo, indicador ao vivo e botão Atualizar
- `.monitor-scroll`: única área rolável
- `.kpi-strip`: cinco KPIs
- Primeira `.grid-2`: agentes agora e coluna direita com fila por departamento e top agentes
- Segunda `.grid-2`: métricas do dia e alertas operacionais

## Estados

- Loading: skeleton em KPIs e lista de agentes
- Vazio: agentes, fila por departamento e top agentes têm estado vazio local
- Sem alerta: card de alertas mostra check verde e texto positivo
- Sem permissão: a rota não renderiza a página para `agent` e `viewer`; esses perfis são enviados para `/omnichannel/conversations`

## Regras visuais

- Usar somente tokens de `apps/web/src/styles/tokens.css`
- Não centralizar o container raiz com `max-width`
- Não permitir rolagem da página inteira
- Números e durações usam `var(--mono)`
- Ícones SVG inline, stroke-only e sem emoji
