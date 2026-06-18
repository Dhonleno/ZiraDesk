# ZiraDesk — Design System

> Referência canônica de design para telas do produto.
> Fonte de verdade atual: [PADRAO_DE_TELAS.md](./PADRAO_DE_TELAS.md)

---

## Uso Obrigatório

- Antes de criar/alterar qualquer tela, modal ou componente visual, leia integralmente [PADRAO_DE_TELAS.md](./PADRAO_DE_TELAS.md).
- Não invente tokens, cores, tipografia, espaçamento ou estrutura fora do padrão canônico.
- Se houver divergência entre este arquivo e o padrão canônico, prevalece [PADRAO_DE_TELAS.md](./PADRAO_DE_TELAS.md).

## Padrões por Tela

O padrão visual global está em [PADRAO_DE_TELAS.md](./PADRAO_DE_TELAS.md).
O padrão específico de cada tela deve estar em `docs/design/telas/*.md`.
Arquivos de tela existentes não são fonte de padrão visual; use-os apenas para entender implementação legada.

## Compatibilidade

Este arquivo permanece como entrada de descoberta para o design system, mas as regras detalhadas foram centralizadas no padrão de telas canônico.

---

## Tipografia

| Papel       | Família             | Pesos disponíveis       |
|-------------|---------------------|-------------------------|
| Interface   | IBM Plex Sans       | 300, 400, 500, 600      |
| Monospace   | IBM Plex Mono       | 400, 500                |

```css
--font: 'IBM Plex Sans', sans-serif;
--mono: 'IBM Plex Mono', monospace;
```

Carregamento via Google Fonts:
```html
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
```

No Tailwind:
```ts
fontFamily: {
  sans: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
  mono: ['IBM Plex Mono', 'monospace'],
}
```

---

## Paleta de Cores

### Fundos (do mais escuro ao mais claro)

| Token     | Hex / RGBA             | Uso                                    |
|-----------|------------------------|----------------------------------------|
| `--bg`    | `#0E0F11`              | Fundo principal da página              |
| `--bg-2`  | `#141518`              | Sidebar, topbar, painéis laterais      |
| `--bg-3`  | `#1A1C20`              | Cards, header de tabela, footer user   |
| `--bg-4`  | `#22252B`              | Inputs, ícone-btn, hover de nav        |
| `--bg-5`  | `#2A2E36`              | Hover mais forte, active state         |

### Bordas / Divisores

| Token      | Valor                     | Uso                               |
|------------|---------------------------|-----------------------------------|
| `--line`   | `rgba(255,255,255,.07)`   | Bordas padrão, separadores        |
| `--line-2` | `rgba(255,255,255,.12)`   | Bordas mais visíveis, inputs      |

### Texto

| Token      | Hex       | Uso                              |
|------------|-----------|----------------------------------|
| `--txt`    | `#F0F1F3` | Texto principal, títulos         |
| `--txt-2`  | `#9DA3AE` | Texto secundário, labels         |
| `--txt-3`  | `#5C6370` | Texto terciário, placeholders    |

### Cor Primária — Teal

| Token          | Valor                   | Uso                               |
|----------------|-------------------------|-----------------------------------|
| `--teal`       | `#00C9A7`               | Cor de ação principal, destaque   |
| `--teal-dim`   | `rgba(0,201,167,.15)`   | Fundo de item ativo, badge        |
| `--teal-glow`  | `rgba(0,201,167,.30)`   | Glow em focus/ring                |
| `--teal-hover` | `#00E8C0`               | Hover do botão primário           |

### Status / Semânticas

| Token         | Hex       | Dim (`rgba`)            | Uso                    |
|---------------|-----------|-------------------------|------------------------|
| `--green`     | `#3ECF8E` | `rgba(62,207,142,.15)`  | Sucesso, status ativo  |
| `--amber`     | `#F59E0B` | `rgba(245,158,11,.15)`  | Aviso, negociando      |
| `--red`       | `#F87171` | `rgba(248,113,113,.15)` | Erro, suspender        |
| `--blue`      | `#60A5FA` | `rgba(96,165,250,.15)`  | Info, e-mail           |
| `--purple`    | `#A78BFA` | `rgba(167,139,250,.15)` | Premium, especial      |
| `--pink`      | `#F472B6` | `rgba(244,114,182,.15)` | Instagram, social      |

### Canais (badges)

| Canal      | Cor principal | Background dim              | Borda dim                    |
|------------|---------------|-----------------------------|------------------------------|
| WhatsApp   | `#25D366`     | `rgba(37,211,102,.15)`      | `rgba(37,211,102,.25)`       |
| Instagram  | `#F472B6`     | `rgba(244,114,182,.15)`     | `rgba(244,114,182,.25)`      |
| E-mail     | `#60A5FA`     | `rgba(96,165,250,.15)`      | `rgba(96,165,250,.25)`       |

---

## Border Radius

| Token      | Valor   | Uso                             |
|------------|---------|---------------------------------|
| `--r`      | `8px`   | Botões, inputs, tooltips        |
| `--r-lg`   | `12px`  | Cards, modais                   |
| `--r-xl`   | `16px`  | Painéis, containers grandes     |
| `--r-pill` | `999px` | Badges, filtros, tags           |

---

## Layout Base da Tela de Atendimento

```
┌──────────────────────────────────────────────────────────┐
│                     TOPBAR (52px)                        │
├──────┬────────────────┬───────────────────┬──────────────┤
│ NAV  │   CONV LIST    │    CHAT AREA      │  INFO PANEL  │
│ RAIL │   (280px)      │      (1fr)        │   (300px)    │
│ 68px │                │                   │              │
│      │  Lista de      │  Mensagens +      │  Contato +   │
│      │  conversas     │  Área de input    │  Canais +    │
│      │  com busca     │                   │  Histórico   │
│      │  e filtros     │                   │              │
└──────┴────────────────┴───────────────────┴──────────────┘
```

### Grid CSS
```css
.main {
  display: grid;
  grid-template-columns: 68px 280px 1fr 300px;
}
```

---

## Componentes — Especificações

### Botão Primário
```css
background: var(--teal);        /* #00C9A7 */
color: #0E0F11;                 /* texto escuro sobre teal */
font-weight: 600;
border-radius: var(--r);
padding: 5px 11px;
```
Hover: `background: #00E8C0`

### Botão Secundário / Icon Button
```css
background: var(--bg-4);
border: 1px solid var(--line-2);
color: var(--txt-2);
border-radius: var(--r);
```
Hover: `background: var(--bg-5); color: var(--txt); border-color: rgba(255,255,255,.2)`

### Badge de Status
```css
/* Active (ativo) */
background: rgba(62,207,142,.15);
color: #3ECF8E;
border: 1px solid rgba(62,207,142,.2);

/* Trial (info) */
background: rgba(96,165,250,.15);
color: #60A5FA;
border: 1px solid rgba(96,165,250,.2);

/* Suspended (erro) */
background: rgba(248,113,113,.15);
color: #F87171;
border: 1px solid rgba(248,113,113,.2);

/* Cancelled (neutro) */
background: rgba(156,163,175,.15);
color: #9CA3AF;
border: 1px solid rgba(156,163,175,.2);
```

### Item de Nav Ativo
```css
background: var(--teal-dim);          /* rgba(0,201,167,.15) */
color: var(--teal);                   /* #00C9A7 */
border-left: 2px solid var(--teal);
```

### Bolha de Mensagem — Recebida
```css
background: var(--bg-3);
border: 1px solid var(--line);
color: var(--txt);
border-radius: 16px;
border-bottom-left-radius: 4px;
```

### Bolha de Mensagem — Enviada
```css
background: var(--teal);
color: #0a1a18;                       /* texto escuro sobre teal */
border-radius: 16px;
border-bottom-right-radius: 4px;
```

### Input de Texto
```css
background: var(--bg-4);
border: 1px solid var(--line-2);
color: var(--txt);
border-radius: var(--r);
```
Focus: `border-color: var(--teal); box-shadow: 0 0 0 3px var(--teal-dim)`

### Scrollbar personalizada
```css
scrollbar-width: thin;
scrollbar-color: var(--bg-5) transparent;
/* webkit */
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-thumb { background: var(--bg-5); border-radius: 2px; }
```

---

## Animações

```css
/* Entrada de mensagem / item */
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* Pulse de status online */
@keyframes pulse-ring {
  0%   { transform: scale(1); opacity: .4; }
  70%  { transform: scale(1.8); opacity: 0; }
  100% { transform: scale(1.8); opacity: 0; }
}

/* Digitando... */
@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); opacity: .4; }
  30%           { transform: translateY(-5px); opacity: 1; }
}
```

---

## Tailwind Config (tokens customizados)

```ts
colors: {
  bg: {
    DEFAULT: '#0E0F11',
    2: '#141518',
    3: '#1A1C20',
    4: '#22252B',
    5: '#2A2E36',
  },
  teal: {
    DEFAULT: '#00C9A7',
    hover: '#00E8C0',
    dim: 'rgba(0,201,167,.15)',
    glow: 'rgba(0,201,167,.30)',
  },
  txt: {
    DEFAULT: '#F0F1F3',
    2: '#9DA3AE',
    3: '#5C6370',
  },
  line: {
    DEFAULT: 'rgba(255,255,255,.07)',
    2: 'rgba(255,255,255,.12)',
  },
}
```

---

## Documentos Relacionados

- `ziradesk_logo_final.html` — padrões visuais do logotipo
- `docs/design/LOGO.md` — guia de uso do logo
