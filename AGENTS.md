# AGENTS — Regras Operacionais do Repositório

Este arquivo define regras obrigatórias para qualquer agente IA que edite este projeto.

## 1) Regra Global de UI

Antes de qualquer alteração em frontend (`apps/web/**`), o agente DEVE:

1. Ler integralmente `docs/design/PADRAO_DE_TELAS.md`.
2. Ler `docs/design/00_PLAYBOOK_AGENTE.md` e identificar o arquétipo em `docs/design/01_CATALOGO_LAYOUTS.md`.
3. Se houver PRD da tela em `docs/design/telas/`, usar esse documento como fonte de verdade comportamental e visual específica.
4. Validar estados e microcópia com:
   - `docs/design/02_ESTADOS_INTERACOES.md`
   - `docs/design/03_CONTEUDO_VOZ.md`
   - `docs/design/04_NAVEGACAO_FLUXOS.md`
5. Confirmar aderência aos tokens existentes (`apps/web/src/styles/tokens.css`).
6. Seguir o checklist "Checklist para nova tela" do documento canônico.

Arquivos de tela existentes podem ser consultados para entender implementação legada,
mas não são fonte de padrão visual. O padrão de cada tela deve estar documentado em
`docs/design/telas/*.md`.

Se houver conflito entre documentos, prevalece:

1. `docs/design/PADRAO_DE_TELAS.md`
2. `docs/design/DESIGN_SYSTEM.md`
3. `docs/design/00_PLAYBOOK_AGENTE.md`
4. `docs/design/01_CATALOGO_LAYOUTS.md`
5. `docs/design/telas/*.md`
6. `docs/design/02_ESTADOS_INTERACOES.md`
7. `docs/design/03_CONTEUDO_VOZ.md`
8. `docs/design/04_NAVEGACAO_FLUXOS.md`
9. `ARQUITETURA_TECNICA.md`

## 2) Restrições de Implementação Visual

- Não inventar cores, tipografia, espaçamento, sombras ou estrutura fora do padrão canônico.
- Não usar fontes fora de IBM Plex Sans / IBM Plex Mono para UI.
- Não hardcodar hex fora dos tokens quando existir equivalente em variável CSS.
- Não permitir rolagem da página inteira em telas autenticadas; a rolagem deve ocorrer nas áreas internas.

## 3) Checklist mínimo antes de finalizar PR/patch de UI

- Topbar + nav rail no padrão.
- Tema dark/light preservado e toggle funcional.
- Estados de foco/hover visíveis.
- Estados vazios contemplados.
- Microcópia em PT-BR.

## 4) Atualização de documentação obrigatória

Vale para qualquer sessão de implementação — frontend, backend ou infra —, não só UI.

Ao final de uma sessão que adicionar funcionalidade, corrigir bug relevante, alterar
arquitetura/modelo de dados, ou tocar em segurança/infraestrutura de produção, o agente DEVE:

1. Adicionar uma entrada em `docs/technical/CHANGELOG.md` (topo do arquivo, acima da versão
   anterior), seguindo o formato existente (`### Adicionado`/`### Alterado`/`### Corrigido`/
   `### Removido`/`### Documentação`, e `### Segurança / Infraestrutura` quando aplicável).
2. Se a sessão alterou modelo de dados, endpoints, motor de roteamento, ou qualquer decisão
   estrutural documentada em `ARQUITETURA_TECNICA.md`, atualizar as seções afetadas.
3. Se a sessão resolveu ou identificou um item de dívida técnica, atualizar `ARQUITETURA_TECNICA.md`
   §16 — marcar itens resolvidos (`~~item~~ — ✅ Resolvido: ...`) e registrar novos itens
   encontrados, mesmo que não corrigidos nesta sessão (documentar > fingir que não existe).
4. Nunca declarar um bloqueador/dívida como "resolvido" se a correção for parcial ou mitigação —
   registrar o estado real (ex.: "mitigado parcialmente", "fechado o vetor X, gap Y permanece").
