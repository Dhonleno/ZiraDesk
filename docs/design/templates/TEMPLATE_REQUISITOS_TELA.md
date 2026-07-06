# Template — Requisitos de Tela (PRD)

> Copie este arquivo para `docs/design/telas/<NomeDaTela>.md` e preencha. Profundidade-alvo: **média**
> (objetivo, usuários, dados, ações, regras, estados, validações). Apague as instruções em _itálico_.
> Mantenha PT-BR e referencie sempre `docs/design/PADRAO_DE_TELAS.md`, `01_CATALOGO_LAYOUTS.md` e os docs de estados/voz.

---

# Tela — `<Nome>`

| Campo | Valor |
|---|---|
| **Módulo** | _Omnichannel / CRM / Tickets / Configurações / Super Admin_ |
| **Arquétipo** | _A. Listagem / B. Detalhe / C. Dashboard / D. Inbox / E. Config / F. Tabela admin / H. Auth_ |
| **Rota** | _ex.: `/tickets?status=open`_ |
| **Nav-rail ativo** | _qual item_ |
| **Breadcrumb** | _ex.: `Tickets / Listagem`_ |
| **Padrão específico** | _este PRD define layout, comportamento, estados e microcópia da tela_ |
| **Permissões** | _quais roles acessam e o que cada uma pode fazer_ |

## 1. Objetivo
_Uma frase: o que o usuário consegue fazer aqui e por quê. O problema que a tela resolve._

## 2. Usuários e cenários
_Quem usa e em qual momento. 2–4 cenários reais ("Como agente, preciso…")._

## 3. Layout
_Esqueleto do `.content` com base no arquétipo. Colunas, áreas que rolam, proporções.
Liste as seções/blocos na ordem em que aparecem._

```
.content → …
└── …
```

## 4. Dados exibidos
_Tabela: campo → origem no modelo (ARQUITETURA_TECNICA.md §5) → formato (mono? pill? data relativa?)._

| Campo | Origem | Formato/observação |
|---|---|---|
| | | |

## 5. Ações
_Tabela: ação → gatilho (botão/linha/atalho) → resultado → permissão. Marque a ação primária._

| Ação | Gatilho | Resultado | Permissão |
|---|---|---|---|
| | | | |

## 6. Filtros, busca e ordenação
_Quais filtros (chips), o que a busca cobre, opções de ordenação, abas de segmento._

## 7. Regras de negócio
_Lógica que governa a tela: cálculos, condições de exibição, transições de status, limites.
Ex.: "Ticket urgente sem agente há >15min vira alerta vermelho."_

## 8. Estados
_Preencha cada um (ver `02_ESTADOS_INTERACOES.md`). Inclua o texto exato de vazio/erro._

- **Carregando:** _skeleton de…_
- **Vazio (sem dados):** _título + subtítulo + CTA_
- **Vazio (filtro):** _…_
- **Erro:** _…_
- **Sem permissão:** _…_
- **Realtime (se aplicável):** _o que atualiza ao vivo e como_

## 9. Validações
_Regras de input/ação: campos obrigatórios, formatos, confirmações destrutivas, mensagens de erro inline._

## 10. Microcópia-chave
_Os textos que não podem variar: título, rótulos de botão, mensagens. Seguir `03_CONTEUDO_VOZ.md`._

## 11. Realtime & eventos (se aplicável)
_Eventos Socket.io que afetam a tela (ARQUITETURA_TECNICA.md §7) e como a UI reage._

## 12. Métricas de sucesso (opcional)
_Como saber que a tela funciona: tempo até ação, taxa de resolução, etc._

## 13. Fora de escopo
_O que esta tela explicitamente NÃO faz (evita scope creep)._

