# AGENTS — Regras Operacionais do Repositório

Este arquivo define regras obrigatórias para qualquer agente IA que edite este projeto.

## 1) Regra Global de UI

Antes de qualquer alteração em frontend (`apps/web/**`), o agente DEVE:

1. Ler integralmente `docs/design/PADRAO_DE_TELAS.md`.
2. Validar o layout base com uma tela de referência canônica:
   - `Omnichannel - Modais.html`
   - `Clientes.html`
   - `Monitor.html`
3. Confirmar aderência aos tokens existentes (`apps/web/src/styles/tokens.css`).
4. Seguir o checklist "Checklist para nova tela" do documento canônico.

Se houver conflito entre documentos, prevalece:

1. `docs/design/PADRAO_DE_TELAS.md`
2. `docs/design/DESIGN_SYSTEM.md`
3. `ARQUITETURA_TECNICA.md`

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
