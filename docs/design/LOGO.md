# ZiraDesk — Padrões de Logo

> Referência canônica: `docs/design/ziradesk_logo_final.html`

---

## Estrutura do Logo

O logo ZiraDesk é composto por dois elementos:

1. **Ícone** — letterform "Z" em SVG
2. **Logotipo** — nome "ZiraDesk" com pesos tipográficos distintos

### Ícone — Letterform Z

```svg
<svg width="28" height="28" viewBox="0 0 56 56" fill="none" aria-hidden="true">
  <path
    d="M14 16 L42 16 L14 40 L42 40"
    fill="none"
    stroke="currentColor"
    stroke-width="4"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>
```

| Atributo       | Valor                            |
|----------------|----------------------------------|
| `viewBox`      | `0 0 56 56`                      |
| Traçado        | `M14 16 L42 16 L14 40 L42 40`   |
| `strokeWidth`  | `4`                              |
| `strokeLinecap` | `round`                         |
| `strokeLinejoin` | `round`                        |
| Cor do traço   | `currentColor` (herda do contexto) |

### Fundo do Ícone (modo escuro)

```css
background: #1E293B;
border: 1px solid #334155;
border-radius: 10px; /* ou 12px em tamanhos maiores */
color: #F1F5F9;       /* cor do traço via currentColor */
```

### Fundo do Ícone (modo claro — se aplicável)

```css
background: #F8FAFC;
border: 1px solid #E2E8F0;
border-radius: 10px;
color: #0F172A;
```

---

## Logotipo — Renderização do Nome

O nome é sempre renderizado com pesos diferentes para "Zira" e "Desk":

```tsx
<span>
  <span style={{ fontWeight: 700 }}>Zira</span>
  <span style={{ fontWeight: 300 }}>Desk</span>
</span>
```

| Parte    | `font-weight` | Valor numérico |
|----------|---------------|----------------|
| "Zira"   | bold          | `700`          |
| "Desk"   | light         | `300`          |

- Fonte: **IBM Plex Sans** (obrigatório)
- `letter-spacing`: `-0.5px` no logotipo completo
- Cor: `#F0F1F3` (token `--txt`) sobre fundos escuros

---

## Subtítulo (quando presente)

```tsx
<span className="text-[10px] font-medium tracking-[0.15em] uppercase text-txt-3">
  Business Platform
</span>
```

| Propriedade      | Valor            |
|------------------|------------------|
| `font-size`      | `10px`           |
| `font-weight`    | `500` (medium)   |
| `letter-spacing` | `0.15em`         |
| `text-transform` | `uppercase`      |
| Cor              | `#5C6370` (`--txt-3`) |

---

## Conjunto Logo Completo (JSX)

```tsx
<div className="flex items-center gap-3">
  {/* Ícone */}
  <div className="flex h-9 w-9 items-center justify-center rounded-[10px] border border-[#334155] bg-[#1E293B] text-[#F1F5F9]">
    <svg width="20" height="20" viewBox="0 0 56 56" fill="none" aria-hidden>
      <path
        d="M14 16 L42 16 L14 40 L42 40"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </div>

  {/* Nome */}
  <div className="flex flex-col leading-tight" style={{ letterSpacing: '-0.5px' }}>
    <span className="text-base font-normal text-txt">
      <span className="font-bold">Zira</span>
      <span className="font-light">Desk</span>
    </span>
    <span className="text-[10px] font-medium tracking-[0.15em] uppercase text-txt-3">
      Business Platform
    </span>
  </div>
</div>
```

---

## Tamanhos

| Contexto              | Ícone     | Nome          |
|-----------------------|-----------|---------------|
| Sidebar (68px rail)   | 32×32     | Não exibido   |
| Sidebar expandida     | 36×36     | `text-base`   |
| Topbar                | 28×28     | `text-sm`     |
| Tela de login         | 40×40     | `text-xl`     |
| Favicon / 16px        | SVG puro  | —             |

---

## Uso Incorreto

- Não alterar as proporções do traçado Z
- Não usar `font-weight: 400` para ambas as partes do nome
- Não aplicar o ícone sem o container com fundo `#1E293B`
- Não usar cor de stroke diferente de `currentColor` no SVG (ajuste via CSS)
- Não usar outra fonte que não IBM Plex Sans
