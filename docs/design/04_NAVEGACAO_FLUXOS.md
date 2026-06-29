# 04 — Navegação & Fluxos

> Como as telas se conectam. Define a estrutura de navegação global, breadcrumbs, deep links
> e os fluxos entre telas que o agente deve respeitar ao construir/linkar páginas.

---

## 1. Estrutura de navegação global

Dois "mundos" com shells distintos:

- **App do Tenant** (agentes/admins) — shell padrão (topbar + nav-rail). 99% das telas.
- **Super Admin** (operação ZiraDesk) — mesmo shell, nav-rail reduzido (Tenants, Planos, Métricas). Acesso só `super_admin`.
- **Autenticação** — shell próprio, sem topbar/nav-rail (ver `telas/Login.md`).

---

## 2. Nav-rail — ordem canônica e destinos

A nav-rail é idêntica em toda tela do app: 68px no estado recolhido padrão e 216px no estado expandido com rótulos. Ordem e item ativo:

| # | Item | Módulo (breadcrumb) | Página inicial | Padrão da tela |
|---|---|---|---|---|
| 1 | Atendimentos | Omnichannel | Inbox | PRD específico em `docs/design/telas/` |
| 2 | Monitor | Omnichannel | Monitor | PRD específico em `docs/design/telas/` |
| 3 | Relatórios | Relatórios | Dashboard | `docs/design/telas/Relatorios.md` |
| 4 | CRM | CRM | Organizações | PRD específico em `docs/design/telas/` |
| 5 | Clientes | CRM | Clientes (contatos) | PRD específico em `docs/design/telas/` |
| 6 | Campanhas | Campanhas | Lista de campanhas | — |
| — | *(divisor)* | | | |
| 7 | Configurações | Configurações | Admin | `docs/design/telas/Admin-*.md` |

Rodapé da nav-rail (`.nav-bottom`): avatar do usuário + `plan-pill` ("Plano Pro").

Regras:
- Item ativo: `bg: var(--teal-dim); color: var(--teal)`.
- Estado recolhido mostra apenas ícones com `title`/`aria-label`; estado expandido mostra ícone + rótulo.
- A preferência de expansão pode ser persistida localmente, mas viewports estreitos devem usar o estado recolhido.
- Itens que navegam usam `<a href>`, não `<div onclick>`.
- Badge de notificação por seção no canto superior direito, em `var(--red)`.

---

## 3. Breadcrumb (topbar)

Formato: **ícone do módulo + `Módulo` + `/` + `Página`** (página em `<strong>`).

- `Omnichannel / Monitor`
- `CRM / Organizações`
- `CRM / Organizações / Rio Madeira LTDA` (em detalhe, 3 níveis)
- `Configurações / Canais`
- `Tickets / #4821` (detalhe de ticket)

O nível de módulo é clicável (volta ao índice); o nível final é texto.

---

## 4. Mapa de telas (MVP)

```
App do Tenant
├── Omnichannel
│   ├── Inbox (conversa)           ← PRD específico em docs/design/telas/
│   └── Monitor                    ← PRD específico em docs/design/telas/
├── Relatórios
│   └── Dashboard analítico        ← docs/design/telas/Relatorios.md
├── CRM
│   ├── Organizações (lista+detalhe) ← PRD específico em docs/design/telas/
│   └── Clientes/Contatos (lista+detalhe) ← PRD específico em docs/design/telas/
├── Tickets
│   ├── Listagem                   ← docs/design/telas/Tickets-Listagem.md
│   └── Detalhe (#id)              ← docs/design/telas/Tickets-Detalhe.md
├── Campanhas
│   └── (futuro)
└── Configurações (Admin)
    ├── Geral / Empresa
    ├── Usuários & permissões       ← docs/design/telas/Admin-Usuarios.md
    ├── Canais                      ← docs/design/telas/Admin-Canais.md
    └── Faturamento

Super Admin (super_admin apenas)
├── Tenants                         ← docs/design/telas/SuperAdmin-Tenants.md
├── Planos
└── Métricas globais

Autenticação (shell próprio)
├── Login                           ← docs/design/telas/Login.md
├── Esqueci a senha
└── Aceitar convite
```

---

## 5. Fluxos principais (como as telas se ligam)

### 5.1 Atender um cliente
```
Monitor (vê fila/alerta)
  → "Abrir no Omnichannel" → Inbox na conversa específica
    → Responder / Nota interna
    → Transferir (modal) → conversa muda de fila
    → Resolver (modal + CSAT) → conversa sai da fila ativa → toast "resolvido"
```

### 5.2 Do atendimento ao CRM
```
Inbox → painel do contato → "Ver organização"
  → Organizações/detalhe (conta 360)
    → aba Tickets → Ticket/detalhe
    → "Iniciar atendimento" → volta ao Inbox numa nova conversa
```

### 5.3 Abrir e resolver um ticket
```
Tickets/Listagem (filtra por status/fila/agente)
  → seleciona linha → Tickets/Detalhe
    → comentar (interno/público), mudar status/prioridade, atribuir
    → Resolver → status=resolvido → some dos "abertos" → toast
```

### 5.4 Onboarding do tenant (admin)
```
Login (primeiro acesso)
  → Configurações/Geral (dados da empresa)
  → Configurações/Canais → "Conectar canal" (WhatsApp/Instagram/E-mail)
  → Configurações/Usuários → "Convidar usuário"
  → pronto para operar no Inbox
```

### 5.5 Super Admin provisiona um tenant
```
Super Admin/Tenants → "Novo tenant" (modal)
  → define nome, slug (subdomínio), plano
  → cria schema (ver ARQUITETURA_TECNICA.md §4) → tenant em trial
  → Tenants/detalhe → ativar/suspender, ver métricas
```

---

## 6. Deep links e estado na URL

Mesmo em protótipo HTML, projete pensando nas rotas reais (React Router — `ARQUITETURA_TECNICA.md` §8):

| Tela | Rota | O que vai na URL |
|---|---|---|
| Inbox | `/omnichannel/conversations?c=:conversationId` | conversa selecionada |
| Monitor | `/monitor?range=hoje&fila=:id` | período e filtro |
| Organizações | `/crm/organizations?id=:id&tab=overview` | registro + aba |
| Clientes | `/crm/contacts?id=:id` | contato selecionado |
| Tickets | `/tickets?status=open&q=...` | filtros |
| Ticket | `/tickets/:id` | id do ticket |
| Config | `/admin/channels` | seção |

Regras:
- Seleção de registro, aba ativa e filtros **vão na URL** — recarregar mantém o contexto.
- Em protótipo, ao menos linkar entre páginas com `<a href>` relativos, seguindo o mapa de rotas acima.
- Posição em conteúdo temporizado (vídeo/animação) persiste em `localStorage` (não se aplica a telas comuns).

---

## 7. Permissões e navegação (RBAC)

Papéis: `owner > admin > agent > viewer` (+ `super_admin` à parte). Ver `ARQUITETURA_TECNICA.md` §5.

- **agent/viewer:** não veem **Configurações** nem Super Admin. Itens ocultos (não desabilitados).
- **viewer:** tudo em leitura — esconder ações de escrita (Novo, Editar, Resolver), não só desabilitar onde for ruído.
- **admin/owner:** acesso a Configurações; só **owner** mexe em Faturamento e remove outro owner.
- **super_admin:** mundo Super Admin; não aparece na nav-rail do tenant.
- Tela acessada sem permissão → estado "Sem permissão" (`02_ESTADOS_INTERACOES.md` §1) + caminho de volta.

---

## 8. Consistência entre telas (regras de ligação)

- Todo link entre módulos passa pela nav-rail ou por um CTA explícito ("Abrir no Omnichannel", "Ver organização").
- Voltar de um detalhe sempre retorna à listagem **com os filtros preservados**.
- Abrir um registro nunca perde o contexto da lista (use painel lateral ou rota com estado).
- Ação concluída leva ao destino lógico + toast — nunca deixa o usuário "perdido" numa tela em branco.

