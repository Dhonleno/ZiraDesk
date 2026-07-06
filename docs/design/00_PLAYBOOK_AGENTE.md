# 00 — Playbook do Agente: como construir uma tela no ZiraDesk

> **Leia este documento inteiro antes de escrever qualquer linha.** Ele é o processo obrigatório.
> Vale para humanos e para agentes de IA. Saída esperada: uma tela React em `apps/web`,
> fiel ao design system, ao arquétipo certo e ao comportamento especificado.

---

## 0. Mentalidade

ZiraDesk é um **SaaS operacional de atendimento (omnichannel + CRM + tickets)**. Quem usa passa o dia inteiro na ferramenta. Portanto:

- **Densidade alta, não landing page.** Informação por pixel importa. Espaços enormes parecem amadores aqui.
- **Velocidade de leitura.** O usuário escaneia, não lê. Hierarquia, alinhamento e mono nos números fazem isso.
- **Sobriedade.** Sem gradientes coloridos de fundo, sem emoji funcional, sem "uau". O "uau" é a operação fluir.
- **Consistência acima de tudo.** Uma tela nova deve parecer que sempre existiu no produto.

---

## 1. Antes de construir — reúna o contexto (nesta ordem)

1. **`docs/design/PADRAO_DE_TELAS.md`** — design system visual completo. **Inegociável.**
2. **Este playbook** + **`01_CATALOGO_LAYOUTS.md`** — para escolher o arquétipo.
3. **PRD da tela** em `docs/design/telas/<Tela>.md`, se existir. É a fonte da verdade do comportamento e do padrão específico da tela.
   - Se não existir, escreva um a partir de `docs/design/templates/TEMPLATE_REQUISITOS_TELA.md` **antes** de codar.
4. **`ARQUITETURA_TECNICA.md`** (raiz) — para saber quais dados a tela tem (modelo §5) e de quais endpoints viriam (API §6). Mesmo em protótipo HTML, os campos exibidos devem existir no modelo.
5. **Código existente da área**, se necessário, apenas para entender contratos, componentes disponíveis e implementação legada. Código existente não define padrão visual.

---

## 2. Decisões a tomar (e travar) antes de codar

| Decisão | Como decidir |
|---|---|
| **Arquétipo** | `01_CATALOGO_LAYOUTS.md`. 90% das telas são Listagem, Detalhe, Dashboard, Inbox, Config ou Tabela-admin. |
| **Colunas do content** | 1 coluna, ou 1fr + painel lateral 360–420px? O arquétipo define o default. |
| **Item ativo no nav-rail** | Qual módulo? (Atendimentos, Monitor, Relatórios, CRM, Clientes, Campanhas, Config.) |
| **Breadcrumb** | `Módulo / Página`. Ex.: `CRM / Organizações`. |
| **Ação primária da topbar** | Quase sempre `Novo atendimento` (teal). Telas de criação podem ter ação própria. |
| **Quais estados existem** | Liste já: vazio, carregando, erro, sem permissão, sucesso. Ver `02_ESTADOS_INTERACOES.md`. |

---

## 3. Esqueleto obrigatório (todo app autenticado)

```html
<body>
  <div class="topbar">…</div>      <!-- 52px, logo + breadcrumb + ações + theme toggle + avatar -->
  <div class="main">               <!-- grid: 68px 1fr -->
    <div class="nav-rail">…</div>  <!-- 68px, item ativo em teal-dim -->
    <div class="content">…</div>   <!-- 1 ou 2 colunas; SÓ aqui rola -->
  </div>
</body>
```

Regras de ouro (de `docs/design/PADRAO_DE_TELAS.md` §3):
- `html, body { height:100%; overflow:hidden; }` — **a página nunca rola como um todo.** Só áreas internas.
- Topbar e nav-rail **fixos**. A rolagem vive em `.table-wrap`, `.detail-scroll`, `.list`, etc.
- **Toda cor via `var(--*)`.** Zero hex hardcoded em componentes.
- Ícones **SVG inline stroke**, `currentColor`, 12/14/16/18px. Sem emoji, sem icon font.
- Números, IDs, horários, contadores em **`var(--mono)`** (IBM Plex Mono).
- `lang="pt-BR"`, `<title>ZiraDesk — Nome da página</title>`.

---

## 4. Itens que TODA tela herda do padrão global

Não crie variações locais para estes itens:

1. **Tokens CSS** de `apps/web/src/styles/tokens.css`.
2. **Script anti-flash de tema** já usado pelo shell do app.
3. **Topbar** completa (logo SVG themável, breadcrumb, status "Online", **theme toggle**, busca, notificações, ação primária, avatar, sair).
4. **Nav-rail** com a ordem canônica + divisor + Configurações + rodapé (avatar + plano).
5. **Handler do theme toggle** com persistência `localStorage['zd-theme']` + sync entre abas (`storage` event).

> A logo usa classes themáveis (`.brand-logo-*`). "Zira" peso 700, "Desk" peso 300. Nunca emoji/headset.

---

## 5. Construindo o conteúdo

1. **Comprometa-se com a hierarquia.** Header de página (h1 22px) → seções (eyebrow 10px uppercase) → conteúdo.
2. **Use grid/flex com `gap`** para qualquer grupo de irmãos. Nunca espaçamento por whitespace inline.
3. **Densidade certa:** linha de tabela ~38–48px, padding de card 12–18px, gap entre blocos 12–24px.
4. **Cor semântica só onde faz sentido:** teal=primária/ativo, green=ok/online, amber=alerta/fila, red=urgente/erro, blue=info/e-mail, purple=avatar/analytics, pink=instagram. Ver `docs/design/PADRAO_DE_TELAS.md` §2.
5. **Dados realistas em PT-BR.** Nomes, CNPJs, R$ 1.234,56, datas relativas ("há 2h", "ontem", "14:32"). Nunca lorem ipsum, nunca "0 0 0 0".
6. **Desenhe os estados**, não só o "happy path cheio". Toda lista/tabela/painel precisa de estado vazio desenhado.
7. **Imagens reais via placeholder.** Não desenhe imagery em SVG; use slot/placeholder e peça o material.

---

## 6. Anti-slop — o que nunca fazer

(De `docs/design/PADRAO_DE_TELAS.md` §10 — resumo operacional.)

- ❌ Gradiente colorido em fundo inteiro; sombras pesadas em cards.
- ❌ Cores fora dos tokens (roxo Stripe, azul Twitter, verde-limão).
- ❌ Emoji como ícone; ícones preenchidos (usamos stroke).
- ❌ Inter / Roboto / system-ui — **só IBM Plex**.
- ❌ Bordas arredondadas em `tr`/`td`; `border-radius > 12px` em cards.
- ❌ Botão primário com gradiente; mais de 3 ações primárias por card.
- ❌ Página rolando inteira; densidade baixa; "data slop" (números/ícones inúteis).
- ❌ Ações Editar/Excluir sempre visíveis — use `.row-actions` com `opacity:0` que aparecem no hover.
- ❌ Conteúdo de preenchimento. Cada elemento precisa justificar sua existência. Mil "nãos" para cada "sim".

---

## 7. Checklist de entrega

Antes de considerar pronto (espelha `docs/design/PADRAO_DE_TELAS.md` §11):

- [ ] Fontes IBM Plex Sans + Mono importadas.
- [ ] Tokens globais usados a partir de `apps/web/src/styles/tokens.css`.
- [ ] Script anti-flash no `<head>`.
- [ ] `lang="pt-BR"`, `<title>ZiraDesk — …</title>`.
- [ ] Topbar no padrão do shell autenticado (logo + breadcrumb + status + theme toggle + ações + avatar).
- [ ] Nav-rail 68px, item ativo em teal-dim, links `<a>` para outras páginas.
- [ ] `html, body { overflow:hidden }`; rolagem só em áreas internas.
- [ ] Toda cor via `var(--*)`; ícones SVG stroke `currentColor`.
- [ ] Números/IDs/horários em mono.
- [ ] **Estados vazios desenhados** (não só "sem dados").
- [ ] Hover/focus em todos os interativos; foco visível (`outline: 2px solid var(--teal)`).
- [ ] Theme toggle funcional — **testado em dark E light**.
- [ ] Microcópia PT-BR no tom certo (verbos no infinitivo em botões).
- [ ] Hit area mínima 32×32 em ações tocáveis.

---

## 8. Definition of Done (resumo)

Uma tela está pronta quando: **(a)** parece nativa do ZiraDesk em dark e light, **(b)** cumpre o comportamento do PRD, **(c)** tem todos os estados desenhados, **(d)** passa o checklist §7, e **(e)** não introduz nenhum token, fonte ou cor novos.

> Em caso de dúvida entre "inventar algo bonito" e "reusar o padrão existente": **reuse o padrão.**

