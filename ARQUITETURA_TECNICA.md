# ZiraDesk — Arquitetura Técnica do MVP
> Documento gerado para orientar o desenvolvimento do sistema multitenant SaaS
> **Inclui design system de referência (Seção 3) — TODA tela nova DEVE seguir esses tokens.**

---

## 1. VISÃO GERAL

Sistema SaaS multitenant de CRM com módulos de omnichannel, gestão de organizações/contatos, tickets e administração. Modelo de isolamento: **Schema-per-tenant no PostgreSQL**.

### Módulos do MVP
- Super Admin (gestão de tenants e planos)
- Painel Admin do Tenant (configurações, usuários, integrações)
- CRM (perfil 360 de organizações e contatos)
- Omnichannel (chat unificado: WhatsApp, Instagram, E-mail)
- Gestão de Tickets

---

## 2. STACK TECNOLÓGICA

### Backend
```
Runtime:      Node.js 20 LTS
Framework:    Fastify 4
Linguagem:    TypeScript
ORM:          Prisma
Banco:        PostgreSQL 16
Cache/Fila:   Redis 7 + BullMQ
Realtime:     Socket.io 4
Auth:         JWT + Refresh Token
Validação:    Zod
Uploads:      MinIO (S3-compatible)
Email:        Resend
Logs:         Pino
Testes:       Vitest + Supertest
```

### Frontend
```
Framework:    React 18 + Vite
Linguagem:    TypeScript
Roteamento:   React Router v6
Estado:       Zustand + TanStack Query v5
Forms:        React Hook Form + Zod
Realtime:     Socket.io-client
Estilo:       CSS variables + Tailwind opcional (tokens da Seção 3.2 são fonte da verdade — Tailwind, se usado, deve mapear para `var(--*)` no theme extend)
Build:        Vite
Testes:       Vitest + Testing Library
```

### Infraestrutura (MVP)
```
Deploy:       VPS Contabo + Docker Compose + Nginx
CDN/Storage:  Cloudflare R2
DNS:          Cloudflare (app.ziradesk.com, api.ziradesk.com, *.ziradesk.com)
CI/CD:        GitHub Actions
Monitoramento: Sentry (erros) + Umami (analytics)
```

Observacao de escopo atual:
- O portal `suporte.{tenant}.ziradesk.com` nao esta ativo na producao atual.
- O Origin Certificate atual cobre `ziradesk.com` e `*.ziradesk.com`, mas nao
  cobre `*.*.ziradesk.com`.

---

## 3. DESIGN SYSTEM — REFERÊNCIA OBRIGATÓRIA

> Fonte de verdade oficial: [docs/design/PADRAO_DE_TELAS.md](docs/design/PADRAO_DE_TELAS.md)
> Padrões específicos de tela: [docs/design/telas/](docs/design/telas/).
> Toda nova página DEVE seguir os tokens globais e o PRD da própria tela. Não inventar paletas, espaçamentos, tipografia ou estrutura novas.

Documentação complementar de produto/UX:
- [docs/design/00_PLAYBOOK_AGENTE.md](docs/design/00_PLAYBOOK_AGENTE.md) — processo obrigatório para construir telas.
- [docs/design/01_CATALOGO_LAYOUTS.md](docs/design/01_CATALOGO_LAYOUTS.md) — arquétipos de layout.
- [docs/design/02_ESTADOS_INTERACOES.md](docs/design/02_ESTADOS_INTERACOES.md) — estados, loading, vazio, erro e feedback.
- [docs/design/03_CONTEUDO_VOZ.md](docs/design/03_CONTEUDO_VOZ.md) — microcópia e vocabulário canônico.
- [docs/design/04_NAVEGACAO_FLUXOS.md](docs/design/04_NAVEGACAO_FLUXOS.md) — navegação, fluxos, breadcrumbs e permissões.
- [docs/design/telas/](docs/design/telas/) — PRDs de telas específicas.

### 3.0 Gate Obrigatório Para Alterações de UI (Agente IA e Humanos)

Antes de qualquer alteração em UI (`apps/web/**`), executar este pre-check:

- Ler [docs/design/PADRAO_DE_TELAS.md](docs/design/PADRAO_DE_TELAS.md) por completo.
- Confirmar conformidade com topbar, nav rail, tokens de tema, tipografia IBM Plex e padrão de rolagem interna.
- Identificar o PRD da tela em `docs/design/telas/`; se não existir, criar a especificação antes da implementação.
- Validar checklist final do padrão de telas (seção "Checklist para nova tela").

### 3.1 Marca

- **Nome do produto:** ZiraDesk (NÃO usar "NexCRM" em UI)
- **Logo:** SVG inline na topbar — quadrado preto com símbolo "Z" estilizado (4 segmentos formando o Z em zigue-zague), seguido de "Zira" em peso 700 e "Desk" em peso 300
- **Logo deve ser tematizada via classes** (`.brand-logo-bg`, `.brand-logo-stroke`, `.brand-logo-z`, `.brand-logo-zira`, `.brand-logo-desk`) — nunca hardcodar `fill="#..."` no SVG
- **Cor primária:** Teal `#00C9A7` (dark) / `#00A88C` (light)

### 3.2 Tokens CSS (copiar verbatim para qualquer tela nova)

```css
:root, [data-theme="dark"] {
  /* Surfaces — escala de profundidade */
  --bg:        #0E0F11;   /* canvas */
  --bg-2:      #141518;   /* topbar, nav-rail, footers */
  --bg-3:      #1A1C20;   /* cards, chips */
  --bg-4:      #22252B;   /* hover, controles */
  --bg-5:      #2A2E36;   /* hover sobre bg-4 */

  /* Lines */
  --line:      rgba(255,255,255,.07);
  --line-2:    rgba(255,255,255,.12);

  /* Text */
  --txt:       #F0F1F3;   /* primário */
  --txt-2:     #9DA3AE;   /* secundário */
  --txt-3:     #5C6370;   /* terciário / labels */

  /* Acento (teal) */
  --teal:      #00C9A7;
  --teal-dim:  rgba(0,201,167,.15);
  --teal-glow: rgba(0,201,167,.3);

  /* Estados semânticos — sempre como par cor + dim */
  --green:     #3ECF8E;   --green-dim:  rgba(62,207,142,.15);   /* sucesso, online */
  --amber:     #F59E0B;   --amber-dim:  rgba(245,158,11,.15);   /* alerta, lead */
  --red:       #F87171;   --red-dim:    rgba(248,113,113,.15);  /* erro, urgente */
  --blue:      #60A5FA;   --blue-dim:   rgba(96,165,250,.15);   /* info */
  --purple:    #A78BFA;   --purple-dim: rgba(167,139,250,.15);  /* avatar default */
  --pink:      #F472B6;   --pink-dim:   rgba(244,114,182,.15);  /* instagram */

  /* Tipografia */
  --font: 'IBM Plex Sans', sans-serif;
  --mono: 'IBM Plex Mono', monospace;

  /* Geometria */
  --r: 8px;          /* botões, chips, inputs */
  --r-lg: 12px;      /* cards, modals, nav-items */
  --r-xl: 16px;      /* hero cards, modais grandes */
  --r-pill: 999px;   /* badges, pills, status */

  /* Helpers */
  --on-teal:   #0E0F11;                                   /* texto sobre fundo teal */
  --shadow-pop: 0 24px 60px rgba(0,0,0,.55), 0 0 0 1px var(--line);
  --backdrop:  rgba(8,9,11,.72);                          /* overlay de modal */
}

[data-theme="light"] {
  --bg:        #F4F6F9;
  --bg-2:      #FFFFFF;
  --bg-3:      #FFFFFF;
  --bg-4:      #F0F2F6;
  --bg-5:      #E5E8EE;

  --line:      rgba(15,18,24,.08);
  --line-2:    rgba(15,18,24,.14);

  --txt:       #14171C;
  --txt-2:     #54606E;
  --txt-3:     #8A94A1;

  --teal:      #00A88C;
  --teal-dim:  rgba(0,168,140,.12);
  --teal-glow: rgba(0,168,140,.25);

  --green:     #16A06B;   --green-dim:  rgba(22,160,107,.12);
  --amber:     #B7791F;   --amber-dim:  rgba(245,158,11,.14);
  --red:       #DC2F4E;   --red-dim:    rgba(220,47,78,.10);
  --blue:      #2563EB;   --blue-dim:   rgba(37,99,235,.10);
  --purple:    #7C3AED;   --purple-dim: rgba(124,58,237,.10);
  --pink:      #DB2777;   --pink-dim:   rgba(219,39,119,.10);

  --on-teal:   #FFFFFF;
  --shadow-pop: 0 24px 60px rgba(15,18,24,.14), 0 0 0 1px var(--line);
  --backdrop:  rgba(20,23,28,.42);
}

html { color-scheme: dark; }
[data-theme="light"] { color-scheme: light; }
```

**Regras invioláveis:**
- Toda cor de UI vem de variável CSS — NUNCA hardcodar hex em componentes
- Estados semânticos sempre em par `--{cor}` + `--{cor}-dim` (ex: texto `var(--green)` sobre fundo `var(--green-dim)`)
- Para cor sobre fundo teal, usar `var(--on-teal)` — adapta automaticamente ao tema
- Sombras pesadas só em modais e popovers (`--shadow-pop`); cards usam apenas `border: 1px solid var(--line)`

### 3.3 Tipografia

| Uso | Tamanho | Peso | Família | Cor |
|---|---|---|---|---|
| H1 página (`.page-head h1`) | 22px | 600 | Sans, letter-spacing -0.4px | `--txt` |
| H2 / nome em hero (`.detail-name`) | 17px | 600 | Sans, letter-spacing -0.3px | `--txt` |
| Body padrão (`<body>`) | 13px | 400 | Sans, line-height 1.5 | `--txt` |
| Nomes em tabela | 13px | 500 | Sans | `--txt` |
| Texto secundário | 12px | 400 | Sans | `--txt-2` |
| Subtítulos / metadata | 11px | 400 | Sans | `--txt-3` |
| **Eyebrow / section title** | 10px | 600 | Sans, **uppercase**, letter-spacing 0.08em | `--txt-3` |
| Números (KPI grande) | 22px | 600 | **Mono**, letter-spacing -0.4px | `--txt` |
| Números inline (preço, data, ID) | 11–12px | 400–500 | **Mono** | conforme contexto |

**Regras:**
- Body do app fixo em **13px** — não escalar em telas internas
- Mono **só** para números, IDs, timestamps, atalhos de teclado, contadores. Nunca em texto de leitura
- Eyebrow uppercase + tracking 0.08em é assinatura do produto — usar em todo título de seção lateral
- `font-family: 'IBM Plex Sans'` (importar do Google Fonts) — não substituir por Inter, system-ui ou outras

### 3.4 Espaçamento e densidade

- **Densidade alta** (linha de tabela ~38px, padding interno de cards 12–14px) — produto é operacional, não landing page
- **Padding de página:** `18px 24px 12px` no header, `14px 24px` nas linhas de filtros e KPI
- **Gap padrão:** 6px (controles dentro de chip), 10px (chips em linha), 14px (entre seções inline), 24px (entre blocos de página)
- **Border radius:** `--r` (8px) para tudo que é interativo/inline, `--r-lg` (12px) para containers, `--r-pill` para badges/status
- **Não usar `gap: 0`** ou densidades extremas — manter respiração mínima de 4px

### 3.5 Layout shell — toda tela autenticada

```
┌─────────────────────────────────────────────────────────────┐
│  TOPBAR  height: 52px, bg-2, border-bottom: line            │ ← logo + breadcrumb + ações + theme toggle + avatar
├──────┬──────────────────────────────────────────────────────┤
│      │                                                      │
│ NAV  │  CONTENT AREA                                        │
│ RAIL │                                                      │
│ 68px │  display: grid; grid-template-columns: 1fr [380px];  │ ← painel direito de detalhes opcional
│      │                                                      │
└──────┴──────────────────────────────────────────────────────┘
```

- **Topbar:** `height: 52px`, `bg: var(--bg-2)`, `border-bottom: 1px solid var(--line)`. Sempre contém: logo (esquerda) → breadcrumb (centro) → ações + status indicator + **theme toggle** + nav-avatar (direita)
- **Nav rail:** largura `68px`, `bg: var(--bg-2)`. Itens são quadrados `44×44px` com `border-radius: var(--r-lg)`. Estado `active` usa `bg: var(--teal-dim); color: var(--teal)`
- **Conteúdo:** `html, body { overflow: hidden; height: 100% }` — só áreas internas rolam (lista, painel de detalhe). Topbar e nav-rail nunca rolam
- **Painel de detalhe lateral:** 380px fixo, `border-left: 1px solid var(--line)`

### 3.6 Componentes canônicos

#### Botões
- `.tb-btn` (topbar): `padding: 5px 11px`, `font-size: 12px`, `font-weight: 500`, `bg: var(--bg-4)`, `border: 1px solid var(--line-2)`
- `.tb-btn-primary`: `bg: var(--teal)`, `color: var(--on-teal)`, `font-weight: 600`. Hover: `filter: brightness(1.08)` (NÃO trocar cor)
- `.tb-icon-btn`: `32×32px`, quadrado com `--r`, sem texto
- `.btn-primary` / `.btn-ghost` (modais): mesmo padrão mas `padding: 8px 14px`, `font-size: 13px`

#### Inputs e busca
- `.search-box`: container com ícone à esquerda + input + atalho `kbd-hint` (mono 10px) à direita. `border-radius: var(--r)`, `border: 1px solid var(--line-2)`
- Foco: `border-color: var(--teal); box-shadow: 0 0 0 3px var(--teal-dim)` — **3px de halo** é assinatura

#### Chips e pills
- `.fchip` (filtro): `padding: 6px 10px`, `bg: var(--bg-3)`, `border: 1px solid var(--line-2)`. Variante `.has-val` quando há filtro aplicado: `border-color: var(--teal); color: var(--teal); bg: var(--teal-dim)`
- `.tag-pill`: `font-size: 10px`, `padding: 2px 8px`, `border-radius: var(--r-pill)`. Cor pelo contexto: `tag-cliente`/`tag-lead`/`tag-prospect` etc., sempre par cor + dim
- `.status-indicator` (Online): `bg: var(--green-dim)`, `border: rgba(62,207,142,.25)`, `color: var(--green)`, com `.pulse` animado

#### Tabela
- Cabeçalho `<th>`: eyebrow style (10px, 600, uppercase, tracking 0.08em, `var(--txt-3)`), `bg: var(--bg-2)`, `border-bottom: 1px solid var(--line)`, `padding: 10px 14px`
- Linha hover: `bg: var(--bg-3)`. Linha selecionada: `bg: var(--teal-dim)` ou borda lateral teal
- Avatar de linha: `32×32px`, círculo com `linear-gradient` específico por cliente
- `.row-actions`: `opacity: 0`, aparecem em hover/selected

#### Cards e KPIs
- `.kpi`: `bg: var(--bg-2)`, `border: 1px solid var(--line)`, `border-radius: var(--r-lg)`, `padding: 12px 14px`
- Estrutura interna: label eyebrow → valor mono 22px → delta pill (`.delta.up` / `.delta.down`)
- Cards de detalhe (`.detail-section`): `padding: 14px 18px`, `border-bottom: 1px solid var(--line)` para separar — não usar shadows entre seções

#### Avatar
- Tabela: 32×32, círculo, gradiente customizado por cliente
- Detalhe (hero): 76×76, gradiente, `font-size: 26px font-weight: 600`
- Topbar/nav: 28×28 ou 32×32 com `border: 2px solid var(--bg-5)` quando dentro do nav-rail
- Fundo padrão se sem cor: `linear-gradient(135deg, var(--purple), #8B5CF6)`

#### Modais
- Overlay: `bg: var(--backdrop)`, `backdrop-filter: blur(6px)`
- Painel: `bg: var(--bg-2)`, `border-radius: var(--r-xl)`, `box-shadow: var(--shadow-pop)`, `padding: 20px 24px`
- Header do modal: `font-size: 16px font-weight: 600` + ícone de fechar à direita
- Footer do modal: `border-top: 1px solid var(--line)`, ações alinhadas à direita

### 3.7 Iconografia

- **Stroke icons SVG inline** — nunca emoji, nunca icon font, nunca biblioteca de imagens
- Tamanhos canônicos: **12×12** (dentro de botão pequeno), **14×14** (em chip/dact), **16×16** (theme toggle, ações), **18×18** (nav-rail)
- `stroke="currentColor"`, `stroke-width="1.2"` a `1.4`, `stroke-linecap="round"`, `stroke-linejoin="round"`
- Cor por `currentColor` apenas — nunca hardcodar `stroke="#..."`
- Logos de canais externos (WhatsApp `#25D366`, Instagram gradiente, Email): exceção permitida onde a cor é parte da marca externa

### 3.8 Estados semânticos — quando usar cada cor

| Token | Uso |
|---|---|
| `--teal` | Cor primária do produto: estado ativo de nav, CTA primário, links, ações principais, focus rings |
| `--green` | Online/disponível, sucesso, atendimento resolvido, métrica positiva |
| `--amber` | Lead (no funil), warnings, atendimento aguardando |
| `--red` | Erro, urgente, badge de notificação, atendimento não atendido, métrica negativa |
| `--blue` | Informação neutra, e-mail como canal |
| `--purple` | Avatares default, Instagram (junto com `--pink`) |
| `--pink` | Instagram, campanhas |

### 3.9 Theme toggle (dark/light)

Toda tela DEVE incluir o toggle. Implementação canônica:

**1. No-flash script no `<head>`** (antes de qualquer `<style>`):
```html
<script>
  (function(){
    try {
      var t = localStorage.getItem('zd-theme') || 'dark';
      document.documentElement.setAttribute('data-theme', t);
    } catch(e) { document.documentElement.setAttribute('data-theme','dark'); }
  })();
</script>
```

**2. Botão na topbar** (entre status indicator e botões de ação):
```html
<button class="tb-icon-btn theme-toggle" id="themeToggle" aria-label="Alternar tema">
  <svg class="icon-sun" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="3.2" stroke="currentColor" stroke-width="1.4"/>
    <path d="M8 1.5v1.8M8 12.7v1.8M14.5 8h-1.8M3.3 8H1.5M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3M12.6 12.6l-1.3-1.3M4.7 4.7L3.4 3.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
  </svg>
  <svg class="icon-moon" width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>
</button>
```

**3. CSS de swap dos ícones:**
```css
.theme-toggle .icon-sun { display: none; }
.theme-toggle .icon-moon { display: block; }
[data-theme="light"] .theme-toggle .icon-sun { display: block; }
[data-theme="light"] .theme-toggle .icon-moon { display: none; }
```

**4. Handler com persistência + sync entre abas:**
```js
document.getElementById('themeToggle').addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  try { localStorage.setItem('zd-theme', next); } catch(e){}
});
window.addEventListener('storage', e => {
  if (e.key === 'zd-theme' && e.newValue) {
    document.documentElement.setAttribute('data-theme', e.newValue);
  }
});
```

**Default é `dark`.** Persistência em `localStorage['zd-theme']`. Sincroniza automaticamente entre todas as abas/páginas do app.

### 3.10 Animações

- **Transições padrão:** `transition: all .15s` em hover de botões e nav. `transition: opacity .12s` em row-actions
- **Pulse (online):** keyframe 2s ease infinite, `scale 1→1.8` + `opacity .4→0`
- **Modais:** fade do overlay + scale 0.96→1 do painel, 200ms ease-out
- **Não usar:** bouncy easings, animações longas (>300ms), parallax, scroll-jacking

### 3.11 Checklist obrigatório para nova tela

- [ ] Importou `IBM Plex Sans` e `IBM Plex Mono` do Google Fonts
- [ ] Copiou bloco completo de tokens CSS (`:root, [data-theme="dark"]` + `[data-theme="light"]`)
- [ ] Inseriu no-flash script no `<head>`
- [ ] Topbar com logo ZiraDesk (SVG com classes themable), breadcrumb, status, theme toggle, avatar
- [ ] Nav-rail 68px com itens 44×44px e estado `active` em teal
- [ ] Body 13px, h1 22px, eyebrow 10px uppercase tracking 0.08em
- [ ] Toda cor via `var(--*)` — zero hex hardcoded em componentes
- [ ] Ícones SVG stroke `currentColor`, sizes 12/14/16/18
- [ ] Theme toggle funcional + testado em light e dark
- [ ] `html, body { overflow: hidden; height: 100% }` — apenas áreas internas rolam

### 3.12 Padrões por tela

Os padrões específicos de tela ficam em `docs/design/telas/*.md`. Cada PRD deve definir:
- arquétipo e rota;
- layout e áreas de rolagem;
- dados exibidos;
- ações e permissões;
- estados de loading, vazio, erro e sem permissão;
- microcópia e regras de negócio.

**Ao criar tela nova:** localizar o PRD correspondente. Se não existir, criar a especificação a partir de `docs/design/templates/TEMPLATE_REQUISITOS_TELA.md` antes da implementação.

---

## 4. ESTRATÉGIA MULTITENANT — SCHEMA PER TENANT

### Como funciona
Cada tenant recebe um schema isolado no PostgreSQL.
O schema `public` é reservado para dados globais (tenants, planos, cobrança).

```
public/
  tenants
  plans
  subscriptions
  super_admins

tenant_{slug}/          ← criado automaticamente no cadastro
  users
  organizations
  contacts
  conversations
  messages
  tickets
  tags
  pipelines
  ...
```

### Resolução do tenant por subdomínio
```
empresa.ziradesk.com
    ↓
Middleware extrai "empresa"
    ↓
Busca tenant no schema public
    ↓
Abre transação request-scoped e executa SET LOCAL search_path = tenant_empresa, public
    ↓
Queries tenant-scoped usam o client Prisma do contexto da request; modelos globais seguem no schema public
```

### Middleware de tenant (pseudocódigo)
```typescript
async function tenantMiddleware(request, reply) {
  const host = request.headers.host // empresa.ziradesk.com
  const slug = host.split('.')[0]

  const tenant = await db.public.tenant.findUnique({ where: { slug } })
  if (!tenant) return reply.status(404).send({ error: 'Tenant not found' })
  if (tenant.status !== 'active') return reply.status(402).send({ error: 'Subscription inactive' })

  // Vincula a request a uma transação com SET LOCAL, evitando vazamento pelo pool.
  const tx = await openRequestTransaction()
  await tx.$executeRaw`SET LOCAL search_path TO "tenant_${slug}", public`
  enterPrismaContext(tx)
  request.tenant = tenant
}
```

---

## 5. MODELO DE BANCO DE DADOS

### Schema PUBLIC (global)

```sql
-- Planos disponíveis
CREATE TABLE plans (
  id          TEXT PRIMARY KEY, -- cuid gerado pelo Prisma
  name        VARCHAR(50) NOT NULL,        -- 'Starter', 'Pro', 'Enterprise'
  slug        VARCHAR(50) UNIQUE NOT NULL,
  price_month DECIMAL(10,2),
  price_year  DECIMAL(10,2),
  max_users   INTEGER,
  max_contacts INTEGER,
  features    JSONB,                       -- { omnichannel: true, api_access: false }
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Empresas/tenants
CREATE TABLE tenants (
  id          TEXT PRIMARY KEY, -- cuid gerado pelo Prisma
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(50) UNIQUE NOT NULL, -- subdomínio
  schema_name VARCHAR(63) UNIQUE NOT NULL, -- tenant_{slug}
  plan_id     TEXT REFERENCES plans(id),
  status      VARCHAR(20) DEFAULT 'active', -- active | suspended | cancelled
  trial_ends_at TIMESTAMPTZ,
  settings    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Assinaturas e cobrança
CREATE TABLE subscriptions (
  id              TEXT PRIMARY KEY, -- cuid gerado pelo Prisma
  tenant_id       TEXT REFERENCES tenants(id),
  plan_id         TEXT REFERENCES plans(id),
  status          VARCHAR(20),  -- active | past_due | cancelled
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  payment_gateway VARCHAR(30),  -- 'stripe' | 'pagarme'
  gateway_sub_id  VARCHAR(100),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Super admins (acesso total ao sistema)
CREATE TABLE super_admins (
  id           TEXT PRIMARY KEY, -- cuid gerado pelo Prisma
  name         VARCHAR(100) NOT NULL,
  email        VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

### Schema TENANT (replicado por empresa)

> **Arquitetura dual de identificadores:** ZiraDesk usa duas estratégias
> de geração de ID conforme o schema:
> - Schema `public` (gerenciado por Prisma): cuid (~25 chars, prefix 'c')
>   gerado via @default(cuid()) do Prisma.
> - Schemas `tenant_{slug}` (provisionados via SQL raw em
>   tenants.service.ts): UUID v4 gerado via gen_random_uuid() do Postgres.
>
> Esta dualidade é intencional. Validações de payload e schemas devem
> aceitar o formato apropriado por campo, não forçar uniformidade.

```sql
-- Usuários do tenant
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(30) DEFAULT 'agent',  -- owner | admin | agent | viewer
  avatar_url    VARCHAR(500),
  status        VARCHAR(20) DEFAULT 'active', -- active | inactive
  last_seen_at  TIMESTAMPTZ,
  settings      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Organizações (CRM)
CREATE TABLE organizations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            VARCHAR(20) DEFAULT 'company', -- company | person
  name            VARCHAR(150) NOT NULL,
  document        VARCHAR(20),                  -- CPF ou CNPJ
  email           VARCHAR(255),
  phone           VARCHAR(30),
  website         VARCHAR(255),
  status          VARCHAR(30) DEFAULT 'lead',   -- lead | prospect | client | inactive
  address_street  VARCHAR(200),
  address_city    VARCHAR(100),
  address_state   VARCHAR(2),
  address_zip     VARCHAR(10),
  segment         VARCHAR(100),
  lead_source     VARCHAR(100),
  responsible_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  tags            TEXT[] DEFAULT '{}',
  custom_fields   JSONB DEFAULT '{}',
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Contatos (CRM)
CREATE TABLE contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  name            VARCHAR(150) NOT NULL,
  email           VARCHAR(255),
  phone           VARCHAR(30),
  whatsapp        VARCHAR(30),
  document        VARCHAR(20),
  role            VARCHAR(100),
  department      VARCHAR(100),
  is_primary      BOOLEAN DEFAULT false,
  avatar_url      VARCHAR(500),
  portal_enabled  BOOLEAN DEFAULT false,
  portal_password_hash VARCHAR(255),
  portal_last_login TIMESTAMPTZ,
  portal_invited_at TIMESTAMPTZ,
  tags            TEXT[] DEFAULT '{}',
  custom_fields   JSONB DEFAULT '{}',
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Canais de comunicação integrados
CREATE TABLE channels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type         VARCHAR(30) NOT NULL, -- whatsapp | instagram | email | webchat
  name         VARCHAR(100) NOT NULL,
  credentials  JSONB NOT NULL,       -- tokens, webhooks (criptografado)
  status       VARCHAR(20) DEFAULT 'active',
  settings     JSONB DEFAULT '{}',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Conversas (omnichannel)
CREATE TABLE conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID REFERENCES contacts(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  channel_id    UUID REFERENCES channels(id),
  channel_type  VARCHAR(30) NOT NULL,
  conversation_type VARCHAR(20) DEFAULT 'inbound', -- inbound | outbound
  external_id   VARCHAR(255),              -- ID da conversa no canal externo
  status        VARCHAR(20) DEFAULT 'open', -- open | waiting | closed
  assigned_to   UUID REFERENCES users(id),
  assigned_at   TIMESTAMPTZ,
  subject       VARCHAR(255),
  last_message  TEXT,
  last_message_at TIMESTAMPTZ,
  closed_at     TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  closure_reason JSONB,      -- { reason, notes?, resolvedAt, agentId, closeTypeId?, closeOutcomeId? }
  waiting_expires_at TIMESTAMPTZ,
  queue_entered_at TIMESTAMPTZ,
  close_type_id VARCHAR(30),
  close_outcome_id VARCHAR(30),
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Status de conversas
-- open: atendimento aberto. Se assigned_to IS NULL, está na fila; se assigned_to preenchido, está em atendimento humano.
-- waiting: envio ativo aguardando resposta do cliente. O tipo segue indicado por conversation_type = 'outbound'.
-- closed: atendimento encerrado com justificativa em closure_reason.

-- Mensagens
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender_type     VARCHAR(20) NOT NULL, -- client | agent | bot | system
  sender_id       UUID,                 -- user_id se agent
  content         TEXT,
  content_type    VARCHAR(30) DEFAULT 'text', -- text | image | audio | video | document | template
  media_url       VARCHAR(500),
  external_id     VARCHAR(255),         -- ID da mensagem no canal externo
  status          VARCHAR(20) DEFAULT 'sent', -- sent | delivered | read | failed
  is_internal     BOOLEAN DEFAULT false, -- nota interna (não vai ao cliente)
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Tickets
CREATE TABLE tickets (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id    UUID REFERENCES contacts(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  conversation_id UUID REFERENCES conversations(id),
  title         VARCHAR(255) NOT NULL,
  description   TEXT,
  status        VARCHAR(30) DEFAULT 'open', -- open | in_progress | waiting | resolved | closed
  priority      VARCHAR(20) DEFAULT 'medium', -- low | medium | high | urgent
  category      VARCHAR(100),
  assigned_to   UUID REFERENCES users(id),
  resolved_at   TIMESTAMPTZ,
  due_date      TIMESTAMPTZ,
  tags          TEXT[] DEFAULT '{}',
  custom_fields JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Comentários de tickets
CREATE TABLE ticket_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  UUID REFERENCES tickets(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id),
  content    TEXT NOT NULL,
  is_internal BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit log (LGPD)
CREATE TABLE audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID,
  action     VARCHAR(100) NOT NULL,
  entity     VARCHAR(50) NOT NULL,
  entity_id  UUID,
  old_data   JSONB,
  new_data   JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Nota: no schema `public`, IDs seguem cuid via Prisma; nos schemas de tenant, IDs seguem UUID v4 via `gen_random_uuid()`.

---

## 6. ARQUITETURA DE API

### Estrutura de rotas

Legenda: ✅ implementado | ❌ ausente | ⚠️ parcial | `(novo)` presente no código, ausente na doc anterior

```
/api
  /auth
    POST   /login                                         ✅
    POST   /logout                                        ✅
    POST   /refresh                                       ✅
    POST   /forgot-password                               ❌  ausente no código
    POST   /reset-password                                ❌  ausente no código
    GET    /me                                            ✅  (novo) perfil do usuário logado
    PATCH  /me                                            ✅  (novo) atualizar perfil
    PATCH  /me/password                                   ✅  (novo) trocar senha
    POST   /me/avatar                                     ✅  (novo) upload de avatar
    GET    /me/avatar/:fileName                           ✅  (novo) servir avatar

  /super-admin              ← JWT com role=super_admin
    GET    /tenants                                       ✅
    GET    /tenants/check-slug                            ✅  (novo) disponibilidade de slug
    GET    /tenants/stats                                 ✅  (novo) KPIs globais de todos os tenants
    POST   /tenants                                       ✅
    GET    /tenants/:id                                   ✅  (novo)
    PATCH  /tenants/:id                                   ✅
    DELETE /tenants/:id                                   ✅  (novo)
    POST   /tenants/:id/suspend                           ✅  (novo)
    POST   /tenants/:id/activate                          ✅  (novo)
    POST   /tenants/:id/impersonate                       ✅  (novo) gera token de admin do tenant
    GET    /tenants/:id/users                             ✅  (novo)
    POST   /tenants/:id/users                             ✅  (novo) convidar usuário como super admin
    POST   /tenants/:id/users/:userId/reset-password      ✅  (novo)
    GET    /tenants/:id/stats                             ❌  ausente (substituído por /tenants/stats global)
    GET    /plans                                         ✅
    GET    /plans/:id                                     ✅  (novo)
    POST   /plans                                         ✅
    PATCH  /plans/:id                                     ✅
    DELETE /plans/:id                                     ✅  (novo)

  /admin                    ← JWT com role=owner|admin
    GET    /settings                                      ✅
    PATCH  /settings                                      ✅
    POST   /settings/logo                                 ✅  (novo) upload logo do tenant
    GET    /settings/logo/:fileName                       ✅  (novo) servir logo
    GET    /users                                         ✅
    GET    /users/:id                                     ✅  (novo)
    POST   /users/invite                                  ✅
    PATCH  /users/:id                                     ✅
    POST   /users/:id/reset-password                      ✅  (novo)
    DELETE /users/:id                                     ✅
    GET    /channels                                      ✅
    GET    /channels/:id                                  ✅  (novo)
    POST   /channels                                      ✅
    PATCH  /channels/:id                                  ✅
    DELETE /channels/:id                                  ✅
    POST   /channels/:id/test                             ✅  (novo) testar conectividade do canal
    GET    /stats/overview                                ✅
    ── Sub-módulos adicionais (novo) ─────────────────────────────────────────
    /admin/ai                  GET+PATCH config IA do tenant
    /admin/auto-assign         GET+PATCH regras de auto-atribuição
    /admin/bot                 GET+PATCH menu do bot
    /admin/business-hours      GET+PATCH horário de funcionamento
    /admin/close-config        CRUD motivos/desfechos de encerramento
    /admin/conversation-tags   CRUD tags de conversa
    /admin/onboarding          GET status do onboarding
    /admin/pause-reasons       CRUD motivos de pausa
    /admin/quick-replies       CRUD respostas rápidas
    /admin/redmine             GET+PATCH integração Redmine
    /admin/skills              CRUD skills de agentes
    /admin/smtp                GET+PATCH+POST(/test) config SMTP
    /admin/templates           CRUD templates WhatsApp + sync Meta
    /admin/ticket-types        CRUD tipos de ticket
    /admin/webhooks            CRUD webhooks de saída (outbound)

  /crm
    GET    /organizations                                 ✅  (lista com filtros e paginação)
    POST   /organizations                                 ✅
    GET    /organizations/:id                             ✅
    PATCH  /organizations/:id                             ✅
    DELETE /organizations/:id                             ✅
    GET    /organizations/:id/stats                       ✅
    GET    /organizations/:id/contacts                    ✅
    GET    /organizations/:id/conversations               ✅
    GET    /organizations/:id/tickets                     ✅
    GET    /contacts                                      ✅
    POST   /contacts                                      ✅
    GET    /contacts/:id                                  ✅
    PATCH  /contacts/:id                                  ✅
    DELETE /contacts/:id                                  ✅
    GET    /contacts/:id/stats                            ✅
    POST   /contacts/:id/link-organization                ✅
    POST   /contacts/:id/portal-access                    ✅
    DELETE /contacts/:id/portal-access                    ✅

  /omnichannel
    GET    /conversations                                 ✅  (filtros: status, assigned_to_me, channel)
    GET    /conversations/counts                          ✅  (novo) contadores por aba
    POST   /conversations                                 ✅
    GET    /conversations/:id                             ✅
    GET    /conversations/:id/window-status               ✅  (novo) janela de 24h WhatsApp
    PATCH  /conversations/:id                             ✅
    POST   /conversations/:id/assign                      ✅
    POST   /conversations/:id/close                       ✅  (novo — substitui /resolve)
    GET    /conversations/:id/messages                    ✅
    POST   /conversations/:id/messages                    ✅
    POST   /conversations/:id/transfer                    ✅
    GET    /conversations/:id/helpers                     ✅  (novo) co-atendentes ativos
    POST   /conversations/:id/request-help                ✅  (novo)
    POST   /conversations/:id/accept-help                 ✅  (novo)
    POST   /conversations/:id/decline-help                ✅  (novo)
    DELETE /conversations/:id/help                        ✅  (novo) encerrar co-atendimento
    GET    /close-config                                  ✅  motivos/desfechos ativos
    GET    /queue                                         ✅  conversas abertas sem agente
    POST   /queue/:id/assign-me                           ✅
    GET    /templates                                     ✅  (novo) templates aprovados para outbound
    POST   /active-outbound                               ✅  (novo) envio ativo WhatsApp/email
    ── Sub-módulos adicionais (novo) ─────────────────────────────────────────
    /omnichannel/availability  GET+PATCH disponibilidade do agente
    /omnichannel/goals         GET+PATCH metas de atendimento
    /omnichannel/history       GET histórico de conversas encerradas
    /omnichannel/media         POST upload de mídia + GET proxy
    /omnichannel/metrics       GET métricas em tempo real
    /omnichannel/monitor       GET visão de monitor (painel TV)
    /omnichannel/pause         POST iniciar/encerrar pausa
    /omnichannel/performance   GET desempenho por agente

  /tickets
    GET    /tickets                                       ✅
    GET    /tickets/stats                                 ✅  (novo)
    GET    /tickets/export                                ✅  (novo) exportação CSV
    GET    /tickets/search                                ✅  (novo) busca rápida para vincular
    POST   /tickets                                       ✅
    GET    /tickets/:id                                   ✅
    PATCH  /tickets/:id                                   ✅
    DELETE /tickets/:id                                   ✅
    POST   /tickets/:id/assign                            ✅  (novo)
    GET    /tickets/:id/comments                          ✅
    POST   /tickets/:id/comments                          ✅
    PATCH  /tickets/:id/comments/:commentId               ✅  (novo)
    DELETE /tickets/:id/comments/:commentId               ✅  (novo)
    GET    /tickets/:id/attachments                       ✅  (novo)
    POST   /tickets/:id/attachments                       ✅  (novo) multipart upload
    DELETE /tickets/attachments/:attachmentId             ✅  (novo)
    GET    /tickets/attachments/:attachmentId/content     ✅  (novo) proxy de download
    GET    /tickets/:id/relations                         ✅  (novo) vínculos entre tickets
    POST   /tickets/:id/relations                         ✅  (novo)
    DELETE /tickets/:id/relations/:relationId             ✅  (novo)
    GET    /tickets/:id/timeline                          ✅  (novo) linha do tempo de eventos
    GET    /tickets/:id/checklist                         ✅  (novo)
    POST   /tickets/:id/checklist                         ✅  (novo)
    PATCH  /tickets/:id/checklist/:itemId                 ✅  (novo)
    DELETE /tickets/:id/checklist/:itemId                 ✅  (novo)
    GET    /tickets/:id/time                              ✅  (novo) lançamentos de horas
    POST   /tickets/:id/time                              ✅  (novo)
    DELETE /tickets/:id/time/:entryId                     ✅  (novo)

  /webhooks                 ← sem autenticação JWT
    POST   /whatsapp                                      ✅  HMAC-SHA256 verificado (Meta Cloud API)
    POST   /instagram                                     ✅  x-hub-signature-256 verificado
    POST   /email                                         ✅  Resend inbound webhook

  ── Módulos adicionais completos (novo) ────────────────────────────────────
  /notifications            GET lista + PATCH marcar lida + DELETE
  /calls                    POST token Twilio Voice + GET status
  /search                   GET busca global (conversas, tickets, contatos)
  /portal                   Rotas do portal do cliente (login, tickets)
  /integrations/redmine     GET+POST vínculo ticket ↔ issue Redmine
  /super-admin/metrics      GET métricas de uso global (super admin)
```

### Padrão de resposta da API

```typescript
// Sucesso
{
  "success": true,
  "data": { ... },
  "meta": { "page": 1, "total": 142, "per_page": 20 }
}

// Erro
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Campo email é obrigatório",
    "details": [{ "field": "email", "message": "Required" }]
  }
}
```

---

## 7. REALTIME COM SOCKET.IO

### Eventos do servidor → cliente

```typescript
// Nova mensagem chega (WhatsApp, Instagram etc.)
socket.emit('conversation:message', { conversationId, message })

// Conversa atribuída a um agente
socket.emit('conversation:assigned', { conversationId, agentId })

// Status da conversa mudou
socket.emit('conversation:status', { conversationId, status })

// Cliente está digitando (via webchat)
socket.emit('conversation:typing', { conversationId })

// Novo ticket criado
socket.emit('ticket:created', { ticket })

// Ticket atualizado
socket.emit('ticket:updated', { ticketId, changes })
```

### Rooms do Socket.io

```
tenant:{tenantId}           ← todos os agentes do tenant
agent:{userId}              ← notificações individuais
conversation:{id}           ← agentes dentro de uma conversa
```

---

## 8. ESTRUTURA DE PASTAS

```
ziradesk/
├── apps/
│   ├── api/                         ← Backend Fastify
│   │   ├── src/
│   │   │   ├── config/
│   │   │   │   ├── database.ts
│   │   │   │   ├── env.ts
│   │   │   │   ├── logger.ts
│   │   │   │   └── redis.ts
│   │   │   ├── database/
│   │   │   │   └── seeds/
│   │   │   │       ├── closeConfig.seed.ts
│   │   │   │       ├── holidays.seed.ts
│   │   │   │       └── quickReplies.seed.ts
│   │   │   ├── jobs/                ← BullMQ workers
│   │   │   │   ├── cleanup-csat.job.ts
│   │   │   │   ├── inactivity.job.ts
│   │   │   │   ├── knowledge-index.job.ts
│   │   │   │   ├── presence-cleanup.job.ts
│   │   │   │   ├── process-pending-queue.job.ts
│   │   │   │   ├── queue.ts
│   │   │   │   ├── send-message.job.ts
│   │   │   │   ├── waiting-expiry.job.ts   ← expira conversas waiting sem resposta
│   │   │   │   └── index.ts
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts          ← verifica JWT
│   │   │   │   ├── language.ts      ← Accept-Language para i18n
│   │   │   │   ├── meta-signature.ts← valida x-hub-signature-256
│   │   │   │   ├── rbac.ts          ← requirePermission / requireAnyPermission
│   │   │   │   ├── tenant.ts        ← resolve schema por subdomínio
│   │   │   │   ├── tenantSchemaFromJwt.ts ← injeta schemaName no JWT
│   │   │   │   └── index.ts
│   │   │   ├── modules/
│   │   │   │   ├── admin/
│   │   │   │   │   ├── ai/
│   │   │   │   │   ├── auto-assign/
│   │   │   │   │   ├── bot/
│   │   │   │   │   ├── business-hours/
│   │   │   │   │   ├── channels/
│   │   │   │   │   ├── close-config/
│   │   │   │   │   ├── conversation-tags/
│   │   │   │   │   ├── onboarding/
│   │   │   │   │   ├── pause-reasons/
│   │   │   │   │   ├── quick-replies/
│   │   │   │   │   ├── redmine/
│   │   │   │   │   ├── settings/
│   │   │   │   │   ├── skills/
│   │   │   │   │   ├── smtp/
│   │   │   │   │   ├── stats/
│   │   │   │   │   ├── templates/   ← templates WhatsApp + sync Meta
│   │   │   │   │   ├── ticket-types/
│   │   │   │   │   ├── users/
│   │   │   │   │   ├── webhooks/    ← webhooks de saída (outbound)
│   │   │   │   │   └── index.ts
│   │   │   │   ├── ai/
│   │   │   │   │   ├── ai.service.ts
│   │   │   │   │   └── ingest.service.ts
│   │   │   │   ├── auth/
│   │   │   │   │   ├── auth.routes.ts
│   │   │   │   │   ├── auth.schema.ts
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   └── profile.routes.ts
│   │   │   │   ├── calls/           ← Twilio Voice
│   │   │   │   ├── crm/
│   │   │   │   │   ├── contacts/
│   │   │   │   │   ├── organizations/
│   │   │   │   │   ├── crm.infrastructure.ts
│   │   │   │   │   └── index.ts
│   │   │   │   ├── integrations/
│   │   │   │   │   └── redmine/
│   │   │   │   ├── notifications/
│   │   │   │   ├── omnichannel/
│   │   │   │   │   ├── conversations/
│   │   │   │   │   │   ├── auto-assign.service.ts
│   │   │   │   │   │   ├── conversations.routes.ts
│   │   │   │   │   │   ├── conversations.schema.ts
│   │   │   │   │   │   ├── conversations.service.ts
│   │   │   │   │   │   ├── csat.infrastructure.ts
│   │   │   │   │   │   ├── csat.service.ts
│   │   │   │   │   │   ├── protocols.ts
│   │   │   │   │   │   ├── socket-payload.ts
│   │   │   │   │   │   └── index.ts
│   │   │   │   │   ├── history/
│   │   │   │   │   ├── media/
│   │   │   │   │   ├── metrics/
│   │   │   │   │   ├── active-outbound.routes.ts  ← envio ativo WhatsApp/email
│   │   │   │   │   ├── availability.routes.ts
│   │   │   │   │   ├── close-config.routes.ts
│   │   │   │   │   ├── goals.routes.ts
│   │   │   │   │   ├── monitor.routes.ts
│   │   │   │   │   ├── monitor.service.ts
│   │   │   │   │   ├── pause.routes.ts
│   │   │   │   │   ├── performance.routes.ts
│   │   │   │   │   ├── queue.routes.ts
│   │   │   │   │   ├── transfer.routes.ts
│   │   │   │   │   └── index.ts
│   │   │   │   ├── portal/          ← portal do cliente
│   │   │   │   ├── search/          ← busca global
│   │   │   │   ├── super-admin/
│   │   │   │   │   ├── metrics/
│   │   │   │   │   ├── plans/
│   │   │   │   │   ├── tenants/
│   │   │   │   │   └── index.ts
│   │   │   │   ├── tickets/
│   │   │   │   │   ├── tickets.routes.ts
│   │   │   │   │   ├── tickets-metrics.routes.ts
│   │   │   │   │   ├── tickets.schema.ts
│   │   │   │   │   ├── tickets.service.ts
│   │   │   │   │   └── index.ts
│   │   │   │   └── webhooks/        ← handlers sem auth JWT
│   │   │   │       ├── whatsapp.webhook.ts  ← Meta Cloud API
│   │   │   │       ├── instagram.webhook.ts
│   │   │   │       ├── email.webhook.ts     ← Resend inbound
│   │   │   │       └── index.ts
│   │   │   ├── scripts/
│   │   │   ├── services/
│   │   │   │   ├── email.service.ts
│   │   │   │   └── webhook-dispatcher.ts
│   │   │   ├── socket/
│   │   │   │   └── index.ts
│   │   │   ├── utils/
│   │   │   │   ├── crypto.ts        ← AES-256 encrypt/decrypt credenciais
│   │   │   │   └── phone.ts
│   │   │   └── server.ts
│   │   └── package.json
│   │
│   └── web/                         ← Frontend React
│       ├── src/
│       │   ├── App.tsx
│       │   ├── main.tsx
│       │   ├── i18n.ts
│       │   ├── index.css
│       │   ├── components/
│       │   │   ├── admin/           (AddChannelModal, EditChannelModal, EditUserModal, InviteUserModal, ResetPasswordModal)
│       │   │   ├── crm/             (ContactCard, OrganizationCard, modais CRUD, CrmSearchField...)
│       │   │   ├── layout/          (BrandLogo, PageShell)
│       │   │   ├── omnichannel/     (ChatArea, ConversationList, InfoPanel, modais, AudioPlayer...)
│       │   │   ├── onboarding/      (OnboardingChecklist)
│       │   │   ├── portal/          (PortalGuard, PortalUserMenu)
│       │   │   ├── super-admin/     (CreatePlanModal, CreateTenantModal)
│       │   │   ├── tickets/         (TicketCard, TicketComments, ChecklistSection, TimeTrackingSection...)
│       │   │   └── ui/              ← design system (Button, Input, Modal, Toaster...)
│       │   ├── hooks/
│       │   │   ├── useAgentStatus.ts
│       │   │   ├── useAuth.ts
│       │   │   ├── useDebounce.ts
│       │   │   ├── useFFmpeg.ts
│       │   │   ├── useNotification.ts
│       │   │   ├── usePermission.ts
│       │   │   ├── usePortalUser.ts
│       │   │   ├── useTenant.ts
│       │   │   └── useTwilioCall.ts
│       │   ├── layouts/
│       │   │   ├── AdminLayout.tsx
│       │   │   ├── AuthLayout.tsx
│       │   │   ├── PortalLayout.tsx
│       │   │   ├── SuperAdminLayout.tsx
│       │   │   └── TenantLayout.tsx
│       │   ├── lib/
│       │   │   ├── i18n.ts
│       │   │   └── phone.ts
│       │   ├── locales/             ← pt-BR | en-US | es
│       │   │   └── {lang}/          (admin, auth, common, crm, omnichannel, portal, tickets)
│       │   ├── pages/
│       │   │   ├── admin/           (AIAgent, AttendanceRules, AutoAssign, BotMenu, BusinessHours,
│       │   │   │                     Channels, CloseConfig, ConversationTags, Integrations,
│       │   │   │                     PauseReasons, QuickReplies, Roles, Settings, Skills,
│       │   │   │                     Templates, TicketTypes, Users, Webhooks)
│       │   │   ├── auth/            (ForgotPassword, Login)
│       │   │   ├── crm/             (Contacts, Organizations)
│       │   │   ├── omnichannel/     (Conversations, GoalsConfig, History, Metrics, Performance, Queue)
│       │   │   ├── portal/          (PortalCreateTicket, PortalDashboard, PortalLogin,
│       │   │   │                     PortalTicketDetail, PortalTickets)
│       │   │   ├── profile/         (Profile)
│       │   │   ├── settings/        (Upgrade)
│       │   │   ├── super-admin/     (Dashboard, Plans, TenantDetail, Tenants)
│       │   │   ├── tickets/         (CreateTicket, TicketDetail, Tickets)
│       │   │   ├── tv/              (TVDashboard)
│       │   │   └── NotFound.tsx
│       │   ├── references/          ← protótipos HTML legados; não são fonte de padrão visual
│       │   │   ├── Clientes.html
│       │   │   └── omnichannel_chat.html
│       │   ├── router/
│       │   │   └── ProtectedRoute.tsx
│       │   ├── services/
│       │   │   ├── api.ts           ← axios com interceptor de refresh
│       │   │   └── socket.ts        ← cliente Socket.io
│       │   ├── stores/
│       │   │   ├── auth.store.ts
│       │   │   ├── notification.store.ts
│       │   │   └── toast.store.ts
│       │   ├── styles/
│       │   │   └── tokens.css       ← tokens CSS (Seção 3.2)
│       │   └── utils/
│       │       ├── conversationNotifications.ts
│       │       ├── markdown.ts
│       │       └── sla.ts
│       └── package.json
│
├── packages/
│   └── shared/                      ← tipos TypeScript compartilhados (Role, Permission, ROLE_PERMISSIONS)
│
├── docker-compose.yml
├── .env.example
└── package.json                     ← monorepo com pnpm workspaces
```

---

## 9. PLANO DE DESENVOLVIMENTO — SPRINTS

### Sprint 0 — Fundação (3-5 dias) ✅ concluído
- [ ] **Ler Seção 3 (Design System) por completo — pré-requisito antes de qualquer trabalho de UI**
- [ ] **Extrair tokens da Seção 3.2 para `apps/web/src/styles/tokens.css`**
- [ ] **Componentizar topbar, nav-rail e theme toggle (Seção 3.5 + 3.9) como base reutilizável**
- [ ] Setup monorepo com pnpm workspaces
- [ ] Docker Compose (postgres, redis)
- [ ] Configurar Prisma + schema public
- [ ] Sistema de criação automática de schema ao cadastrar tenant
- [ ] Autenticação JWT (login, refresh, logout)
- [ ] Middleware de tenant por subdomínio
- [ ] RBAC básico (super_admin, owner, admin, agent)
- [ ] CI/CD no GitHub Actions
- [ ] Deploy inicial na VPS Contabo

### Sprint 1 — Super Admin (2-3 dias) ⚠️ ~70% (Super Admin funcional, pendências pontuais)
- [ ] CRUD de planos
- [ ] CRUD de tenants
- [ ] Ativar/suspender tenant
- [ ] Dashboard com métricas globais
- [ ] Tela de Super Admin (frontend)

### Sprint 2 — Admin do Tenant (3-4 dias) ⚠️ ~50% (RBAC + Users OK; Channels/Settings parcial)
- [ ] Configurações da empresa
- [ ] Convite e gestão de usuários
- [ ] Definição de roles
- [ ] Cadastro de canais (WhatsApp, Instagram, Email)
- [ ] Tela de Admin (frontend)

### Sprint 3 — CRM (4-5 dias) ✅ concluído
- [x] Backend e frontend completos
- [x] 17 componentes de CRM entregues
- [x] CRUD de organizações e contatos com validação de unicidade por tenant

### Sprint 4 — Tickets (3-4 dias) ✅ concluído
- [x] CRUD de tickets
- [x] Comentários, anexos, checklist e time tracking
- [x] Relações e exportação CSV com BOM UTF-8

### Sprint 5 — Omnichannel (7-10 dias) ✅ ~90% (gaps: Instagram/Email outbound)
- [ ] Integração WhatsApp (Evolution API)
- [ ] Integração Instagram DM (Meta Graph API)
- [ ] Integração Email (SMTP inbound via Resend)
- [ ] Webhooks para receber mensagens
- [ ] Fila de mensagens com BullMQ
- [ ] Socket.io para tempo real
- [ ] Chat UI → converter HTML criado para React ✓
- [ ] Atribuição, transferência, resolução

### Sprint 6 — Polimento MVP (3-4 dias) ⚠️ ~70% (notificações OK; testes E2E ausentes)
- [ ] Notificações in-app
- [ ] Busca global
- [ ] Onboarding do novo tenant
- [ ] Página de planos e upgrade
- [ ] Testes E2E das flows críticas
- [ ] Documentação de deploy

### Sprint de Estabilização ✅ concluído
- [x] Storage abstraction com suporte a R2
- [x] Testes de integração (78 testes em 9 módulos)
- [x] CI gate com testes obrigatórios antes de deploy
- [x] Workflow dedicado de deploy para VPS Contabo

**Total estimado: 25-35 dias de desenvolvimento focado**

---

## 10. SEGURANÇA E LGPD

### Medidas obrigatórias no MVP
- Senhas com bcrypt (custo 12)
- JWT com expiração curta (15min) + refresh token (7 dias) em httpOnly cookie
- Rate limiting por IP e por tenant
- Credenciais de canais criptografadas no banco (AES-256)
- Audit log de todas as alterações em dados de organizações e contatos
- HTTPS obrigatório (Cloudflare)
- Validação de input em todas as rotas com Zod
- Sanitização para prevenir SQL Injection e XSS
- Isolamento total entre schemas (impossível vazar dados entre tenants)

---

## 11. VARIÁVEIS DE AMBIENTE

Fonte de verdade: `apps/api/.env.example`

```env
# Database
DATABASE_URL=postgresql://ziradesk:ziradesk@localhost:5432/ziradesk

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=change-me-jwt-secret-at-least-32-chars
JWT_REFRESH_SECRET=change-me-refresh-secret-at-least-32-chars

# App
PORT=3333
NODE_ENV=development
APP_URL=http://localhost:5173
API_URL=

# Encryption (AES-256 key, exactly 32 chars)
ENCRYPTION_KEY=change-me-encryption-key-32-chars

# WhatsApp (Meta Cloud API — não mais Evolution API)
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_WABA_ID=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_VERIFY_TOKEN=
META_APP_SECRET=

# Twilio Voice
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_TWIML_APP_SID=
TWILIO_API_KEY=
TWILIO_API_SECRET=

# Cookie
REFRESH_COOKIE_NAME=zd_refresh

# Resend (Inbound + confirmação por e-mail)
RESEND_API_KEY=
RESEND_FROM_EMAIL=
RESEND_WEBHOOK_SECRET=

# Storage (Local/R2)
STORAGE_PROVIDER=local   # local | r2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
R2_PUBLIC_URL=

# Seed (opcional — substitui os padrões do seed)
# SEED_SUPER_ADMIN_EMAIL=admin@ziradesk.com
# SEED_SUPER_ADMIN_PASSWORD=ZiraDesk@2025
# SEED_DEMO_EMAIL=owner@demo.ziradesk.com
```

> **Variáveis removidas/substituídas em relação à doc anterior:**
> - `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` → substituídas por `WHATSAPP_*` + `META_APP_SECRET` (migração para Meta Cloud API)
> - `STORAGE_ENDPOINT` / `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` / `STORAGE_BUCKET` → substituídas por `STORAGE_PROVIDER` + `R2_*` (abstração de storage local/R2)
> - `META_APP_ID` / `META_VERIFY_TOKEN` → unificados em `WHATSAPP_VERIFY_TOKEN`
> - `SENTRY_DSN` → ausente no .env.example atual

---

## 12. DECISÕES TÉCNICAS — JUSTIFICATIVAS

| Decisão | Alternativa | Por quê escolhemos |
|---|---|---|
| Fastify | Express | 2x mais rápido, TypeScript nativo, schema validation |
| Schema-per-tenant | Row-level | Isolamento real, backup individual, sem risco de vazamento |
| BullMQ | Agenda/node-cron | Filas robustas, retry automático, dashboard visual |
| Prisma | Knex/TypeORM | DX superior, migrations automáticas, type-safety completo |
| pnpm workspaces | npm/yarn | Mais rápido, menos disco, melhor para monorepo |
| VPS Contabo + Docker Compose | Railway/Render/Fly.io | Controle total de Nginx, certificados, wildcard de tenants e custos previsiveis |
| Evolution API | Twilio | Open source, sem custo por mensagem no MVP |

---

*Documento vivo — atualizar conforme o projeto evolui.*

---

## 13. DIVERGÊNCIAS DOC ↔ CÓDIGO (auditoria 2026-05-24)

### Divergência 1 — Integração WhatsApp (crítica)
**Doc dizia:** Evolution API (`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`)
**Realidade:** Meta Cloud API direta (`WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `META_APP_SECRET`). A Evolution API foi completamente removida. Todos os webhooks, envio de mensagens, templates e CSAT passam pela Meta Graph API. Impacto: seção de stack tecnológica, Seção 11 e toda documentação de integração de canais estavam incorretas.

### Divergência 2 — Storage (MinIO/S3 documentado mas não implementado)
**Doc dizia:** uploads via MinIO S3-compatible com variáveis `STORAGE_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET`
**Realidade atual:** a divergência foi encerrada na estabilização. O código usa `StorageProvider` com implementações local e Cloudflare R2 (`STORAGE_PROVIDER=local|r2` + `R2_*`) para avatares, logos e anexos de tickets. O contrato do provider cobre `upload`, `delete`, `exists`, `getUrl` e `download`; tickets validam a existência do objeto antes de listar anexos para remover registros órfãos.

### Divergência 3 — Status dos Sprints 3 e 4 vs código real
**Doc marcada (por instrução):** Sprint 3 (CRM) ❌ não iniciado · Sprint 4 (Tickets) ❌ não iniciado
**Realidade no código:** ambos possuem backend completo **e** frontend completo.
- CRM: `pages/crm/Contacts.tsx`, `pages/crm/Organizations.tsx` + 17 componentes em `components/crm/` + backend com CRUD completo de organizations/contacts.
- Tickets: `pages/tickets/Tickets.tsx`, `TicketDetail.tsx`, `CreateTicket.tsx` + backend com CRUD, comentários, anexos, checklist, lançamento de horas, relações, timeline e exportação CSV.
O status ❌ registrado no documento não reflete o código — foi mantido conforme instrução recebida, mas deve ser revisado pelo time antes de usar o doc como referência de progresso.

---

## 14. MÓDULOS ALÉM DO MVP ORIGINAL

Status geral: ✅ funcional

- Calls/Twilio: token, make, twiml, status, recording
- Portal do cliente: login, tickets, forgot/reset password
- Integração Redmine: webhook bidirecional
- Admin SMTP: configuração por tenant com credenciais AES-256
- Admin Templates: CRUD + sync Meta Graph API
- Super Admin Metrics: overview global
- Search: busca global em contacts, conversations e tickets
- Notifications: centro in-app via `audit_log`

---

## 15. AUDITORIA DE PII — OMNICHANNEL E LGPD

### 15.1 Campos com Dados Pessoais (PII)

#### Tabela `conversations`
| Campo | Tipo | Conteúdo PII | Tratamento LGPD |
|-------|------|--------------|-----------------|
| `external_id` | `VARCHAR(255)` | Número WhatsApp do cliente (ex: `+5511999...`) | **Hash SHA-256 irreversível** ao anonimizar |
| `last_message` | `TEXT` | Trecho da última mensagem (pode conter PII) | Substituído por `[mensagem anonimizada por LGPD]` |
| `subject` | `VARCHAR(255)` | Assunto livre (pode conter nome, CPF) | Não anonimizado no ciclo atual — risco residual baixo |
| `metadata` | `JSONB` | Campos livres por canal | Depende do canal; WhatsApp pode incluir nome de perfil |

#### Tabela `messages`
| Campo | Tipo | Conteúdo PII | Tratamento LGPD |
|-------|------|--------------|-----------------|
| `content` | `TEXT` | Corpo da mensagem — PII direto (nome, CPF, endereço) | **Substituído por** `[mensagem anonimizada por LGPD]` |
| `media_url` | `VARCHAR(500)` | URL de mídia (foto, áudio, documento) | **Anulado** (`NULL`) |
| `metadata` | `JSONB` | Metadados do canal (caption, filename) | Marcado com `lgpd_redacted: true` |

### 15.2 Fluxo de Anonimização em Cascata

```
Titular com contact_id                 Titular SEM contact_id
─────────────────────                  ──────────────────────
POST /crm/contacts/:id/lgpd/anonymize  POST /admin/omnichannel/conversations/
                                             anonymize-by-external-id
        │                                          │
        ▼                                          ▼
anonymizeContactForLgpd()              anonymizeByExternalId()
  • contacts: apaga todos os campos     • Localiza convs WHERE external_id = $input
  • conversations: hash external_id         AND contact_id IS NULL
  • messages: redact ALL content        • Hash irreversível: sha256(external_id)
  • call_records: anula telefones       • messages: redact ALL content
  • lgpd_requests: audit trail          • lgpd_requests: audit trail (subject_type='external')
```

### 15.3 Hash SHA-256 — Propriedades Garantidas

- **Função:** `encode(sha256(external_id::bytea), 'hex')` — nativa PostgreSQL 11+, sem extensões.
- **Determinístico:** mesmo `external_id` → mesmo hash (permite correlacionar múltiplas conversas do mesmo número antes de anonimizar).
- **Irreversível:** hash de 256 bits não permite reconstruir o número original.
- **Tamanho:** resultado sempre 64 caracteres hex — cabe na coluna `VARCHAR(255)`.

### 15.4 Job de Retenção Estendido

O job `lgpd-retention.job.ts` processa duas classes de dados a cada ciclo:

1. **Contatos elegíveis** — `contacts` com `lgpd_anonymized_at IS NULL`, sem conversas abertas, com inatividade ≥ `retention_days`.
2. **Conversas órfãs** — `conversations` onde `contact_id IS NULL`, `status = 'closed'`, `external_id` ainda não hasheado, e `last_message_at ≤ NOW() - retention_days`. Agrupa por `external_id` único para gerar um único `lgpd_request` por titular.

### 15.5 Tabela `lgpd_requests` — Tipos Estendidos

| `subject_type` | `request_type` | Uso |
|----------------|----------------|-----|
| `contact` | `access`, `consent_update`, `anonymization` | Titular cadastrado como contato |
| `user` | `access`, `consent_update`, `anonymization` | Usuário do tenant |
| `external` | `external_anonymization` | Titular identificado só por external_id (sem contact_id) |

---

## 16. DÍVIDA TÉCNICA CONHECIDA

- ~~**[CRÍTICO] `SET search_path` sem `LOCAL` em `apps/api/src/middleware/tenantSchemaFromJwt.ts`**~~ — **✅ Resolvido**: requests autenticadas de tenant agora entram em uma transação Prisma request-scoped aberta a partir de `rootPrisma`, executam `SET LOCAL search_path TO "<schema>", public` e usam um proxy Prisma com `AsyncLocalStorage` para direcionar queries tenant-scoped ao transaction client. O fechamento ocorre nos hooks `onSend`/`onError`/`onResponse`; modelos globais (`tenant`, `plan`, `usageSnapshot`, `subscription`, `superAdmin`) seguem sempre pelo Prisma raiz. Coberto por testes de schema ativo, transação aninhada via proxy e concorrência entre tenants diferentes.
- **[MÉDIO] Race conditions transitórias na suite de testes (origem provável: Socket.io ou pool Postgres)** — prioridade elevada após uma segunda instância em arquivo distinto; investigar antes de produção. **Continua aberta.** Instância observada: `tickets.integration.test.ts > POST /api/tickets/:id/accept` falha em ~2 de 3 execuções no mesmo commit, sem alteração de código entre runs (ver sessão de correção de porta em `.env.test`, commit `07cee74`). Essa instância não foi afetada pela correção descrita no item abaixo. Segunda instância observada (sessão do passo 6): `omnichannel.webhooks.integration.test.ts > Webhook com page_id do tenant A não cria dados no tenant B` falhou **uma vez** numa execução da suíte completa e passou na re-execução imediata da suíte inteira e do arquivo isolado, sem alteração de código entre runs — mesmo padrão, arquivo diferente, o que reforça a hipótese de origem compartilhada (Socket.io/pool) e não de um teste específico.
- ~~4 falhas em `omnichannel.webhooks.integration.test.ts` (e-mail inbound, 401) atribuídas a flakiness~~ — **✅ Resolvido pelo commit `90d8f01`; não era flakiness.** A falha era determinística e reprodutível: os testes autenticavam com `Authorization: Bearer <secret>`, mas a rota valida assinatura Svix (`svix-id`/`svix-timestamp`/`svix-signature` em `email.webhook.ts:185-205`, com `401` em `:510-512`), e `RESEND_WEBHOOK_SECRET` no `.env.test` não tinha formato Svix válido — logo `new Webhook(secret)` sequer construía. O commit introduziu um helper que assina os fixtures com `svix` e corrigiu o segredo para `whsec_...`. Contagem de `it()` no arquivo inalterada (14 antes e depois, sem `.skip`/`.todo`/`.only`), ou seja, os testes foram corrigidos e não desativados. Baseline atual da suíte: **355 testes, 0 falhas**. A contagem saiu de 332 para 335 com `tenant.middleware.integration.test.ts` (4 → 7 casos, commit `afdaf24`), depois 340 no passo 4 (+5 em `omnichannel.webhooks.integration.test.ts`), 350 no passo 5 (+10 com `metrics.integration.test.ts`) e 355 no passo 6 (+5 com `close-config.integration.test.ts`).
- **[BAIXO] Tarefas best-effort ainda não têm fila/drain centralizado em testes** — e-mails, webhooks, CSAT e integrações externas são disparados como tarefas destacadas em alguns fluxos. A sessão atual isolou os disparos de tickets do transaction client fechado, mas a suíte ainda pode registrar warnings de tarefas que terminam após teardown de schemas temporários (`schema ... does not exist`) ou chamadas externas mockadas com credenciais inválidas. Recomenda-se centralizar esse padrão em uma fila/job runner testável com `drain` explícito no teardown.
- Templates: rota `POST /sync` não tem teste E2E (mock de fetch entre processos limitado) — função interna `syncTemplatesFromMeta` tem cobertura
- **[BAIXO] `estimateSize` da lista de mensagens não recalibrado após o agrupamento** — `ChatArea.tsx` virtualiza com `useVirtualizer({ estimateSize: () => 88, measureElement })` a partir de 50 entradas (`shouldVirtualizeMessages`). O agrupamento por remetente reduziu a altura de linha: pela geometria dos estilos, uma linha era ~70px e passou a ~54px quando agrupada (sem cabeçalho nem avatar) e ~80px em início de bloco (com o `marginTop` de respiro). O `88` já superestimava antes e superestima mais agora; `measureElement` corrige a altura real, mas superestimativa com medição dinâmica costuma aparecer como encolhimento da barra de rolagem / deriva de posição na primeira pintura de listas longas. **Não verificado:** nenhuma conversa dos 10 schemas locais chega a 10 mensagens, então o virtualizador nunca é ativado no ambiente atual e o teste não é executável sem semear dados. O valor foi mantido em 88 de propósito — ajustá-lo às cegas trocaria um desalinhamento conhecido por um desconhecido. Reavaliar com uma conversa real de ≥50 mensagens, rolando para cima e carregando mensagens antigas; se houver salto, calibrar `estimateSize` para a média das linhas agrupadas (maioria) em vez do pior caso.
- Vitest emite `close timed out after 10000ms` no encerramento — não afeta resultados, Socket.io não fecha limpo no teardown
- ~~Tipo `Ticket` duplicado entre `apps/web/src/services/api.ts` e `packages/shared/src/types/ticket.ts`~~ — **✅ Resolvido** (commit `4988e1f`: tipo duplicado removido, zero imports confirmados).
- Backend: mensagens de erro (`NotFoundError`, `ForbiddenError`, `ConflictError`, `ValidationError`) hardcoded em PT-BR em todos os módulos da API. `middleware/language.ts` faz parsing de `Accept-Language` e está registrado globalmente, mas só é usado no fluxo de login (`auth.service.ts`, catálogo de 3 chaves). Estender exigiria: lib de i18n na API, refatoração das classes de erro (hoje redefinidas localmente em 20+ arquivos, cada uma com o template PT-BR embutido no construtor), e extensão do middleware para os demais módulos. Escopo: sprint dedicada.
- ~~`ensureTicketInfrastructure` usava uma flag booleana global de processo~~ — **✅ Resolvido**: passou a resolver o schema ativo via `SELECT current_schema()` e cachear num `Set<string>` por schema (`tickets.service.ts`), então o retrofit de DDL roda para todos os tenants, não só o primeiro acessado após o boot.
- ~~Senha padrão do Super Admin hardcoded (`ZiraDesk@2025`) como fallback no seed~~ — **✅ Resolvido**: `prisma/seed.ts` agora falha (`throw`) se `SEED_SUPER_ADMIN_PASSWORD` não estiver definida, sem fallback.
- ~~Índices ausentes em `tickets.status`/`assigned_to`/`created_at`~~ — **✅ Resolvido**: adicionados em `createTenantTables` (tenants novos) e via `apps/api/src/scripts/migrate-ticket-indexes.ts` (tenants existentes).
- Bundle do frontend sem lazy-loading por rota: `apps/web/vite.config.ts` faz code-splitting só dos vendors (`manualChunks`); o chunk da aplicação (rotas/páginas/componentes próprios) fica em um único arquivo de ~3.4MB (950KB gzip), acima do `chunkSizeWarningLimit: 600`. Faltaria `React.lazy()`/`import()` dinâmico por rota em `App.tsx`. Não bloqueia funcionalidade, afeta TTI do carregamento inicial.
- CI (`.github/workflows/ci.yml`) só roda testes/type-check de `@ziradesk/api` — mudanças em `apps/web` não são validadas automaticamente antes do deploy (nem `pnpm --filter @ziradesk/web type-check`, nem testes de frontend rodam como gate de CI).
- **[MÉDIO] Segundo motor de roteamento sem skills** — `pickNextAgentForDepartment` em `tickets.service.ts:288` (usado em `:950` e `:1845`) faz round-robin só por departamento, sem nenhuma consciência de skills. A migração para AND logic (Fase 2) cobriu só o roteamento de conversas/omnichannel; tickets seguem com o motor antigo. Decidir se tickets devem migrar para o mesmo motor de skills ou se é intencional manter dois modelos de roteamento distintos.
- **[MÉDIO] Contagem de capacidade ignora conversas em `waiting`** — o limite de atendimentos simultâneos por agente **funciona ponta a ponta**: configura em dois níveis (global em `tenants.settings->>'max_conversations_per_agent'`, via Admin › Regras de Atendimento; por agente em `agent_assignments.max_conversations`, via Admin › Usuários), resolve por `COALESCE(aa.max_conversations, <global>, 999999)` — `NULL` nos dois = ilimitado —, e as 5 queries de seleção de candidato em `resolveAgentForAssignment` (`auto-assign.service.ts`) aplicam `active_conversations < COALESCE(...)`. Saturação é **hard cap**: nenhum agente elegível → conversa fica em fila com `routing_started_at`, e `conversation-routing-retry.job.ts` re-tenta a cada 30s em FIFO. Pausa é honrada (o flip de `is_available` em `syncAgentAvailability` é guardado por `AND status = 'online'`, e pausa grava `status='paused'`). **O achado é o predicado da contagem:** os 6 escritores do contador usam `COUNT(*) WHERE assigned_to = X AND status = 'open'` — consistentes entre si, mas **`waiting` conta zero**. Um agente pode acumular N conversas em espera (outbound enviado, aguardando o cliente) **e** o teto cheio de `open` por cima. Agravante: `findBestAvailableAgent` (`whatsapp.webhook.ts`), usado quando o cliente responde e a conversa em `waiting` volta, **não tem a cláusula de capacidade** — devolve ao agente mesmo acima do teto. Decisão de produto latente: o limite mede "carga total do agente" (então `waiting` deve contar) ou "conversas exigindo atenção agora" (então `waiting` não conta, mas `findBestAvailableAgent` precisa da cláusula para não estourar no retorno). Atribuição manual (`assignConversation`/`acceptFromQueue`) também não capa — discutível se deveria, sendo override humano.
- **[MÉDIO] Tickets são invisíveis à capacidade do agente** — capacidade é `COUNT(conversations WHERE status='open')`, e ticket não é conversation: um agente afogado em tickets tem carga **0** para o auto-assign de conversas. A herança do limite pelo lado dos tickets é apenas indireta, via `is_available = false` que `syncAgentAvailability` grava ao saturar — frágil, porque só dispara se houver limite configurado e nunca por movimento de ticket. E `pickNextAgentForDepartment` (`tickets.service.ts:296`) espelha o bloco de presença de `resolveAgentForAssignment` — o comentário no código diz isso explicitamente — mas **omite** a cláusula de `active_conversations`. Efeito líquido: agente saturado de conversas para de receber tickets (colateral provavelmente não intencional), e agente saturado de tickets segue recebendo conversas. Decisão de arquitetura, irmã do item "Segundo motor de roteamento sem skills" acima e provavelmente a ser resolvida junto: capacidade é um conceito único (contador soma tickets + conversas) ou dois conceitos separados (cada motor com seu próprio teto)?
- **[BAIXO] Zero cobertura de teste da regra de capacidade** — os 7 casos de `auto-assign.integration.test.ts` cobrem skill, departamento, timeout de fallback e presença, mas nenhum exercita `active_conversations < COALESCE(max_conversations, ...)`. O helper de seed grava `active_conversations = 0` fixo e nunca grava `max_conversations`. A única regra que protege o agente de sobrecarga está sem rede, num motor que já foi mexido recentemente — candidato a teste **antes** de qualquer mudança nos dois itens acima, para fixar o comportamento atual primeiro. Nota para quem for testar manualmente: nos tenants locais `auto_assign` está ausente do `settings` de todos, e `autoAssignConversation` retorna `null` na primeira linha quando a flag não é `true` — sem ligá-la, nada é atribuído e o limite parece inerte por outro motivo.
- ~~**[BAIXO] `.env.test` aponta para porta Postgres errada**~~ — **✅ Resolvido**: arquivo de teste versionado já aponta para `localhost:5433`; nesta sessão também foi atualizado para usar `RESEND_WEBHOOK_SECRET` em formato Svix (`whsec_...`), permitindo validar os webhooks de e-mail com assinatura real.
- **[BAIXO] Constantes de encerramento de sistema moram em módulo de seed** — `SYSTEM_CLOSE_TYPES`/`SYSTEM_CLOSE_OUTCOMES`, `SYSTEM_CLOSE_TYPE_ID`, `SYSTEM_OUTCOME_IDS` e `buildSystemClosureReason()` estão em `apps/api/src/database/seeds/closeConfig.seed.ts` e são importados **em tempo de execução** por `inactivity.job.ts`, `waiting-expiry.job.ts`, `cleanup-csat.job.ts`, `monitor.service.ts`, `outbound-failure.service.ts`, `queue-notifications.service.ts` e `whatsapp.webhook.ts`. A fonte única já está garantida — seed, migration (`migrate-close-config-system.ts`) e os 9 caminhos de escrita leem as mesmas constantes, então **não há risco de divergência**; isto é organização, não correção. Ainda assim, código de runtime depender de um módulo de seed é acoplamento estranho. Candidato a mover para `modules/omnichannel/conversations/system-closure.ts`, com o seed passando a importar de lá, em passo dedicado.
- **[MÉDIO] `total.resolved` e `getVolumeByPeriod.resolved` são métricas de coorte, não de fluxo** — as duas são `COUNT(*) FILTER (WHERE status='closed')` dentro de um recorte por `created_at` (`metrics.service.ts`), ou seja, medem "abertas no período que hoje estão fechadas", não "encerradas no período". Alimentam a taxa de resolução em `Metrics.tsx` e o KPI "resolvidos" da Home. **Deliberadamente não migradas** no passo 5, que trocou o eixo só de `byType`/`byOutcome`/`tma`: trocar o eixo destas mudaria o número que o cliente já lê hoje. Decisão de produto pendente — painel novo de throughput de encerramento vs. manter a leitura por coorte. Misturar as duas semânticas num só número é o erro a evitar.
- **[MÉDIO] Métricas de CSAT no eixo de abertura** — `csat.*` do overview, `getCsatDistribution` e `getCsatOverTime` filtram por `created_at`, mas CSAT só existe **depois** do encerramento. Um CSAT respondido hoje sobre conversa aberta há 40 dias não aparece no filtro "últimos 7 dias"; no `getCsatOverTime` a nota ainda é plotada na data de **abertura**, porque a série agrupa por `DATE(c.created_at)`. O eixo natural é `csat_responded_at`, que existe na tabela e é populado por `csat.service.ts` e pelo webhook, mas não é lido por nenhuma métrica. Fora do escopo do passo 5 (que se limitou às 3 métricas de encerramento); `getCsatOverTime` exige mudar também o `GROUP BY` da série, então não é one-liner.
- **[MÉDIO] `assignConversation` reabre conversa encerrada sem guarda de status** — `conversations.service.ts` (`assignConversation`) faz `status='open'` incondicionalmente: o `SELECT` prévio só busca `id, assigned_to`, e o `UPDATE` não limpa `close_type_id`/`close_outcome_id`/`closure_reason`. Atribuir uma conversa encerrada a um agente a reabre com a classificação de encerramento pendurada. Compare com `acceptFromQueue` (que exige `humanQueueEligibilityCondition()`, com `status='open'`) e com o requeue de `socket/index.ts` (`AND status IN ('open','waiting')`). **Sobrevive ao passo 6**, que remove só o botão de reabrir. Depois do alinhamento de predicados do passo 5 ele não corrompe mais métrica — a conversa fica fora de `byType` e de `byOutcome` —, mas ainda produz estado incoerente no banco. Candidato a guarda de status na atribuição ou limpeza de `close_*` na reabertura.
- **[BAIXO] 16 chaves i18n órfãs no bloco `resolve.*` do namespace omnichannel** — `title`, `subtitle`, `closeTypeLabel`, `closeOutcomeLabel`, `csatLabel`, `commentLabel`, `commentPlaceholder`, `closeConfigEmpty`, `confirm`, `resolved`, `resolvedBanner` e `ratings.1`–`ratings.5` não têm nenhum consumidor nos 3 locales — são resíduo da migração do modal de encerramento para o namespace `closeModal.*` (13 chaves, todas vivas). Sobraram vivas no bloco apenas `resolve.cancel` (4 consumidores em `ActiveOutboundModal`/`CreateConversationModal`); `reopen`/`reopenError` saíram no passo 6 junto com o botão. Não há acesso dinâmico via `t(\`resolve.…\`)` em lugar nenhum, então a remoção é segura — ficou fora do passo 6 só para não misturar escopos no diff. Atenção ao remover: `resolvedBanner` tem homônimo **vivo** em `tickets.status.resolvedBanner`, namespace diferente.
- **[BAIXO] Script `lint` quebrado nos dois pacotes** — `apps/web` e `apps/api` declaram `"lint": "eslint src ..."`, mas o repo não tem nenhum `eslint.config.*` nem `.eslintrc.*` (nem no histórico do git). Com ESLint 10 instalado, `pnpm --filter <pkg> lint` falha com `ESLint couldn't find an eslint.config.(js|mjs|cjs) file` antes de analisar qualquer arquivo. Na prática a validação de código hoje é só `type-check`. Criar o flat config (ou remover os scripts) é pré-requisito para qualquer gate de lint no CI.
- **[BAIXO] Encerramentos automáticos são invisíveis na aba "Encerrados"** — a aba e o badge de contagem (`conversations.service.ts`, `buildConversationFilters` e a query de contadores) filtram por `closed_by_user_id = <userId>`. Como o passo 3 deixa `closed_by_user_id` NULL nos fechamentos de sistema (decisão consciente, para não vazar usuário fantasma para `byAgent` e listas de agente), conversas encerradas por inatividade, expiração, falha de entrega ou CSAT **não aparecem para nenhum agente** nessa aba nem são contadas no badge. Não afeta métricas — `getByAgent` agrupa por `assigned_to`, não por `closed_by_user_id`. Decidir se a aba deve ganhar um filtro de "encerradas pelo sistema" ou se a invisibilidade é aceitável.
- **[MÉDIO] Caminho de gravação do score de CSAT sem cobertura de integração** — a transição `csat_score` + `csat_stage='waiting_comment'` (`whatsapp.webhook.ts`, dentro de `if (shouldHandleCsat)`) **não é testável no harness atual**. O `vi.stubGlobal('fetch', ...)` de `src/test/vitest.setup.ts` roda via `setupFiles`, ou seja, no worker do Vitest — mas o servidor Fastify sob teste é iniciado por `bootstrapIntegrationSuite()` no processo do `globalSetup`, onde o stub não existe. A chamada ao Graph API sai de verdade, volta `401`, e o webhook retorna no `if (!csatReplySent)` **antes** do `UPDATE` do score. Limitação pré-existente do harness, não introduzida pelo passo 4: o teste de regressão daquele passo asserta os invariantes alcançáveis (`csat_stage` continua `'sent'`, mensagem permanece na conversa velha, nenhuma conversa nova criada) — o que prova o que importa para aquela correção, mas deixa a escrita do score sem rede. Fechar exigiria injetar um cliente HTTP mockável no servidor de teste ou tornar o host do Graph configurável por env (hoje `https://graph.facebook.com/${env.META_GRAPH_VERSION}/...` é literal em `csat.service.ts:115`). Afeta qualquer teste futuro que dependa de envio bem-sucedido pelo WhatsApp.
- **[BAIXO] Ramo morto `currentBotStage === 'choice'` no webhook WhatsApp** — a condição de `isWaitingForHumanQueue` (`whatsapp.webhook.ts`) testa `bot_stage === 'choice'`, mas esse valor nunca é gravado: `bot.service.ts` só escreve `'waiting_choice'` e `'done'`, e `monitor.service.ts` escreve `'transferred'`. Na prática `isWaitingForHumanQueue` só é alcançável pelo ramo legado (`queue_entered_at` preenchido com `bot_stage` nulo). Não corrigido no passo 4 por ser anterior a ele e por alterar roteamento de fila — mudar a condição muda quem entra em `canProcessBot`. Passo dedicado, com teste do ramo legado antes.
- **[BAIXO] Tipos `AgentSkill`/`AgentWithSkills` desatualizados em `services/api.ts`** — descrevem o formato legado (`bot_option_id`, `label`, `tag`) usado por `MonitorData.agents`, mas `monitor.service.ts:103-154` já retorna o payload v2 (join em `agent_skills`/`skills`). O tipo do frontend não reflete o payload real da API. Candidato à Fase 4b parte 2.

---

## 17. PADRÕES DE FRONTEND — BOAS PRÁTICAS OBRIGATÓRIAS

### 17.1 Tabelas com paginação server-side

Toda tabela com paginação server-side (filtros e `page` enviados à API)
**deve** implementar ordenação também no backend — nunca no frontend.

**Regra:** sort no frontend afeta apenas a página atual, criando
comportamento enganoso para o usuário (ex: ordenar por "Data" em uma
tabela de 64 registros com 25 por página ordena só os 25 visíveis).

**Implementação obrigatória:**
- Backend: adicionar `sort_by` (enum de colunas permitidas via allowlist)
  e `sort_order` (`asc | desc`) ao schema Zod da rota
- Backend: usar `SORT_COLUMN_MAP` (allowlist) — nunca interpolar
  o valor do usuário diretamente no SQL
- Backend: `ORDER BY` com `NULLS LAST` / `NULLS FIRST` conforme direção
- Frontend: estados `sortBy` e `sortOrder` incluídos no `queryKey`
  do TanStack Query para disparar refetch ao mudar ordenação
- Frontend: `placeholderData: keepPreviousData` obrigatório na query
  para evitar flash/piscada da tabela durante o refetch

**Colunas não recomendadas para sort:**
- Expressões JSONB (ex: `metadata->>'campo'`) sem índice de suporte
- Campos com alto percentual de valores `NULL` sem índice parcial

**Referência de implementação:** `history.service.ts` + `History.tsx`

---

### 17.2 TanStack Query v5 — padrões obrigatórios

| Situação | Padrão obrigatório |
|---|---|
| Lista com filtros ou sort | `placeholderData: keepPreviousData` |
| Dados que atualizam em tempo real (status `running`) | `refetchInterval` condicional + Socket.io para updates incrementais |
| Dados raramente alterados (planos, configurações) | `staleTime: 60_000` mínimo |
| Query dependente de outra | `enabled: Boolean(dependência)` |
| Mutação que invalida lista | `queryClient.invalidateQueries({ queryKey: ['chave-da-lista'] })` |

**Nunca** usar `staleTime: 0` (default) em listas paginadas — causa
refetch desnecessário a cada window focus.

---

### 17.3 Exportação de arquivos

| Formato | Onde gerar | Biblioteca |
|---|---|---|
| CSV | Backend | Manual (padrão `csvField()` + separador `;` + BOM `﻿`) |
| PDF simples (relatório) | Backend | PDFKit |
| PDF com captura de tela | ❌ Não usar | `html2canvas` + `jspdf` descartados — qualidade inadequada para produção |
| Excel | Backend | `xlsx` (já instalado em `apps/api`) |

**Padrão CSV do projeto:**
- Separador: `;` (ponto-e-vírgula — compatível com Excel Brasil)
- BOM: `﻿` prefixado pela route handler
- Escaping: `"${value.replace(/"/g, '""')}"` (RFC 4180)
- Sem biblioteca externa — geração manual com helper local `csvField()`
- Referência: `history.service.ts` → `exportHistoryCsv()`

**Padrão PDF do projeto:**
- Biblioteca: `pdfkit` (backend)
- Paleta: tema claro (`#FFFFFF` fundo, `#14171C` texto, `#00A88C` primário)
- Logo: `apps/web/public/icon-192.png` (ZiraDesk) + logo do tenant se existir
- Rodapé: via evento `pageAdded` + chamada manual antes de `doc.end()`
- Truncamento de texto longo: `truncate(text, maxChars)` manual —
  `ellipsis: true` do PDFKit não é confiável
- Referência: `campaign-pdf.service.ts`
