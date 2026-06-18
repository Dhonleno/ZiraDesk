# Tela — Login / Autenticação

| Campo | Valor |
|---|---|
| **Módulo** | Autenticação |
| **Arquétipo** | H. Autenticação (**shell próprio — sem topbar/nav-rail**) |
| **Rota** | `/login` · `/forgot-password` · `/reset-password` · `/accept-invite` |
| **Nav-rail ativo** | — (não há) |
| **Breadcrumb** | — |
| **Padrão específico** | Este PRD define o shell de autenticação, sem topbar/nav-rail, seguindo tokens globais e o arquétipo H. |
| **Permissões** | pública (não autenticada) |

## 1. Objetivo
Entrar no tenant com segurança e rapidez. É a primeira impressão do produto — precisa ser sóbria, confiável e 100% no design system.

## 2. Usuários e cenários
- **Agente/Admin:** acessa `slug.ziradesk.com.br`, faz login diário.
- **Quem esqueceu a senha:** pede redefinição por e-mail.
- **Convidado:** abre link de convite, define senha e entra (`/accept-invite`).

## 3. Layout
```
body (centralizado vertical/horizontal, bg: var(--bg))
└── .auth-card  (bg-2, --r-xl, --shadow-pop, ~400px, padding 28–32px)
    ├── logo ZiraDesk (SVG themável, centralizada)
    ├── título: "Entrar" + subtítulo: "Acesse sua conta ZiraDesk"
    ├── form
    │   ├── campo E-mail (label + input, foco teal + halo 3px)
    │   ├── campo Senha (input + toggle mostrar/ocultar)
    │   ├── link "Esqueci a senha" (à direita, pequeno)
    │   └── [Entrar] — primária teal, full-width
    └── rodapé: theme toggle discreto + nota de segurança/marca
```
Opcional: à esquerda um painel de marca (faixa sóbria com o "Z", sem gradiente colorido). Em telas pequenas, só o card.

Variações (`forgot`/`reset`/`invite`): mesmo card, troca título/campos/CTA.

## 4. Dados / campos
| Campo | Tela | Observação |
|---|---|---|
| E-mail | login, forgot | validação de formato |
| Senha | login, reset, invite | mín. 8 chars; toggle de visibilidade |
| Confirmar senha | reset, invite | precisa bater |
| Nome | invite | quando o convite não traz |
| Token | reset, invite | da URL, não exibido |

## 5. Ações
| Ação | Gatilho | Resultado |
|---|---|---|
| **Entrar** (primária) | submit | autentica (JWT + refresh httpOnly) → redireciona à última rota ou ao Inbox |
| Esqueci a senha | link | vai para `/forgot-password` |
| Enviar link de redefinição | submit forgot | "Se o e-mail existir, enviamos um link." (resposta neutra) |
| Redefinir senha | submit reset | troca senha → login |
| Aceitar convite | submit invite | cria credencial → entra no tenant |
| Mostrar/ocultar senha | ícone olho | alterna visibilidade |

## 6. Filtros/busca
Não se aplica.

## 7. Regras de negócio / segurança
- Default tema **dark**, com toggle disponível (mesmo padrão `zd-theme`).
- **Rate limiting** por IP/tenant; após N tentativas, atrito (espera/desafio) — mensagem neutra.
- **Resposta neutra** em "esqueci a senha" (não revelar se o e-mail existe).
- Senha: bcrypt no backend; mínimo 8 chars na UI (indicar força opcional).
- Tenant **suspenso/cancelado**: login bloqueado com mensagem clara ("Acesso temporariamente indisponível. Fale com o administrador.").
- Sessão expira (access 15min / refresh 7 dias); refresh em cookie httpOnly. Ver `ARQUITETURA_TECNICA.md` §10.
- Slug do subdomínio define o tenant; e-mail inexistente nele = credencial inválida.

## 8. Estados
- **Padrão:** form pronto, foco automático no e-mail.
- **Enviando:** botão "Entrar" vira loading (spinner inline + desabilita), sem travar a tela.
- **Erro de credencial:** mensagem inline acima do form, neutra: "E-mail ou senha incorretos." (não dizer qual).
- **Erro de campo:** borda red + texto 11px abaixo do input.
- **Bloqueado (rate limit):** "Muitas tentativas. Tente novamente em alguns minutos."
- **Sucesso:** transição suave para o app (sem flash de tema — anti-flash script presente).
- **Link inválido/expirado (reset/invite):** card de erro + "Solicitar novo link".

## 9. Validações
- E-mail: formato válido, obrigatório.
- Senha: obrigatória; no reset/invite mínimo 8 chars e confirmação igual.
- Submit desabilitado enquanto campos obrigatórios vazios.
- Não revelar existência de conta em nenhuma mensagem.

## 10. Microcópia-chave
- Títulos: "Entrar" · "Recuperar senha" · "Definir nova senha" · "Aceitar convite"
- Primária: "Entrar" · "Enviar link" · "Redefinir senha" · "Entrar na conta"
- Links: "Esqueci a senha" · "Voltar para o login"
- Erros: "E-mail ou senha incorretos." · "Muitas tentativas. Tente novamente em alguns minutos." · "Este link expirou."
- Forgot (sucesso): "Se houver uma conta com esse e-mail, enviamos um link de redefinição."

## 11. Realtime & eventos
Não se aplica.

## 12. Métricas de sucesso
Taxa de login bem-sucedido na 1ª tentativa, tempo até entrar, % de convites aceitos, falhas por rate-limit.

## 13. Fora de escopo
Cadastro self-service de tenant (provisionamento é via Super Admin no MVP). SSO/2FA (futuro). Recuperação por SMS.

---

> **Nota de shell:** esta é a única tela do MVP **sem** topbar e nav-rail. Ainda assim copia os tokens,
> as fontes IBM Plex, o script anti-flash e a logo themável. Nada de cores/fontes novas.

