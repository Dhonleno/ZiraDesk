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
