# Tela — Configurações · Canais

| Campo | Valor |
|---|---|
| **Módulo** | Configurações (Admin) |
| **Arquétipo** | E. Configuração / Integrações |
| **Rota** | `/admin/channels` |
| **Nav-rail ativo** | Configurações |
| **Breadcrumb** | `Configurações / Canais` |
| **Padrão específico** | Este PRD define canais: shell de configurações, cards de integração, modal/wizard, status, quotas e estados. |
| **Permissões** | owner/admin: ler + conectar + editar; agent/viewer: **sem acesso** (item oculto na nav) |

## 1. Objetivo
Conectar e administrar os canais por onde o tenant atende (WhatsApp, Instagram, E-mail, Webchat). É o que liga a operação do Inbox ao mundo externo.

## 2. Usuários e cenários
- **Admin no onboarding:** conecta o primeiro WhatsApp para começar a receber mensagens.
- **Admin no dia a dia:** vê se um canal caiu, reconecta, ajusta horário de atendimento e resposta automática.
- **Owner:** revê quais canais consomem quota do plano.

## 3. Layout
```
.content → .settings-nav 240px | .settings-body 1fr
├── .settings-nav   Geral · Marca · Canais (ativo) · Usuários · Faturamento
└── .settings-body (rola)
    ├── .page-head   h1 "Canais" + descrição + [Conectar canal] (primária)
    ├── .dsec "Canais conectados"   cards de canal (status, número/conta, métricas)
    └── .dsec "Disponíveis"         canais não conectados (WhatsApp/Instagram/E-mail/Webchat) → "Conectar"
```
Conectar/editar um canal abre **modal** (ou sub-painel) com os campos do canal.

## 4. Dados exibidos
| Campo | Origem (`channels`) | Formato |
|---|---|---|
| Tipo | `type` | ícone de marca (WhatsApp `#25D366`, Instagram pink/gradiente, e-mail blue, webchat purple) |
| Nome/identidade | `name` | ex.: número, @perfil, endereço |
| Status | `status` | pill: ativo=green (dot), conectando=amber, erro=red, inativo=neutro |
| Conectado em | `created_at` | data |
| Volume (30d) | agregado de `conversations` | mono |
| Credenciais | `credentials` (JSONB, **nunca exibir em texto**) | mascarado; só "configurado ✓" |

## 5. Ações
| Ação | Gatilho | Resultado | Permissão |
|---|---|---|---|
| **Conectar canal** (primária) | botão topo / card disponível | modal/wizard de conexão | admin+ |
| Editar | card conectado | modal de configuração | admin+ |
| Reconectar | em canal com erro | reabre fluxo de auth | admin+ |
| Pausar / Ativar | toggle no card | `status` alterna | admin+ |
| Remover | ⋯ do card | confirmação destrutiva | owner |
| Testar | no modal | envia ping/valida credenciais | admin+ |

## 6. Configurações por canal (campos do modal)
- **WhatsApp (Evolution API):** número, instância/URL, API key, webhook (auto), horário de atendimento, mensagem de ausência.
- **Instagram (Meta Graph):** conectar conta (OAuth), página vinculada, permissões.
- **E-mail (Resend inbound):** endereço, assinatura, encaminhamento/verificação de domínio (SPF/DKIM).
- **Webchat:** domínios permitidos, cor do widget (dentro do teal do produto), saudação, snippet de instalação.
- Comuns: nome de exibição, fila padrão de entrada, auto-atribuição (sim/round-robin/não), resposta automática.

## 7. Regras de negócio
- **Quota do plano:** número de canais limitado pelo plano (`plans.features`); ao atingir, "Conectar" mostra upsell, não erro.
- **Credenciais** são criptografadas (AES-256) e **nunca** retornam em claro à UI — mostrar só estado.
- Canal em **erro** (token expirado, webhook falhando) deve aparecer no topo e gerar alerta; afeta o Inbox.
- Remover canal não apaga conversas históricas; avisa que novas mensagens deixarão de chegar.
- Mudanças sensíveis registram `audit_logs`.

## 8. Estados
- **Carregando:** skeleton de cards de canal.
- **Vazio (nenhum canal):** ícone **amber** (ação necessária) · "Nenhum canal conectado" · "Conecte um canal para começar a receber atendimentos." · [Conectar canal].
- **Erro de carga:** "Não foi possível carregar os canais." · [Tentar novamente].
- **Canal com erro (item):** card com pill red + "Reconectar".
- **Quota atingida:** banner sutil "Seu plano permite N canais" + [Ver planos].
- **Sem permissão:** agent/viewer não veem o item; acesso direto → "Sem permissão" + voltar.

## 9. Validações
- WhatsApp: número em formato internacional, API key não vazia, teste de conexão obrigatório antes de salvar.
- E-mail: endereço válido + verificação de domínio antes de ativar.
- Webchat: ao menos um domínio permitido.
- Remover: confirmação digitando o nome do canal.

## 10. Microcópia-chave
- H1: "Canais" · Primária: "Conectar canal"
- Status: "Ativo", "Conectando", "Erro", "Pausado"
- Ações: "Editar", "Reconectar", "Pausar", "Ativar", "Testar", "Remover"
- Toast: "WhatsApp conectado." · "Canal pausado." · "Falha ao conectar. Verifique as credenciais."
- Vazio: "Nenhum canal conectado" / "Conecte um canal para começar a receber atendimentos."

## 11. Realtime & eventos
Status do canal pode mudar por evento de saúde (webhook caindo) — refletir o pill ao vivo e, se crítico, alertar.

## 12. Métricas de sucesso
Tempo até conectar o primeiro canal (onboarding), % de canais saudáveis, volume por canal.

## 13. Fora de escopo
Atendimento em si (Inbox/Omnichannel). Faturamento/upgrade de plano (seção Faturamento). Gestão de usuários (Admin-Usuarios).

