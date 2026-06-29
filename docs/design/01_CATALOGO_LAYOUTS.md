# 01 — Catálogo de Layouts (arquétipos de página)

> Quase toda tela do ZiraDesk cai em **um destes 7 arquétipos**. Identifique o seu,
> aplique as proporções base e detalhe o comportamento no PRD da tela. Os arquétipos
> compartilham o **mesmo shell** (topbar + nav-rail); variam só no `.content`.

Shell comum a todos (exceto Autenticação):

```html
<body>
  <div class="topbar">…</div>          <!-- 52px -->
  <div class="main">                   <!-- flex: nav-rail + content -->
    <div class="nav-rail">…</div>      <!-- 68px recolhida, 216px expandida -->
    <div class="content">…</div>       <!-- varia por arquétipo -->
  </div>
</body>
```

`.content` sempre tem `overflow: hidden` — a rolagem mora numa área interna.

---

## A. Listagem (índice de registros)

**Quando:** ver muitos registros do mesmo tipo, filtrar, buscar, agir em lote. Ex.: Clientes, Tickets, Campanhas.

```
.content  →  1fr  [+ painel de detalhe 380px opcional]
└── .list-area (flex column)
    ├── .page-head        h1 + count-pill + ações da página
    ├── .kpi-row          (opcional) 3–5 KPIs de contexto
    ├── .filter-bar       busca + .fchip (filtros) + view-toggle + range-tabs
    ├── .seg-tabs         abas com contadores (Todos/Aberto/…)
    ├── .table-wrap       ÚNICA área que rola → table.clients (min-width, sticky thead)
    └── .tbl-foot         paginação (mono, ativo em teal)
```

Regras:
- `thead th` sticky, eyebrow style, `bg: var(--bg-2)`.
- Linha hover `bg: var(--bg-3)`; selecionada `bg: rgba(teal,.06)` + `box-shadow: inset 2px 0 0 var(--teal)`.
- `.row-actions` com `opacity:0`, aparecem no hover.
- Avatar de linha 32×32, gradiente por registro.
- Painel de detalhe lateral abre ao selecionar uma linha (ou navega para o arquétipo Detalhe).

---

## B. Registro / Detalhe (perfil de uma entidade)

**Quando:** tudo sobre **um** registro: cliente, organização, ticket. Ex.: Organizações, Perfil do Cliente.

```
.content  →  [lista 320–340px opcional] 1fr
└── .detail-panel (flex column) → .detail-scroll (rola)
    ├── .detail-hero        avatar grande + nome + pills + metadados + owner + ações
    │   └── .hero-kpis      4–5 KPIs do registro (mono + delta)
    ├── .detail-tabs        Visão geral · Contatos · Conversas · Tickets · … (sticky)
    └── .tab-body
        └── .tab-grid       2 colunas (1.4fr / 1fr) de .dsec (seções)
```

Regras:
- Hero pode ter `--hero-glow` radial sutil (nunca gradiente colorido chapado).
- Seções `.dsec`: eyebrow + corpo; separadas por `border`/gap, **sem sombra**.
- Coluna esquerda = atividade/timeline/listas; direita = atributos/KV/relacionados.
- KV em `.kv-grid` (2 colunas), valores mono quando número/ID.

---

## C. Dashboard / Monitor (visão agregada em tempo real)

**Quando:** supervisão, KPIs, gráficos, listas ao vivo. Ex.: Monitor, Relatórios.

```
.content  →  1fr [+ painel lateral 360–420px opcional]
└── .monitor-area (flex column)
    ├── .page-head        h1 + subtítulo + live-badge "Atualizado agora" + Atualizar
    ├── .filter-bar       (opcional) filtros + range-tabs (Agora/Hoje/7d/30d)
    └── .monitor-scroll   (rola)
        ├── .kpi-strip    5 KPIs com sparkline + delta vs período
        ├── .grid-2       cards lado a lado (ex.: filas + canais/gráfico)
        └── .card         tabelas densas (ex.: equipe ao vivo)
.queue-panel (lateral)    alertas + itens em risco + atividade
```

Regras:
- KPI = eyebrow → valor mono grande → delta pill (`up`/`down`/`neu`).
- Gráficos: barras/sparklines em SVG simples, cores de token. Hora/etapa atual em teal.
- Pills semânticas para status (ok/warn/risk/idle).
- "Tempo real" comunicado por `.live-dot` pulsando, nunca por animação ruidosa.

---

## D. Inbox / Conversa (3 colunas)

**Quando:** triagem de fila + leitura/resposta + contexto do contato. Ex.: Omnichannel.

```
.content  →  fila 320px | conversa 1fr | contato 360px
├── coluna fila       lista de conversas (canal, prévia, não-lidas, tempo)
├── coluna conversa   header fixo + mensagens (rola) + composer fixo
└── coluna contato    dados do cliente, conversas, tickets, notas
```

Regras:
- Header da conversa e composer **fixos**; só a área de mensagens rola.
- Balões: cliente à esquerda (`bg-3`), agente à direita (`teal-dim`/`bg-4`). Nota interna destacada (amber).
- Canais com cor de marca (WhatsApp `#25D366`, Instagram gradiente/pink, e-mail blue).
- Ações de conversa (Atribuir, Transferir, Resolver) abrem **modais** (ver arquétipo G).

---

## E. Configuração / Formulário longo

**Quando:** ajustar settings, conectar integrações, editar entidade com muitos campos. Ex.: Admin (Configurações, Canais).

```
.content  →  sidebar de seções 220–260px | área de formulário 1fr
├── .settings-nav      lista de seções (Geral, Marca, Canais, Faturamento…)
└── .settings-body (rola)
    ├── .page-head     h1 + descrição
    └── .dsec (várias) cada seção: head (eyebrow + ação) + linhas de form / KV / cards
.save-bar               barra de salvar FIXA no rodapé (não rola) — só quando há mudança
```

Regras:
- Inputs: `bg: var(--bg-3)`, `border: 1px solid var(--line-2)`, foco teal + halo 3px.
- Agrupar campos por seção; label eyebrow; ajuda em `--txt-3`.
- Toggles, selects e radios seguem o design system; sem libs externas de UI.
- Botão Salvar fixo, primário teal; "Cancelar" ghost ao lado.

---

## F. Tabela administrativa (gestão com permissões)

**Quando:** gerir usuários, papéis, tenants, planos — tabela + ações + estados por linha. Ex.: Admin Usuários, Super Admin Tenants/Planos.

```
.content  →  1fr
└── .admin-area (flex column)
    ├── .page-head     h1 + count + ação primária (Convidar/Novo)
    ├── .filter-bar    busca + filtros (papel, status)
    └── .table-wrap    table densa: entidade + papel/plano + status pill + métricas + row-actions
```

Regras:
- Status como pill semântica (ativo=green, suspenso=amber, cancelado=red, inativo=neutro).
- Papéis/planos como pill ou texto; nunca cor inventada.
- Ações destrutivas (excluir, suspender) pedem **confirmação em modal** e respeitam permissão por role.
- Mostrar quem é "você" e quem é owner; não permitir auto-rebaixar o último owner.

---

## G. Modal / Overlay (sobre qualquer arquétipo)

**Quando:** criar/editar rápido, confirmar ação, fluxo curto (CSAT, transferir). Ex.: modais do Omnichannel.

```
.modal-overlay (bg: var(--backdrop), blur)
└── .modal (bg-2, --r-xl, --shadow-pop)
    ├── .modal-head    título 16px/600 + fechar (X)
    ├── .modal-body    campos / conteúdo
    └── .modal-foot    border-top; [Cancelar ghost] [Confirmar primário]  (à direita)
```

Regras:
- Overlay fecha no clique fora e no `Esc`. Foco move para dentro do modal.
- Confirmação destrutiva: botão primário em **red**, texto claro do efeito.
- Modais curtos; fluxo longo vira arquétipo E (config) ou um wizard de passos.

---

## H. Autenticação (shell PRÓPRIO — exceção)

**Quando:** login, recuperar senha, aceitar convite. **Não** tem topbar nem nav-rail.
Ver PRD em `telas/Login.md`.

```
body (centralizado, bg)
└── .auth-card (bg-2, --r-xl, --shadow-pop, ~400px)
    ├── logo ZiraDesk
    ├── título + subtítulo
    ├── form (e-mail, senha, …) com foco teal
    ├── ação primária full-width teal
    └── links secundários (esqueci a senha)
```

---

## Como escolher rápido

| A tela é sobre… | Arquétipo |
|---|---|
| muitos registros para filtrar/agir | **A. Listagem** |
| um registro em profundidade | **B. Detalhe** |
| números/saúde da operação ao vivo | **C. Dashboard** |
| ler e responder mensagens | **D. Inbox** |
| ajustar configurações/integrações | **E. Configuração** |
| gerir usuários/tenants/planos | **F. Tabela admin** |
| ação rápida sobre outra tela | **G. Modal** |
| entrar / recuperar acesso | **H. Autenticação** |

> Telas podem **combinar** arquétipos (Listagem + Detalhe lado a lado é o caso mais comum).
> Quando combinar, mantenha as proporções de coluna sugeridas e um único arquétipo "dono" da rolagem por painel.

