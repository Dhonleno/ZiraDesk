# 03 — Guia de Conteúdo & Voz (PT-BR)

> Como o ZiraDesk **fala**. Microcópia consistente faz o produto parecer uma coisa só.
> Estende `docs/design/PADRAO_DE_TELAS.md` §8 com regras práticas e biblioteca de frases.

---

## 1. Princípios de voz

ZiraDesk é **direto, profissional e próximo** — um colega competente, não um robô nem um vendedor.

- **Direto:** diga o necessário, corte o resto. "Salvar", não "Clique aqui para salvar suas alterações".
- **Profissional:** sem gírias, sem exclamações, sem "Olá!", sem emoji.
- **Próximo:** trate o usuário por "você"; sem juridiquês nem voz passiva fria.
- **Confiante, não arrogante:** afirme. Evite "talvez", "parece que".

> Teste: se dá para remover uma palavra sem perder sentido, remova.

---

## 2. Botões e ações — sempre verbo no infinitivo

| Faça | Não faça |
|---|---|
| Salvar | Salvar alterações agora |
| Novo atendimento | + Adicionar novo atendimento |
| Atribuir | Fazer atribuição |
| Transferir | Transferência |
| Resolver | Marcar como resolvido ✓ |
| Convidar usuário | Enviar convite para novo usuário |
| Conectar canal | Configurar integração de canal |

- Ação primária = verbo + objeto curto ("Novo ticket", "Conectar canal").
- Ação secundária/cancelar = "Cancelar", "Voltar", "Descartar".
- Em ação destrutiva, o botão diz **o que faz**: "Excluir", "Suspender", "Encerrar" — nunca "OK"/"Sim".

---

## 3. Títulos e rótulos

- **H1 de página:** substantivo do módulo. "Organizações", "Tickets", "Relatórios". Sem verbo, sem ":".
- **Eyebrow de seção** (10px uppercase): curto e categórico. "ATIVIDADE RECENTE", "FILAS EM TEMPO REAL".
- **Labels de campo:** substantivo curto, sem dois-pontos. "E-mail", "Telefone", "Responsável".
- **Placeholders:** exemplo ou instrução curta — "Buscar organização, CNPJ…". Não repita o label.
- **Contadores:** número + substantivo. "3 tickets", "5 contatos". Plural correto.

---

## 4. Mensagens de estado

**Vazio** — título (o que é) + subtítulo (próximo passo). Tom calmo, nunca culpa o usuário:
- "Nenhum ticket por aqui" · "Novos chamados aparecem assim que um cliente abre um atendimento."
- "Sem fila no momento" · "Todos os atendimentos foram distribuídos."
- "Nada encontrado" · "Nenhum resultado para os filtros atuais."

**Erro** — diga o que houve e o que fazer, sem termos técnicos:
- "Não foi possível carregar os tickets." · [Tentar novamente]
- "Falha ao enviar a mensagem." · [Tentar novamente]
- Evite: "Error 500", "undefined", "request failed".

**Sucesso** — curto, confirma o efeito (toast some sozinho):
- "Ticket #4821 resolvido."
- "Atendimento transferido para Vendas."
- "Convite enviado para ana@empresa.com."

**Confirmação destrutiva** — pergunta + consequência:
- "Excluir organização?" · "Os dados de contato e o histórico serão removidos. Esta ação não pode ser desfeita."

---

## 5. Números, datas e moeda (PT-BR)

- **Milhar:** ponto. `2.847`, `1.250.000`. **Decimal:** vírgula. `4,5`.
- **Moeda:** `R$ 1.234,56` (espaço após R$).
- **Percentual:** `88%` (sem espaço). Variação: `+12%`, `-4 pp` (pontos percentuais).
- **Datas relativas em listas:** "agora", "há 2min", "há 3h", "ontem", "14:32". Trocar para data absoluta após ~7 dias: "12/03".
- **Datas absolutas em detalhes:** "15 mai 2026", "15/05/2026 14:32".
- **Duração:** "4m32s", "há 3h 12min". Sempre em **mono**.
- **Telefone:** "+55 (62) 3622-5555". **CNPJ:** "28.920.909/0001-87". **CPF:** "123.456.789-09".

---

## 6. Vocabulário canônico (use sempre o mesmo termo)

| Conceito | Termo oficial | Evite |
|---|---|---|
| Produto | **ZiraDesk** (uma palavra) | Zira Desk, NexCRM |
| Conversa/atendimento ativo | **atendimento** | chamada, sessão |
| Mensagem trocada | **mensagem** | msg, texto |
| Chamado de suporte | **ticket** | caso, ocorrência |
| Empresa cliente | **organização** | conta, empresa (em UI) |
| Pessoa de contato | **contato** | lead (só no funil), pessoa |
| Estágio do cliente | **lead / prospect / cliente / inativo** | (mantenha esses 4) |
| Agrupamento de filas | **fila** (hierárquica com `›`) | departamento, setor |
| Quem atende | **agente** | atendente, operador |
| Quem administra o tenant | **owner / admin** | gestor, dono |
| Indicador de tempo de resposta | **TMA, SLA, FRT, NPS** | (siglas aceitas, não expandir) |
| Canal externo | **WhatsApp / Instagram / E-mail / Webchat** | Whats, Insta, mail |

Filas e segmentos hierárquicos usam `›`: "Suporte Técnico › Infraestrutura".

---

## 7. Tom por contexto

| Contexto | Tom |
|---|---|
| Ações cotidianas (salvar, filtrar) | Neutro, telegráfico. |
| Estado vazio | Acolhedor, orientador, nunca culpa. |
| Erro | Calmo, responsável, com saída. ("Não foi possível…") |
| Destrutivo | Sério e claro sobre a consequência. |
| Onboarding/primeiro uso | Encorajador, um passo de cada vez. |
| Alertas operacionais (Monitor) | Objetivo e acionável. "Infraestrutura: 2 esperando há 12 min. SLA em 72%." |

---

## 8. Pontuação e formatação

- **Sem ponto final** em rótulos, títulos, itens de lista curtos, botões.
- **Com ponto final** em frases de corpo, mensagens de estado, ajudas.
- **Sem reticências** exceto em placeholder de busca e em "Carregando…".
- **Capitalização:** apenas a primeira letra (sentence case). "Novo atendimento", não "Novo Atendimento".
- **Aspas:** use "aspas retas" simples; itálico não é usado em UI.

---

## 9. Erros comuns a evitar

- ❌ "Clique aqui", "Por favor", "Oops!", "Ops!", "Aguarde…"
- ❌ Exclamações em série, emoji, ALL CAPS fora do eyebrow.
- ❌ Voz passiva fria: "Um erro foi encontrado" → ✅ "Não foi possível carregar."
- ❌ Jargão técnico vazado: "payload", "request", "null", "timeout".
- ❌ Plural errado: "1 tickets", "0 contato".
- ❌ Misturar termos (atendimento/chamada/sessão para a mesma coisa).

---

## 10. Biblioteca rápida (copiar)

**Topbar:** `Novo atendimento` · `Online` · `Buscar…` · `Sair`
**Listagem:** `Novo` · `Filtrar` · `Limpar filtros` · `Ordenar` · `X–Y de N`
**Detalhe:** `Editar` · `Iniciar atendimento` · `Ver tudo` · `Abrir no Omnichannel`
**Tickets:** `Aberto` · `Em atendimento` · `Aguardando` · `Resolvido` · `Encerrado` · `Baixa/Média/Alta/Urgente`
**Atendimento:** `Atribuir` · `Transferir` · `Resolver` · `Nota interna` · `Responder`
**Admin:** `Convidar usuário` · `Conectar canal` · `Suspender` · `Reativar`
**Vazios:** `Nenhum … por aqui` · `Sem … no momento` · `Nada encontrado`
**Toasts:** `… resolvido.` · `… transferido para ….` · `Convite enviado para ….` · `Falha ao …. Tentar novamente.`

