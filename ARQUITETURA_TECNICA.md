# ZiraDesk — Arquitetura Técnica do MVP
> Documento gerado para orientar o desenvolvimento do sistema multitenant SaaS
> **Inclui design system de referência (Seção 3) — TODA tela nova DEVE seguir esses tokens.**

---

## 1. VISÃO GERAL

Sistema SaaS multitenant de CRM com módulos de omnichannel, gestão de clientes, tickets e administração. Modelo de isolamento: **Schema-per-tenant no PostgreSQL**.

### Módulos do MVP
- Super Admin (gestão de tenants e planos)
- Painel Admin do Tenant (configurações, usuários, integrações)
- CRM (perfil 360 de clientes)
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
Deploy:       Railway.app (backend + banco + redis)
CDN/Storage:  Cloudflare R2
DNS:          Cloudflare (subdomínios wildcard *.ziradesk.com.br)
CI/CD:        GitHub Actions
Monitoramento: Sentry (erros) + Umami (analytics)
```

---

## 3. DESIGN SYSTEM — REFERÊNCIA OBRIGATÓRIA

> As telas `Omnichannel - Modais.html` e `Clientes.html` são a **referência canônica de UI**. Toda nova página DEVE reutilizar esses tokens, componentes e padrões. Não inventar paletas, espaçamentos ou tipografia novas.

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

### 3.12 Telas de referência

| Arquivo | Padrões cobertos |
|---|---|
| `Clientes.html` | Lista com tabela densa, filtros (search + chips), segmentos (tabs), paginação, painel de detalhe lateral, hero com avatar grande, KPIs, ações rápidas (`.dact`), timeline |
| `Omnichannel - Modais.html` | Layout de chat 3 colunas (lista + conversa + contato), header de conversa, balões de mensagem, composer com toolbar, modais (Novo atendimento, Transferir, Resolver com CSAT) |

**Ao criar tela nova:** abrir as duas e copiar a estrutura mais próxima como ponto de partida. Não começar do zero.

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
  clients
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
empresa.ziradesk.com.br
    ↓
Middleware extrai "empresa"
    ↓
Busca tenant no schema public
    ↓
Define search_path = tenant_empresa
    ↓
Todas as queries operam no schema correto
```

### Middleware de tenant (pseudocódigo)
```typescript
async function tenantMiddleware(request, reply) {
  const host = request.headers.host // empresa.ziradesk.com.br
  const slug = host.split('.')[0]

  const tenant = await db.public.tenant.findUnique({ where: { slug } })
  if (!tenant) return reply.status(404).send({ error: 'Tenant not found' })
  if (tenant.status !== 'active') return reply.status(402).send({ error: 'Subscription inactive' })

  // Define o schema para essa requisição
  await db.$executeRaw`SET search_path TO "tenant_${slug}"`
  request.tenant = tenant
}
```

---

## 5. MODELO DE BANCO DE DADOS

### Schema PUBLIC (global)

```sql
-- Planos disponíveis
CREATE TABLE plans (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(50) UNIQUE NOT NULL, -- subdomínio
  schema_name VARCHAR(63) UNIQUE NOT NULL, -- tenant_{slug}
  plan_id     UUID REFERENCES plans(id),
  status      VARCHAR(20) DEFAULT 'active', -- active | suspended | cancelled
  trial_ends_at TIMESTAMPTZ,
  settings    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Assinaturas e cobrança
CREATE TABLE subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id),
  plan_id         UUID REFERENCES plans(id),
  status          VARCHAR(20),  -- active | past_due | cancelled
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  payment_gateway VARCHAR(30),  -- 'stripe' | 'pagarme'
  gateway_sub_id  VARCHAR(100),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Super admins (acesso total ao sistema)
CREATE TABLE super_admins (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(100) NOT NULL,
  email        VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
```

### Schema TENANT (replicado por empresa)

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

-- Clientes (CRM)
CREATE TABLE clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type            VARCHAR(20) DEFAULT 'person', -- person | company
  name            VARCHAR(150) NOT NULL,
  email           VARCHAR(255),
  phone           VARCHAR(30),
  document        VARCHAR(20),                  -- CPF ou CNPJ
  website         VARCHAR(255),
  status          VARCHAR(30) DEFAULT 'lead',   -- lead | prospect | client | inactive
  address_street  VARCHAR(200),
  address_city    VARCHAR(100),
  address_state   VARCHAR(2),
  address_zip     VARCHAR(10),
  birth_date      DATE,
  gender          VARCHAR(20),
  occupation      VARCHAR(100),
  income          DECIMAL(12,2),
  segment         VARCHAR(100),
  lead_source     VARCHAR(100),
  responsible_id  UUID REFERENCES users(id),
  tags            TEXT[] DEFAULT '{}',
  custom_fields   JSONB DEFAULT '{}',
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
  client_id     UUID REFERENCES clients(id),
  channel_id    UUID REFERENCES channels(id),
  channel_type  VARCHAR(30) NOT NULL,
  external_id   VARCHAR(255),              -- ID da conversa no canal externo
  status        VARCHAR(20) DEFAULT 'open', -- open | pending | resolved | bot
  assigned_to   UUID REFERENCES users(id),
  subject       VARCHAR(255),
  last_message  TEXT,
  last_message_at TIMESTAMPTZ,
  resolved_at   TIMESTAMPTZ,
  metadata      JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

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
  client_id     UUID REFERENCES clients(id),
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

---

## 6. ARQUITETURA DE API

### Estrutura de rotas

```
/api
  /auth
    POST   /login
    POST   /logout
    POST   /refresh
    POST   /forgot-password
    POST   /reset-password

  /super-admin              ← JWT com role=super_admin
    GET    /tenants
    POST   /tenants
    PATCH  /tenants/:id
    DELETE /tenants/:id
    GET    /tenants/:id/stats
    GET    /plans
    POST   /plans
    PATCH  /plans/:id

  /admin                    ← JWT com role=owner|admin
    GET    /settings
    PATCH  /settings
    GET    /users
    POST   /users/invite
    PATCH  /users/:id
    DELETE /users/:id
    GET    /channels
    POST   /channels
    PATCH  /channels/:id
    DELETE /channels/:id
    GET    /stats/overview

  /crm
    GET    /clients           ← lista com filtros e paginação
    POST   /clients
    GET    /clients/:id
    PATCH  /clients/:id
    DELETE /clients/:id
    GET    /clients/:id/conversations
    GET    /clients/:id/tickets
    GET    /clients/:id/timeline

  /omnichannel
    GET    /conversations     ← lista com filtros
    GET    /conversations/:id
    PATCH  /conversations/:id
    POST   /conversations/:id/assign
    POST   /conversations/:id/resolve
    GET    /conversations/:id/messages
    POST   /conversations/:id/messages
    POST   /conversations/:id/transfer

  /tickets
    GET    /tickets
    POST   /tickets
    GET    /tickets/:id
    PATCH  /tickets/:id
    DELETE /tickets/:id
    GET    /tickets/:id/comments
    POST   /tickets/:id/comments

  /webhooks                 ← sem autenticação JWT
    POST   /whatsapp
    POST   /instagram
    POST   /email
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
│   │   │   │   ├── env.ts
│   │   │   │   └── database.ts
│   │   │   ├── middleware/
│   │   │   │   ├── tenant.ts        ← resolve schema por subdomínio
│   │   │   │   ├── auth.ts          ← verifica JWT
│   │   │   │   └── rbac.ts          ← controle de permissões
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── super-admin/
│   │   │   │   ├── admin/
│   │   │   │   ├── crm/
│   │   │   │   ├── omnichannel/
│   │   │   │   │   ├── channels/
│   │   │   │   │   │   ├── whatsapp.ts
│   │   │   │   │   │   ├── instagram.ts
│   │   │   │   │   │   └── email.ts
│   │   │   │   │   ├── conversations.ts
│   │   │   │   │   └── messages.ts
│   │   │   │   └── tickets/
│   │   │   ├── jobs/                ← BullMQ workers
│   │   │   │   ├── send-message.job.ts
│   │   │   │   ├── sync-channel.job.ts
│   │   │   │   └── send-email.job.ts
│   │   │   ├── socket/
│   │   │   │   └── index.ts
│   │   │   └── server.ts
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   └── package.json
│   │
│   └── web/                         ← Frontend React
│       ├── src/
│       │   ├── layouts/
│       │   │   ├── TenantLayout.tsx
│       │   │   ├── SuperAdminLayout.tsx
│       │   │   └── AuthLayout.tsx
│       │   ├── pages/
│       │   │   ├── auth/
│       │   │   │   ├── Login.tsx
│       │   │   │   └── ForgotPassword.tsx
│       │   │   ├── super-admin/
│       │   │   │   ├── Tenants.tsx
│       │   │   │   └── Plans.tsx
│       │   │   ├── admin/
│       │   │   │   ├── Settings.tsx
│       │   │   │   ├── Users.tsx
│       │   │   │   └── Channels.tsx
│       │   │   ├── crm/
│       │   │   │   ├── Clients.tsx
│       │   │   │   └── ClientProfile.tsx  ← tela já criada ✓
│       │   │   ├── omnichannel/
│       │   │   │   └── Chat.tsx           ← tela já criada ✓
│       │   │   └── tickets/
│       │   │       ├── Tickets.tsx
│       │   │       └── TicketDetail.tsx
│       │   ├── components/
│       │   │   ├── ui/              ← design system (botões, inputs, cards)
│       │   │   ├── crm/
│       │   │   ├── omnichannel/
│       │   │   └── tickets/
│       │   ├── hooks/
│       │   │   ├── useSocket.ts
│       │   │   ├── useTenant.ts
│       │   │   └── useAuth.ts
│       │   ├── stores/
│       │   │   ├── auth.store.ts
│       │   │   └── socket.store.ts
│       │   ├── services/
│       │   │   └── api.ts           ← axios instance com interceptors
│       │   └── main.tsx
│       └── package.json
│
├── packages/
│   └── shared/                      ← tipos TypeScript compartilhados
│       └── src/
│           ├── types/
│           └── schemas/             ← schemas Zod reutilizados
│
├── docker-compose.yml
├── .env.example
└── package.json                     ← monorepo com pnpm workspaces
```

---

## 9. PLANO DE DESENVOLVIMENTO — SPRINTS

### Sprint 0 — Fundação (3-5 dias)
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
- [ ] Deploy inicial no Railway

### Sprint 1 — Super Admin (2-3 dias)
- [ ] CRUD de planos
- [ ] CRUD de tenants
- [ ] Ativar/suspender tenant
- [ ] Dashboard com métricas globais
- [ ] Tela de Super Admin (frontend)

### Sprint 2 — Admin do Tenant (3-4 dias)
- [ ] Configurações da empresa
- [ ] Convite e gestão de usuários
- [ ] Definição de roles
- [ ] Cadastro de canais (WhatsApp, Instagram, Email)
- [ ] Tela de Admin (frontend)

### Sprint 3 — CRM (4-5 dias)
- [ ] CRUD completo de clientes
- [ ] Filtros, busca e paginação
- [ ] Timeline do cliente
- [ ] Tags e campos customizados
- [ ] Tela Perfil do Cliente → converter HTML criado para React ✓
- [ ] Lista de clientes (frontend)

### Sprint 4 — Tickets (3-4 dias)
- [ ] CRUD de tickets
- [ ] Comentários internos e públicos
- [ ] Prioridade, status, categoria
- [ ] Atribuição a agente
- [ ] Notificação realtime de novo ticket
- [ ] Telas de tickets (frontend)

### Sprint 5 — Omnichannel (7-10 dias) ← mais complexo
- [ ] Integração WhatsApp (Evolution API)
- [ ] Integração Instagram DM (Meta Graph API)
- [ ] Integração Email (SMTP inbound via Resend)
- [ ] Webhooks para receber mensagens
- [ ] Fila de mensagens com BullMQ
- [ ] Socket.io para tempo real
- [ ] Chat UI → converter HTML criado para React ✓
- [ ] Atribuição, transferência, resolução

### Sprint 6 — Polimento MVP (3-4 dias)
- [ ] Notificações in-app
- [ ] Busca global
- [ ] Onboarding do novo tenant
- [ ] Página de planos e upgrade
- [ ] Testes E2E das flows críticas
- [ ] Documentação de deploy

**Total estimado: 25-35 dias de desenvolvimento focado**

---

## 10. SEGURANÇA E LGPD

### Medidas obrigatórias no MVP
- Senhas com bcrypt (custo 12)
- JWT com expiração curta (15min) + refresh token (7 dias) em httpOnly cookie
- Rate limiting por IP e por tenant
- Credenciais de canais criptografadas no banco (AES-256)
- Audit log de todas as alterações em dados de clientes
- HTTPS obrigatório (Cloudflare)
- Validação de input em todas as rotas com Zod
- Sanitização para prevenir SQL Injection e XSS
- Isolamento total entre schemas (impossível vazar dados entre tenants)

---

## 11. VARIÁVEIS DE AMBIENTE

```env
# App
NODE_ENV=production
PORT=3333
APP_URL=https://app.ziradesk.com.br
API_URL=https://api.ziradesk.com.br

# Database
DATABASE_URL=postgresql://user:pass@host:5432/ziradesk

# Redis
REDIS_URL=redis://host:6379

# Auth
JWT_SECRET=
JWT_REFRESH_SECRET=
ENCRYPTION_KEY=          # AES-256 para credenciais dos canais

# Storage
STORAGE_ENDPOINT=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
STORAGE_BUCKET=

# Email
RESEND_API_KEY=

# WhatsApp (Evolution API)
EVOLUTION_API_URL=
EVOLUTION_API_KEY=

# Meta (Instagram)
META_APP_ID=
META_APP_SECRET=
META_VERIFY_TOKEN=

# Sentry
SENTRY_DSN=
```

---

## 12. DECISÕES TÉCNICAS — JUSTIFICATIVAS

| Decisão | Alternativa | Por quê escolhemos |
|---|---|---|
| Fastify | Express | 2x mais rápido, TypeScript nativo, schema validation |
| Schema-per-tenant | Row-level | Isolamento real, backup individual, sem risco de vazamento |
| BullMQ | Agenda/node-cron | Filas robustas, retry automático, dashboard visual |
| Prisma | Knex/TypeORM | DX superior, migrations automáticas, type-safety completo |
| pnpm workspaces | npm/yarn | Mais rápido, menos disco, melhor para monorepo |
| Railway | Heroku/Vercel | Postgres + Redis + deploy tudo junto, mais barato no MVP |
| Evolution API | Twilio | Open source, sem custo por mensagem no MVP |

---

*Documento vivo — atualizar conforme o projeto evolui.*
*Próximo passo: Sprint 0 — Setup do monorepo e fundação.*
