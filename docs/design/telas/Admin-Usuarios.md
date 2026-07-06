# Tela — Configurações · Usuários & Permissões

| Campo | Valor |
|---|---|
| **Módulo** | Configurações (Admin) |
| **Arquétipo** | F. Tabela administrativa |
| **Rota** | `/admin/users` |
| **Nav-rail ativo** | Configurações |
| **Breadcrumb** | `Configurações / Usuários` |
| **Padrão específico** | Este PRD define usuários e permissões: shell de configurações, filtros, tabela administrativa, RBAC e estados. |
| **Permissões** | owner: tudo; admin: convidar/editar agentes (não mexe em owners); agent/viewer: sem acesso |

## 1. Objetivo
Gerir quem tem acesso ao tenant: convidar pessoas, definir papéis (RBAC), ativar/desativar e acompanhar atividade.

## 2. Usuários e cenários
- **Owner/Admin no onboarding:** convida a equipe e define papéis.
- **Admin no dia a dia:** desativa quem saiu, troca papel de alguém, reenvia convite pendente.
- **Owner:** transfere a posse (owner) ou remove um admin.

## 3. Layout
```
.content → .settings-nav 240px | .settings-body 1fr
└── .settings-body (rola)
    ├── .page-head    h1 "Usuários" + count + [Convidar usuário] (primária)
    ├── .filter-bar   busca + chips (Papel, Status) + seg-tabs (Todos/Ativos/Convidados/Inativos)
    └── .table-wrap   table.users (rola)
```

## 4. Dados exibidos
| Campo | Origem (`users`) | Formato |
|---|---|---|
| Usuário | `name` + `email` | avatar 32×32 + nome (13/500) + e-mail (`--txt-3`); marcar "(você)" |
| Papel | `role` | pill/texto: owner=purple, admin=teal, agent=neutro, viewer=neutro |
| Status | `status` | pill: ativo=green, convidado=amber ("Convite pendente"), inativo=neutro |
| Último acesso | `last_seen_at` | data relativa ("há 2h", "—" se nunca) |
| Atendimentos (30d) | agregado `conversations.assigned_to` | mono |
| Ações | — | `.row-actions` hover: Editar papel, Reenviar convite, Desativar, ⋯ |

## 5. Ações
| Ação | Gatilho | Resultado | Permissão |
|---|---|---|---|
| **Convidar usuário** (primária) | botão topo | modal: e-mail + papel → envia convite | admin+ |
| Editar papel | row-action / linha | select de papel + salvar | admin+ (não em owner) |
| Reenviar convite | em "convidado" | reenvia e-mail + toast | admin+ |
| Desativar / Reativar | row-action | `status` alterna | admin+ |
| Remover | ⋯ | confirmação destrutiva | owner |
| Transferir posse | ⋯ em um admin | torna-o owner (com confirmação forte) | owner |

## 6. Filtros, busca e ordenação
- **Busca:** nome, e-mail.
- **Chips:** Papel (owner/admin/agent/viewer), Status (ativo/convidado/inativo).
- **Abas:** Todos · Ativos · Convidados · Inativos (com contadores).
- **Ordenar:** Último acesso (default), Nome, Papel.

## 7. Regras de negócio (RBAC)
- Hierarquia: **owner > admin > agent > viewer**. Ver `ARQUITETURA_TECNICA.md` §5.
- **Admin não edita/rebaixa owner** nem se promove a owner.
- **Sempre ≥1 owner ativo** — bloquear remover/rebaixar/desativar o último owner.
- **Não pode editar o próprio papel** (evita auto-rebaixe acidental); transferir posse é fluxo à parte.
- **viewer:** acesso total em leitura; nenhuma ação de escrita no produto.
- Convite gera usuário `status=convidado` sem acesso até aceitar; expira em N dias.
- Toda mudança de papel/status registra `audit_logs`.

## 8. Estados
- **Carregando:** skeleton de 6 linhas.
- **Vazio (só você):** "Você é a única pessoa por aqui" · "Convide sua equipe para atender em conjunto." · [Convidar usuário].
- **Vazio (filtro):** "Nada encontrado" · [Limpar filtros].
- **Erro:** "Não foi possível carregar os usuários." · [Tentar novamente].
- **Convite pendente (linha):** status amber "Convite pendente" + "Reenviar".
- **Sem permissão:** agent/viewer não veem o item.

## 9. Validações
- Convite: e-mail válido e único no tenant; papel obrigatório (default `agent`).
- Não permitir ação que deixe o tenant sem owner (mensagem explicativa, não erro genérico).
- Remover/transferir posse: confirmação digitando o nome.
- Desativar a si mesmo: bloqueado.

## 10. Microcópia-chave
- H1: "Usuários" · Primária: "Convidar usuário"
- Papéis: "Owner", "Admin", "Agente", "Visualizador"
- Status: "Ativo", "Convite pendente", "Inativo"
- Ações: "Editar papel", "Reenviar convite", "Desativar", "Reativar", "Remover", "Transferir posse"
- Toast: "Convite enviado para ana@empresa.com." · "Papel atualizado." · "Usuário desativado."
- Bloqueio: "O tenant precisa de ao menos um owner." 

## 11. Realtime & eventos
Presença (`last_seen_at`/online) pode atualizar ao vivo; convite aceito move a linha de "convidado" para "ativo".

## 12. Métricas de sucesso
Tempo até a equipe estar ativa (onboarding), % de convites aceitos, usuários ativos/licenças do plano.

## 13. Fora de escopo
Permissões granulares por recurso (além dos 4 papéis) — futuro. Faturamento/licenças (seção Faturamento). Perfil pessoal do usuário (tela própria).

