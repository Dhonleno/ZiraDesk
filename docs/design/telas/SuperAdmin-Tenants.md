# Tela — Super Admin · Tenants

| Campo | Valor |
|---|---|
| **Módulo** | Super Admin (operação ZiraDesk) |
| **Arquétipo** | F. Tabela administrativa (+ detalhe) |
| **Rota** | `/super-admin/tenants` |
| **Nav-rail ativo** | Tenants (nav-rail reduzido do Super Admin: Tenants · Planos · Métricas) |
| **Breadcrumb** | `Super Admin / Tenants` |
| **Padrão específico** | Este PRD define a gestão de tenants: tabela administrativa, KPIs, filtros, painel lateral e ações globais. |
| **Permissões** | **somente `super_admin`** — não aparece no app do tenant |

## 1. Objetivo
Painel interno da ZiraDesk para provisionar e administrar as empresas (tenants): criar, ativar/suspender, ver plano, uso e saúde de cada conta.

## 2. Usuários e cenários
- **Operação ZiraDesk:** cria um tenant novo após a venda; define slug (subdomínio) e plano.
- **Suporte/Financeiro:** suspende tenant inadimplente; reativa após pagamento.
- **Growth:** vê quais contas estão perto do limite do plano (oportunidade de upgrade) ou em risco de churn (uso caindo).

## 3. Layout
```
.content → 1fr [+ .detail-panel 380px ao selecionar]
└── .admin-area
    ├── .page-head    h1 "Tenants" + count + [Novo tenant] (primária)
    ├── .kpi-row      Tenants ativos · Em trial · Suspensos · MRR estimado
    ├── .filter-bar   busca + chips (Plano, Status) + seg-tabs (Todos/Ativos/Trial/Suspensos)
    └── .table-wrap   table.tenants (rola)
```
Selecionar abre `.detail-panel`: dados, assinatura, uso (usuários/contatos/canais vs limites), ações.

## 4. Dados exibidos
| Campo | Origem (`tenants`/`subscriptions`/`plans`) | Formato |
|---|---|---|
| Empresa | `tenants.name` | avatar/letra + nome |
| Subdomínio | `tenants.slug` | mono — `slug.ziradesk.com.br` |
| Plano | `plans.name` | pill: Starter/Pro/Enterprise |
| Status | `tenants.status` | pill: ativo=green, trial=blue, suspenso=amber, cancelado=red |
| Trial termina | `trial_ends_at` | data; destacar se <3 dias |
| Uso | counts vs `plans.max_*` | "12/25 usuários" + mini-barra |
| MRR | `plans.price_month` | `R$` mono |
| Criado em | `created_at` | data |
| Ações | — | row-actions: Abrir, Suspender/Reativar, ⋯ |

## 5. Ações
| Ação | Gatilho | Resultado | Permissão |
|---|---|---|---|
| **Novo tenant** (primária) | botão topo | modal: nome, slug, plano, e-mail do owner | super_admin |
| Abrir detalhe | linha | painel lateral | super_admin |
| Suspender | row-action | `status=suspended` (acesso bloqueado) + confirmação | super_admin |
| Reativar | em suspenso | `status=active` | super_admin |
| Trocar plano | detalhe | atualiza assinatura + limites | super_admin |
| Estender trial | detalhe | nova `trial_ends_at` | super_admin |
| Cancelar | ⋯ | `status=cancelled` (confirmação forte) | super_admin |

## 6. Filtros, busca e ordenação
- **Busca:** nome, slug, e-mail do owner.
- **Chips:** Plano, Status.
- **Abas:** Todos · Ativos · Trial · Suspensos · Cancelados (contadores).
- **Ordenar:** Criação (default), Trial terminando, MRR, Uso (% do limite).

## 7. Regras de negócio
- **Criar tenant** dispara provisionamento do schema (`ARQUITETURA_TECNICA.md` §4): cria `tenant_{slug}`, owner inicial, status `trial`. Slug deve ser único e DNS-safe (minúsculas, sem espaço/acento).
- **Suspender** bloqueia login de todos do tenant (middleware retorna 402) mas **preserva dados**.
- **Cancelar** é terminal; reativar exige novo provisionamento/decisão.
- **Limites do plano** vêm de `plans.features`; uso acima do limite sinaliza (não derruba) e marca para upgrade.
- Isolamento total entre tenants — esta tela é o único lugar que enxerga vários tenants, e só para `super_admin`.
- Toda ação registra auditoria global.

## 8. Estados
- **Carregando:** skeleton de tabela.
- **Vazio (sem tenants):** "Nenhum tenant ainda" · "Crie o primeiro cliente para começar." · [Novo tenant].
- **Vazio (filtro):** "Nada encontrado" · [Limpar filtros].
- **Erro:** "Não foi possível carregar os tenants." · [Tentar novamente].
- **Trial terminando (linha):** data em amber + dica "Termina em 2 dias".
- **Sem permissão:** qualquer não-super_admin → tela inexistente / "Sem permissão".

## 9. Validações
- Novo tenant: nome obrigatório; slug único, `^[a-z0-9-]{3,40}$`; e-mail do owner válido; plano obrigatório.
- Suspender/Cancelar: confirmação (cancelar exige digitar o slug).
- Não permitir slug reservado (`app`, `api`, `www`, `admin`).

## 10. Microcópia-chave
- H1: "Tenants" · Primária: "Novo tenant"
- Status: "Ativo", "Trial", "Suspenso", "Cancelado"
- Ações: "Suspender", "Reativar", "Trocar plano", "Estender trial", "Cancelar"
- Toast: "Tenant criado — empresa.ziradesk.com.br." · "Tenant suspenso." · "Plano atualizado para Pro."
- Confirmação: "Suspender este tenant?" · "Todos os usuários perderão acesso até a reativação. Os dados são preservados."

## 11. Realtime & eventos
Uso/contadores podem atualizar periodicamente; pagamento aprovado/falho (gateway) pode mudar status — refletir o pill.

## 12. Métricas de sucesso
Tenants ativos, conversão trial→pago, MRR, % de contas perto do limite (oportunidade de upgrade).

## 13. Fora de escopo
Gestão de planos/preços (tela Planos). Faturamento detalhado por tenant (futuro/integração de gateway). Dados internos do tenant (isolados — não acessíveis daqui).

