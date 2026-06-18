# 02 — Catálogo de Estados & Interações

> Toda tela tem mais estados que o "cheio e perfeito". Este doc define **como cada estado se parece e se comporta**
> no ZiraDesk. Desenhar estes estados é obrigatório (Playbook §5.6 e checklist §7).

---

## 1. Os estados de uma área de conteúdo

Toda lista, tabela, painel ou card pode estar em **um** destes estados. Desenhe todos os que se aplicam:

| Estado | Quando | Como mostrar |
|---|---|---|
| **Carregando** | Dados sendo buscados | Skeleton (§2) — nunca spinner solto no meio da tela. |
| **Cheio** | Há dados | O conteúdo normal. |
| **Vazio (sem dados)** | Não há registros ainda | Empty state desenhado (§3). |
| **Vazio (filtro)** | Filtro/busca não retornou nada | Empty state + "Limpar filtros". |
| **Erro** | Falha ao carregar | Empty state vermelho + "Tentar novamente". |
| **Sem permissão** | Role não autorizada | Mensagem neutra + caminho de saída. |
| **Parcial/atualizando** | Recarga em background | Conteúdo atual + `.live-dot` ou barra sutil; nunca bloquear. |

---

## 2. Skeleton (carregando)

Reproduz a **forma** do conteúdo, não um spinner. Mantém a densidade e evita "pulo" de layout.

- Blocos em `var(--bg-3)` com shimmer sutil (gradiente que percorre, ~1.4s, `prefers-reduced-motion` desliga).
- Respeite as dimensões reais: linha de tabela skeleton = altura de linha real; card skeleton = tamanho do card.
- Quantidade: 5–8 linhas/cards fantasma bastam.
- **Nunca** trave a topbar/nav-rail; eles aparecem imediatamente.

```css
.skeleton { background: var(--bg-3); border-radius: var(--r); position: relative; overflow: hidden; }
.skeleton::after { content:''; position:absolute; inset:0;
  background: linear-gradient(90deg, transparent, var(--bg-4), transparent);
  transform: translateX(-100%); animation: sk 1.4s infinite; }
@keyframes sk { 100% { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .skeleton::after { animation: none; } }
```

---

## 3. Estado vazio (empty state)

Padrão visual (de `docs/design/PADRAO_DE_TELAS.md` §7 "Estado vazio"):

```
┌──────────────────────────┐
│        ( ícone )         │  círculo ~52px, bg var(--<cor>-dim), borda rgba(<cor>,.25), ícone na <cor>
│   Título (13px/500 txt-2)│
│ Subtítulo (11px txt-3)   │
│      [ CTA opcional ]    │  tb-btn ou CTA teal
└──────────────────────────┘
```

Cor do ícone por **natureza** do vazio:
- **Positivo** ("sem fila", "tudo resolvido") → **green**.
- **Neutro** ("nenhum registro ainda") → **teal** ou neutro (`bg-4`/`txt-3`).
- **Ação necessária** ("nenhum canal conectado") → **amber** + CTA.
- **Erro** → **red** + "Tentar novamente".

Texto: diga **o que é** e **o próximo passo**. Ex.:
- Sem dados: "Nenhum ticket por aqui" / "Novos tickets aparecem assim que um cliente abre um chamado." [Novo ticket]
- Filtro: "Nada encontrado" / "Nenhum resultado para os filtros atuais." [Limpar filtros]
- Erro: "Não foi possível carregar" / "Verifique a conexão e tente de novo." [Tentar novamente]

---

## 4. Hover, foco e seleção

| Alvo | Hover | Foco (teclado) | Selecionado/Ativo |
|---|---|---|---|
| Linha de tabela | `bg: var(--bg-3)` | outline teal | `bg: rgba(teal,.06)` + `inset 2px 0 0 var(--teal)` |
| Botão padrão | `bg: var(--bg-5)`; primário `filter: brightness(1.08)` | `outline: 2px solid var(--teal); outline-offset: 2px` | — |
| Nav-item | `bg: var(--bg-4); color: var(--txt-2)` | outline teal | `bg: var(--teal-dim); color: var(--teal)` |
| Chip de filtro | `bg: var(--bg-3)` | outline teal | `.has-val`: borda+texto teal, `bg: var(--teal-dim)` |
| Card de lista | `bg: var(--bg-3)` | outline teal | borda `var(--line)` + `inset 2px 0 0 var(--teal)` |
| `.row-actions` | `opacity: 0 → 1` | sempre visíveis quando o foco entra na linha | — |

Regras:
- **Foco visível sempre:** `:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }`.
- Transições: `transition: all .15s` (hover de botão/nav), `opacity .12s` (row-actions). Nada acima de 300ms.
- Hit area mínima **32×32** para qualquer ação tocável.

---

## 5. Paginação e carga incremental

- **Tabelas longas:** rodapé `.tbl-foot` com setas 28×28 mono + número de página ativo em teal + "X–Y de N".
- **Listas/feeds:** "Carregar mais" (`btn-ghost`) ou scroll infinito com skeleton no fim.
- Sempre mostrar o **total** ("3 de 87") perto do controle.
- Ao paginar/filtrar, **não** resetar a rolagem da página inteira — só da área da lista.

---

## 6. Feedback de ação (toasts e inline)

**Toast** (canto inferior direito, empilha, some em ~4s):
- Sucesso → faixa/ícone **green**: "Ticket #4821 resolvido."
- Erro → **red** + ação de desfazer/tentar: "Falha ao enviar. Tentar novamente."
- Info → **blue** ou neutro: "Atendimento transferido para Vendas."
- Estrutura: ícone + texto (12–13px) + ação opcional + fechar. `bg: var(--bg-2)`, `box-shadow: var(--shadow-pop)`.

**Inline** (preferível para formulários):
- Erro de campo: borda `var(--red)` + mensagem 11px em `var(--red)` abaixo do input.
- Sucesso de salvamento: a `save-bar` vira "Salvo ✓" por 2s e some.

Use **toast** para ações em registros/listas; **inline** para validação de formulário.

---

## 7. Confirmação destrutiva

Toda ação irreversível (excluir, suspender tenant, encerrar conversa sem resolver) passa por **modal** (arquétipo G):
- Título claro do efeito: "Excluir organização?"
- Corpo: o que será perdido e se é reversível.
- Botão primário em **red** com o verbo exato ("Excluir"); "Cancelar" ghost.
- Quando o efeito é grave (apagar dados de cliente — LGPD), exigir digitar o nome para confirmar.

---

## 8. Realtime (Dashboard/Inbox)

Eventos chegam por Socket.io (ver `ARQUITETURA_TECNICA.md` §7). Na UI:
- Atualizações entram **suavemente** — sem piscar a tela inteira, sem reordenar bruscamente sob o cursor.
- Novidade sinalizada por `.live-dot` pulsando, badge de contagem, ou highlight breve (fade de `teal-dim`, 1s).
- "Atualizado agora" / "há 30s" no header; botão "Atualizar" manual sempre disponível.
- Nunca roubar o foco do usuário (ex.: ele digitando no composer) por causa de um evento.

---

## 9. Acessibilidade (mínimos)

- `lang="pt-BR"`; contraste AA (`--txt-2` sobre `--bg-2` passa; `--txt-3` só para metadados).
- Botões só-ícone: `title` + `aria-label`.
- Foco visível e ordem de tabulação lógica.
- `prefers-reduced-motion`: desligar shimmer, pulse decorativo e animações de entrada.
- Estados não comunicados só por cor — sempre acompanhar de texto/ícone (ex.: status pill tem rótulo, não só cor).

---

## Checklist de estados (por área de conteúdo)

- [ ] Carregando (skeleton na forma do conteúdo)
- [ ] Vazio sem dados (com CTA do próximo passo)
- [ ] Vazio por filtro (com "Limpar filtros")
- [ ] Erro (com "Tentar novamente")
- [ ] Sem permissão (quando a tela depende de role)
- [ ] Hover/foco/seleção em todos os interativos
- [ ] Feedback de cada ação (toast ou inline)
- [ ] Confirmação para ações destrutivas
- [ ] Comportamento realtime suave (se aplicável)

