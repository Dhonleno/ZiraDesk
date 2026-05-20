# ZiraDesk — Padrão de Telas (Design System)

Este documento é a fonte da verdade para qualquer tela do produto ZiraDesk. Use-o como referência ao criar novas páginas, modais ou componentes. **Nunca invente cores, tipografia, espaçamento ou estrutura novos** — se algo faltar, baseie-se no que já existe.

Telas de referência canônicas (sempre leia antes de iniciar uma nova):
- `apps/web/src/references/omnichannel_chat.html` — shell completo do app + caixa de atendimentos + estrutura de conversa
- `apps/web/src/references/Clientes.html` — listagens densas (tabela + filtros + painel de detalhe)
- `apps/web/src/pages/tv/TVDashboard.tsx` — dashboards / painéis em tempo real (cards + KPIs + listas)

> Regra de ouro: ao começar uma tela nova, **abra uma das telas acima**, copie a topbar + nav rail + tokens, e construa o conteúdo dentro do mesmo container. Não recrie do zero.

---

## 1. Identidade da marca

### Logo
SVG inline, sempre na topbar à esquerda, separado do conteúdo por um divisor vertical de 1px (`var(--line)`).
```html
<svg class="brand-logo" width="120" height="28" viewBox="0 0 160 36">
  <rect x="0" y="0" width="36" height="36" rx="8" class="brand-logo-bg"/>
  <rect x="0" y="0" width="36" height="36" rx="8" fill="none" class="brand-logo-stroke" stroke-width="1"/>
  <path d="M9 10 L27 10 L9 26 L27 26" fill="none" class="brand-logo-z" stroke-width="3"
        stroke-linecap="round" stroke-linejoin="round"/>
  <text x="46" y="23" font-size="16" font-weight="700" class="brand-logo-zira" letter-spacing="-0.3">Zira</text>
  <text x="82" y="23" font-size="16" font-weight="300" class="brand-logo-desk" letter-spacing="-0.3">Desk</text>
</svg>
```
- "Zira" em peso 700, "Desk" em peso 300 — sempre.
- Nunca use emoji ou ícone de "fone/headset" como logo.

### Nome
`ZiraDesk` (uma palavra, dois capitais). Em breadcrumbs use os módulos: `Omnichannel`, `CRM`, `Relatórios`, `Configurações`.

---

## 2. Tokens (CSS variables)

Cole **na íntegra** o bloco `:root, [data-theme="dark"]` + `[data-theme="light"]` de qualquer tela de referência. Não altere os valores. Resumo:

### Cores neutras
| Token | Dark | Light | Uso |
|---|---|---|---|
| `--bg` | `#0E0F11` | `#F7F8FA` | fundo do app |
| `--bg-2` | `#141518` | `#FFFFFF` | superfícies elevadas (topbar, painéis laterais, cards) |
| `--bg-3` | `#1A1C20` | `#FFFFFF` | cards aninhados, inputs |
| `--bg-4` | `#22252B` | `#F1F3F6` | hover states, ícone-buttons |
| `--bg-5` | `#2A2E36` | `#E6E9EF` | hover de hover, scrollbars |
| `--line` | `rgba(255,255,255,.07)` | `rgba(15,18,24,.08)` | separadores sutis |
| `--line-2` | `rgba(255,255,255,.12)` | `rgba(15,18,24,.14)` | bordas de input/botão |
| `--txt` | `#F0F1F3` | `#14171C` | texto principal |
| `--txt-2` | `#9DA3AE` | `#54606E` | texto secundário, labels |
| `--txt-3` | `#5C6370` | `#8A94A1` | texto terciário, placeholders |

### Cores semânticas (sempre tem par `-dim` para fundos)
- `--teal` (`#00C9A7` / `#00A88C`) — **cor primária**, ações principais, status ativo, links
- `--green` — sucesso, online, resolvido
- `--amber` — alerta, fila, pendente
- `--red` — erro, urgente, offline triste, badges de notificação
- `--blue` — informativo, e-mail, prospects
- `--purple` — VIP, avatar default, métricas analíticas
- `--pink` — Instagram, segmentos secundários

> **Para texto sobre o teal**, use `var(--on-teal)` (`#0E0F11` no dark, `#FFFFFF` no light) — nunca branco/preto puro hard-coded.

### Tipografia
- Família principal: `'IBM Plex Sans', sans-serif` → `--font`
- Mono (números, códigos, IDs, contadores): `'IBM Plex Mono', monospace` → `--mono`
- Carregamento via Google Fonts:
  ```html
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  ```
- Pesos disponíveis: 300, 400, 500, 600 (sans) e 400, 500 (mono). **Nunca use 700+**.
- Tamanho base do `body`: **13px**, line-height 1.5.
- Escala canônica:
  - `h1` (page title): 22px, weight 600, letter-spacing -0.4px
  - `h2` (section head): 11px, weight 600, **uppercase**, letter-spacing 0.1em, cor `--txt-3`
  - texto corpo: 13px, weight 400
  - texto secundário: 12px, weight 400, cor `--txt-2`
  - micro / labels: 10–11px, weight 500–600
  - números grandes (KPI val): 22–28px, **mono**, letter-spacing -0.4 a -0.6px

### Raios e sombras
- `--r: 8px` (botões, inputs, chips)
- `--r-lg: 12px` (cards, modais, nav-item)
- `--r-pill: 999px` (status pills, tags, badges)
- `--shadow-pop: 0 20px 60px rgba(0,0,0,.6), 0 0 0 1px var(--line);` (popovers/modais)

---

## 3. Layout do app

### Estrutura obrigatória
```
<body>
  <div class="topbar">…</div>
  <div class="main">
    <div class="nav-rail">…</div>
    <div class="content">…</div>   <!-- pode ser 1 ou 2 colunas -->
  </div>
</body>
```

CSS:
```css
html, body { height: 100%; overflow: hidden; }
body { display: flex; flex-direction: column; }
.main { display: grid; grid-template-columns: 68px 1fr; flex: 1; overflow: hidden; }
.content { /* 1 coluna OU grid-template-columns: 1fr 380-420px */ overflow: hidden; }
```

A página **nunca** rola como um todo — a topbar e nav-rail ficam fixos, e a rolagem acontece dentro de uma área de conteúdo específica (`.table-wrap`, `.agents-scroll`, `.detail-scroll`, etc.).

### Largura de conteúdo (páginas autenticadas)
- Em páginas dentro do shell autenticado (`topbar + nav rail`), o conteúdo deve **aproveitar toda a largura disponível** do container `.content`.
- Não centralize o wrapper principal com `max-width` + `margin: 0 auto` (ex.: `max-width: 900px`) nessas páginas.
- Use divisão interna por colunas/painéis para legibilidade (ex.: `260px 1fr`, `1fr 380px`) sem “encaixotar” a página inteira.
- `max-width` é permitido apenas em componentes locais (modais, dropdowns, chips, cards específicos), não no container raiz da tela autenticada.
- No frontend React, prefira usar `components/layout/PageShell.tsx` como wrapper base dessas páginas.

### Topbar (52px de altura)
Da esquerda para a direita:
1. **Logo** (com `border-right: 1px solid var(--line)`)
2. **Breadcrumb** (`<div class="topbar-title">`): ícone do módulo + nome + `/` + nome da página em `<strong>`
3. `flex: 1` spacer (use `<div class="topbar-actions">` com `margin-left:auto` ou similar)
4. **Status indicator** "Online" (pill verde com pulso)
5. **Toggle de tema** (`#themeToggle`) — sempre presente
6. **Busca global** (opcional, com `Ctrl K`)
7. **Notificações** (sino com badge `var(--red)`)
8. **Botão primário da página** (`tb-btn-primary`)
9. Divisor vertical de 20px
10. **Avatar do usuário**
11. **Sair** (ícone)

Todos os botões da topbar usam `.tb-btn`, `.tb-btn-primary` ou `.tb-icon-btn`.

### Nav rail (68px de largura)
- Itens 44×44px, `border-radius: var(--r-lg)`.
- **Item ativo**: `background: var(--teal-dim); color: var(--teal);`
- Hover: `background: var(--bg-4); color: var(--txt-2);`
- Ícones SVG stroke-only, 18×18, `stroke-width: 1.4`.
- Use `<a href="…" class="nav-item">` para itens que navegam entre páginas (não `<div>` com onclick).
- Badges (notificação por seção) ficam no canto superior direito em `var(--red)`.
- `.nav-divider` separa grupos.
- `.nav-bottom` (`margin-top: auto`) carrega o avatar do usuário e — se aplicável — a `plan-pill` ("Plano Pro").

Itens canônicos do menu, nesta ordem:
1. Atendimentos (Omnichannel)
2. Monitor
3. Relatórios
4. CRM
5. Clientes
6. Campanhas
7. — divisor —
8. Configurações

---

## 4. Componentes

### Botões
- **`.tb-btn`** — botão padrão (cinza), 12px, peso 500, gap 5px, padding `5px 11px`, ícone SVG 12px à esquerda.
- **`.tb-btn-primary`** — versão teal, peso 600.
- **`.tb-icon-btn`** — botão quadrado 32×32 só com ícone.
- **`.btn-ghost`** — botão secundário fora da topbar (em cards/painéis), 12px, padding `6px 12px`, fundo `var(--bg-3)`.
- **`.btn-link`** — botão tracejado, ação terciária; hover muda para `var(--teal)` e borda sólida.
- **CTA grande dentro de painel** — botão teal full-width: `padding: 10px 14px; font-weight: 600;`.

> Nunca use sombra em botão. Hover é `filter: brightness(1.08)` (no primário) ou troca de `bg`.

### Cards
- **`.kpi`** / **`.kpi-card`** — métrica única; label uppercase pequeno em cima, valor grande em mono embaixo. Variantes coloridas via `kpi-blue/amber/purple` (sparkline) ou via `kpi-card.queue/live/today` (gradiente sutil + ícone canto direito).
- **Card de entidade** (cliente, agente, ticket): borda `var(--line)`, raio `var(--r-lg)`, padding `16-18px`. Use uma "online-card" variant (borda teal + gradiente sutil) para destacar estado ativo.
- **Card aninhado dentro de painel**: fundo `var(--bg-3)`, borda `var(--line)`.

### Status pills
```css
display: inline-flex; align-items: center; gap: 5px;
padding: 3-4px 10px; border-radius: var(--r-pill);
font-size: 11px; font-weight: 500;
background: var(--<cor>-dim); color: var(--<cor>);
border: 1px solid rgba(<rgb>, .25);
```
Cores por estado:
- Online / Resolvido / OK → `green`
- Atendendo / Ativo → `teal`
- Aguardando / Fila → `amber`
- Urgente / Offline-com-pendência → `red`
- E-mail / Info → `blue`
- VIP / Métrica → `purple`
- Inativo / Offline neutro → `bg-4` + `txt-3` + `line-2`

Pills com **pulso** usam `.pulse` (7×7 verde com aura). Para indicadores menores embutidos use `.live-dot` (6×6).

### Tags / chips
- **Tag de segmento** (`.tag-pill`): pill colorida, 10px, weight 500, padding `2px 8px`. Vide variantes em `apps/web/src/references/Clientes.html` (`tag-cliente`, `tag-vip`, `tag-lead`...).
- **Tag de fila/categoria hierárquica** (`.q-tag`): pill em `var(--bg-3)`, fonte mono, `›` como separador (em `var(--txt-3)`), folha em `var(--txt)` peso 500.
- **Filter chip** (`.fchip`): borda `var(--line-2)`, ícone de chevron à direita; estado `has-val` usa `var(--teal)` na borda + `var(--teal-dim)` no fundo.

### Avatares
- **Tabela** (`.tbl-avatar`): 32×32, font 12px weight 600, gradiente.
- **Detalhe hero** (`.detail-avatar-lg`): 76×76, font 26px, gradiente roxo padrão + glow radial atrás.
- **Topbar/Nav** (`.nav-avatar`): 28–32px.
- **Card de agente** (`.agent-avatar`): 38×38 + ponto de presença 11×11 sobreposto (verde online / cinza offline) com `border: 2px solid var(--bg-2)`.

Paleta de gradientes (use o sufixo `.av-*`):
```css
.av-pink   { background: linear-gradient(135deg, #F472B6, #DB2777); }
.av-purple { background: linear-gradient(135deg, #A78BFA, #7C3AED); }
.av-green  { background: linear-gradient(135deg, #34D399, #16A06B); }
.av-rose   { background: linear-gradient(135deg, #FB7185, #E11D48); }
.av-blue   { background: linear-gradient(135deg, #60A5FA, #2563EB); }
.av-amber  { background: linear-gradient(135deg, #FBBF24, #B45309); }
```

### Inputs e busca
- **`.search-box`** — container com lupa SVG, input transparente e `kbd-hint` (`Ctrl K`) à direita; foco aplica anel `box-shadow: 0 0 0 3px var(--teal-dim)`.
- Inputs gerais: `background: var(--bg-3); border: 1px solid var(--line-2); border-radius: var(--r); padding: 7-8px 11-12px; font-size: 12px;`. Focus → borda teal + anel teal-dim.

### Tabelas (`table.clients`)
- `min-width` no mínimo 1100px com `overflow-x: auto` no wrapper.
- `thead th`: sticky top, `var(--bg-2)`, label uppercase 10px peso 600 letter-spacing 0.08em em `var(--txt-3)`.
- `tbody tr`: borda inferior 1px `var(--line)`, hover `var(--bg-2)`, selected `rgba(0,201,167,.06)` com `box-shadow: inset 2px 0 0 var(--teal)` na primeira td.
- Linhas têm `.row-actions` que aparecem só em hover (ícones 26×26).
- Pagination footer (`.tbl-foot`) com botões 28×28 mono, ativo em teal.

### Timeline
Usada em painel de detalhe e em "Atividade recente". Estrutura:
```html
<div class="timeline">
  <div class="tl-item">
    <div class="tl-dot"></div>            <!-- variantes: muted, amber, blue, green, red -->
    <div class="tl-head">Título <span class="tl-time">14:32</span></div>
    <div class="tl-body">descrição secundária</div>
  </div>
</div>
```
Linha vertical 1px `var(--line-2)` à esquerda, dots 9×9 com borda 2px da cor do evento.

### Modais
- Overlay `rgba(0,0,0,.5)`, modal centralizado em `var(--bg-2)`, raio `var(--r-lg)`, `box-shadow: var(--shadow-pop)`.
- Header: 14–16px peso 600 + botão de fechar à direita.
- Footer: alinhado à direita, botão secundário `tb-btn` + primário `tb-btn-primary`. Veja `apps/web/src/references/omnichannel_chat.html`.

---

## 5. Iconografia

- **Sempre SVG inline**, stroke-only quando possível.
- Tamanhos: 11–14px em botões, 16–18px em nav/topbar, 22px em hero icons.
- `stroke-width` entre 1.2 e 1.4 (1.6 só em ícones de "+" do botão primário).
- `stroke-linecap="round"` e `stroke-linejoin="round"` por padrão.
- `color: currentColor` em ícones — herdam a cor do botão/contexto.
- **Não use** Font Awesome, Material Icons, Heroicons via `<link>`, ou emojis para ícones.

---

## 6. Tema (dark/light)

- O `<html>` carrega `data-theme="dark"` por padrão. Switch via:
  ```html
  <button class="tb-icon-btn theme-toggle" id="themeToggle">…</button>
  ```
  com os SVGs `.icon-sun` (visível só no light) e `.icon-moon` (visível só no dark).
- Persiste em `localStorage.zd-theme` e sincroniza entre abas via `storage` event.
- Use o **script anti-flash no `<head>`** (antes do `<body>`) para evitar flash do tema errado:
  ```html
  <script>(function(){try{var t=localStorage.getItem('zd-theme')||'dark';
    document.documentElement.setAttribute('data-theme',t);
  }catch(e){document.documentElement.setAttribute('data-theme','dark');}})();</script>
  ```
- **Nunca** hard-code `#fff`/`#000`. Use sempre os tokens. Se um valor não existe, escolha pelo contexto entre `--txt`, `--txt-2`, `--txt-3`, `--bg`, `--bg-2`, `--bg-3`, `--bg-4`, `--bg-5`, `--line`, `--line-2`.

---

## 7. Padrões por tipo de tela

### Listagem (Clientes, Tickets, Campanhas)
Estrutura:
```
.list-area
  .page-head        (h1 + count pill + actions)
  .kpi-row          (4 KPIs)
  .filter-bar       (busca + chips de filtro + view-toggle)
  .seg-tabs         (tabs com contadores)
  .table-wrap > table.clients
  .tbl-foot         (paginação)
+
.detail-panel        (380px à direita, opcional)
  .detail-hero, .detail-actions, .detail-section…
```

### Dashboard / Monitor
Estrutura:
```
.monitor-area
  .page-head        (h1 + subtítulo + live-badge "Atualizado agora" + Atualizar)
  .sec-head         (label de seção + count + filtros locais)
  .agents-scroll    (cards verticais)
+
.queue-panel         (420px à direita)
  .kpi-grid (3 KPIs com gradiente sutil)
  .q-panel  (estado vazio + mini-stats + CTA)
  .activity (timeline)
```

### Inbox / Conversa (Omnichannel)
3 colunas dentro de `.content`:
```
fila/lista | conversa | painel do contato
   320px   |   1fr    |        360px
```
Cabeçalho da conversa fixo, área de mensagens rolável, composer fixo no rodapé. Veja `apps/web/src/references/omnichannel_chat.html`.

### Configurações / Formulários longos
- Cabeçalho de página padrão.
- Sidebar de seções (esquerda, dentro do content) + área de formulário (direita).
- Cada seção em `.detail-section` com `.detail-section-head` (label uppercase + ação à direita) e `.kv-grid` ou linhas de formulário.
- Botão de salvar **fixo** no rodapé do painel (não rolável).

### Estado vazio
Sempre que uma lista, tabela ou painel não tem dados:
- Ícone circular ~52px com fundo `--<cor>-dim` e borda `1px solid rgba(<cor>,.25)`.
- Título 13px peso 500 em `--txt-2`.
- Subtítulo 11px em `--txt-3`.
- (Opcional) botão `tb-btn` ou CTA teal abaixo.

Exemplo: estado vazio no monitor em `apps/web/src/pages/tv/TVDashboard.tsx`.

---

## 8. Microcópia (PT-BR)

- Tom: **direto, profissional, próximo**. Evite "Olá!", emojis, e exclamações.
- Use **verbos no infinitivo** em botões: "Salvar", "Atualizar", "Novo atendimento", "Abrir no Omnichannel".
- Datas relativas em listas ("há 2h", "ontem", "14:32"). Datas absolutas em detalhes.
- Números grandes com separador de milhar PT-BR (`2.847`, não `2,847`).
- Preços em `R$ 1.234,56`.
- TMA, SLA, NPS são abreviações aceitas — não expandir.
- Nomes de filas/segmentos com `›` como separador hierárquico ("Suporte Técnico › Infraestrutura").

---

## 9. Acessibilidade

- Sempre `lang="pt-BR"` no `<html>`.
- Contraste mínimo AA: o token `--txt-2` sobre `--bg-2` já passa; `--txt-3` é só para metadados/placeholders.
- Botões só-ícone exigem `title` e `aria-label`.
- Foco visível em todos os interativos (use `:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }`).
- Hit area mínima de 32×32 em toda ação tocável.

---

## 10. Anti-padrões (não fazer)

❌ Sombras pesadas / gradientes saturados em backgrounds inteiros
❌ Cores fora dos tokens (especialmente roxo "Stripe", azul "Twitter", verde-limão)
❌ Emoji como ícone funcional
❌ Inter, Roboto, system fonts — só IBM Plex
❌ Bordas arredondadas em tabelas internas (`tr`, `td`)
❌ Botão primário com background gradiente
❌ Cards com `border-radius` > 12px (parece app de consumer, não SaaS)
❌ Ícones preenchidos (usamos stroke-only por padrão)
❌ Densidade muito baixa — ZiraDesk é uma ferramenta de trabalho, espaços enormes parecem amador
❌ Página rolando como um todo (sempre rolar dentro de uma área específica)
❌ Container principal centralizado com `max-width` em páginas autenticadas
❌ Botões com mais de 2 ícones, ou cards com mais de 3 ações primárias
❌ Background com `linear-gradient` colorido em hero (use radial sutil em `--hero-glow` se precisar)
❌ Ações "Editar / Excluir / Duplicar" sempre visíveis — use `.row-actions` com `opacity: 0` que aparecem em hover

---

## 11. Checklist para nova tela

Antes de entregar, confirme:

- [ ] Topbar idêntica às telas de referência (logo + breadcrumb + status + toggle tema + ações + avatar)
- [ ] Nav rail com 68px, item ativo em teal-dim, link para outras páginas
- [ ] Tokens CSS copiados na íntegra (dark + light)
- [ ] Script anti-flash de tema no `<head>`
- [ ] `lang="pt-BR"`, título da aba `ZiraDesk — Nome da página`
- [ ] Fontes IBM Plex Sans + IBM Plex Mono carregadas
- [ ] `html, body { overflow: hidden }` e rolagem só em áreas internas
- [ ] Wrapper principal da página autenticada ocupa 100% da largura útil (sem `max-width` + `margin: 0 auto`)
- [ ] Toggle de tema funcional + sincronização entre abas
- [ ] Estados vazios desenhados (não apenas "sem dados")
- [ ] Estados de hover/focus em todos os interativos
- [ ] Cores semânticas (verde/amber/red/blue) usadas só onde fazem sentido
- [ ] Números, IDs e horários em fonte mono
- [ ] Microcópia em PT-BR no tom certo
- [ ] Funciona em light e dark (teste o toggle)
