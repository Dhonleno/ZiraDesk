# ZiraDesk — Documentação de Produto & UX

> Camada de **produto/UX** do ZiraDesk. Define **o quê** cada tela faz e **como ela se comporta**.
> Complementa — não substitui — os dois documentos de base:
> - **`docs/design/PADRAO_DE_TELAS.md`** → design system visual: tokens, tipografia, componentes, microcópia, anti-padrões.
> - **`ARQUITETURA_TECNICA.md`** (raiz) → stack, modelo de dados, API, realtime, multitenant, sprints.

---

## Como um agente de IA deve usar esta pasta

Ao receber a tarefa **"construa a tela X do ZiraDesk"**, leia nesta ordem:

1. **`00_PLAYBOOK_AGENTE.md`** — o passo a passo obrigatório. Começa e termina aqui.
2. **`docs/design/PADRAO_DE_TELAS.md`** — tokens, componentes e regras visuais globais.
3. **`telas/<Tela>.md`** — se existir um PRD da tela, ele é a fonte da verdade do comportamento e do padrão específico.
4. **`01_CATALOGO_LAYOUTS.md`** — identifique o **arquétipo** da tela X e aplique as proporções base.
5. **`02_ESTADOS_INTERACOES.md`** + **`03_CONTEUDO_VOZ.md`** — para acertar estados (vazio/erro/loading) e textos.
6. **`04_NAVEGACAO_FLUXOS.md`** — para ligar a tela às demais (breadcrumb, nav-rail, deep links).

> Se a tela X **não** tem PRD, use **`templates/TEMPLATE_REQUISITOS_TELA.md`** para escrever um antes de construir.

---

## Índice

### Fundamentos (leitura obrigatória)
| Doc | Para quê |
|---|---|
| [`00_PLAYBOOK_AGENTE.md`](00_PLAYBOOK_AGENTE.md) | Doc-mestre: o processo de construir qualquer tela nova. |
| [`01_CATALOGO_LAYOUTS.md`](01_CATALOGO_LAYOUTS.md) | Os 7 arquétipos de página e o esqueleto HTML de cada um. |
| [`02_ESTADOS_INTERACOES.md`](02_ESTADOS_INTERACOES.md) | Loading, vazio, erro, hover, skeleton, paginação, toasts. |
| [`03_CONTEUDO_VOZ.md`](03_CONTEUDO_VOZ.md) | Microcópia PT-BR: rótulos, mensagens, datas, números. |
| [`04_NAVEGACAO_FLUXOS.md`](04_NAVEGACAO_FLUXOS.md) | Mapa de navegação, breadcrumbs, fluxos entre telas. |

### Templates
| Doc | Para quê |
|---|---|
| [`templates/TEMPLATE_REQUISITOS_TELA.md`](templates/TEMPLATE_REQUISITOS_TELA.md) | Formato padrão de PRD de tela. Copie ao especificar uma nova. |

### PRDs de tela (comportamento definido)
| Tela | Arquétipo | Status build |
|---|---|---|
| [`telas/Tickets-Listagem.md`](telas/Tickets-Listagem.md) | Listagem | a construir |
| [`telas/Tickets-Detalhe.md`](telas/Tickets-Detalhe.md) | Registro/Detalhe | a construir |
| [`telas/Admin-Canais.md`](telas/Admin-Canais.md) | Configuração/Integrações | a construir |
| [`telas/Admin-Usuarios.md`](telas/Admin-Usuarios.md) | Tabela + permissões | a construir |
| [`telas/SuperAdmin-Tenants.md`](telas/SuperAdmin-Tenants.md) | Super Admin | a construir |
| [`telas/Login.md`](telas/Login.md) | Autenticação (shell próprio) | a construir |
| [`telas/Relatorios.md`](telas/Relatorios.md) | Dashboard analítico | a construir |

### Código existente
Arquivos de tela existentes podem ser consultados para entender implementação legada, APIs usadas e componentes disponíveis. Eles não são fonte de padrão visual. O padrão de uma tela deve estar registrado no PRD correspondente em `docs/design/telas/`.

---

## Princípio que rege tudo

> **Consistência > novidade.** Toda tela parte de um arquétipo e do design system existente.
> Variação é permitida no *conteúdo* e no *arranjo*, nunca nos *tokens*, na *densidade* ou na *voz*.
> ZiraDesk é uma ferramenta de trabalho operacional — densa, rápida, sóbria.

*Documento vivo — atualize ao criar novas telas ou padrões.*

