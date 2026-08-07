# Changelog — ZiraDesk

## [0.10.33] — Resolução dinâmica de upstream no nginx (§16 dívida B — correção aplicada, verificação em produção pendente)

### Segurança / Infraestrutura
- **`resolver 127.0.0.11 valid=10s ipv6=off` nos 5 server blocks `:443` de `deploy/nginx/conf.d/ziradesk.conf`** (commits `c70c7b3` e `3a4c6dd`). Os 3 blocos `upstream` nomeados foram removidos e os 13 `proxy_pass` passaram a `http://$backend_*$request_uri`, com `set $backend_*` declarado por server. Endereça a dívida B da §16: upstream nomeado resolve o hostname **uma única vez, na carga da config**, então um container recriado fora de um deploy (OOM, crash, reboot do host) deixava o nginx apontando para IP morto até o próximo deploy — silenciosamente, porque `/` seguia sendo servido por `web`/`marketing`. Provado em ambiente isolado (`nginx:1.27-alpine`, A/B contra a config antiga): IP do `api` de `172.26.0.2` para `172.26.0.7` **sem reload** → config nova `200` nas 9 locations de API, config antiga `502` nas mesmas 9. **Ainda não verificado em produção** — as três pendências estão na §16.
- **Incidente `502` de ~7 minutos causado por `c70c7b3`, e o mecanismo que o explica.** O `resolver` foi colocado em `nginx.conf` e **não foi relido pelo `nginx -s reload`**: `conf.d` é bind mount de **diretório** e reflete o `git pull`, mas `nginx.conf` é bind mount de **arquivo único**, preso ao inode original — e o `git pull` substitui o arquivo em vez de editá-lo. O nginx passou a usar o `ziradesk.conf` novo contra um `nginx.conf` velho sem `resolver`; `error.log` com `no resolver defined to resolve web/api/marketing` e `/etc/resolv.conf` correto em `127.0.0.11`, ou seja, o DNS estava certo. Diferente do incidente original da 0.10.32, os **três** upstreams caíram juntos, `/` inclusive, sem mascaramento pelo front. Rollback com `git checkout a767b80 -- deploy/nginx/` + reload; corrigido em `3a4c6dd`. **Lição que generaliza:** mount de arquivo único fica obsoleto quando o arquivo é substituído no host.
- **`deploy-contabo.yml`: nginx recriado com `--force-recreate --no-deps` em todo deploy**, em comando separado do `up -d` dos demais serviços — juntos, o `--force-recreate` recriaria todos. É esse passo que refaz o mount de arquivo e garante releitura do `nginx.conf`.
- **Smoke test do deploy passou a atravessar a borda.** O probe anterior rodava `wget` dentro do container `api` contra `127.0.0.1:3333` e portanto **não podia detectar falha de roteamento** — foi por isso que o deploy do incidente terminaria verde com a borda inteira em `502`. O novo step verifica `api.ziradesk.com/health`, `app.ziradesk.com/` e `ziradesk.com/`: um probe por upstream.

### Documentação
- `docs/technical/DEPLOY_VPS_DOCKER_COMPOSE.md`: nova seção "Resolução dinâmica de upstream no Nginx" com verificação pós-deploy, cobertura das 3 locations do portal (não testáveis de fora, por o certificado da Cloudflare não cobrir dois níveis de subdomínio), prova de fechamento com canário no `marketing` antes do `api`, comando de recuperação, e as armadilhas medidas (`/api/health` retorna `404` e isso é sinal de saúde; `sleep 12` não basta contra o `start_period: 20s`; `</dev/null` obrigatório em `exec -T`).
- `docs/technical/DEPLOY_VPS_DOCKER_COMPOSE.md`: comando de deploy manual corrigido para incluir `marketing`, que faltava desde o fix aplicado apenas ao workflow na 0.10.32 — quem seguisse o doc buildava o serviço e nunca o subia, em silêncio.
- `ARQUITETURA_TECNICA.md` §16: dívida B atualizada com o incidente, o mecanismo de mount de arquivo único, o achado do smoke test que não atravessava o nginx, e as três pendências que faltam para fechá-la.

## [0.10.32] — Registry global de `phone_number_id` e Fase 1 do roteamento canônico

### Adicionado
- **`public.channel_registry` — unicidade global de `phone_number_id` entre tenants** (commit `a771068`). O modelo schema-per-tenant não permite `UNIQUE` cross-schema, e o valor vive cifrado (AES-CBC com IV aleatório) dentro de `"<schema>".channels.credentials`, invisível para qualquer constraint SQL. A tabela em `public`, com PK em `phone_number_id`, torna a unicidade dura. A escrita de canal passa a reivindicar o número **na mesma transação por request** aberta em `tenantSchemaFromJwt`: `ON CONFLICT` reconcilia reconexão do mesmo tenant (atualiza `channel_id`), e rejeita tenant diferente com rollback + `409 CHANNEL_NUMBER_ALREADY_REGISTERED` ("Este número já está conectado a outro tenant", sem revelar qual). `rowCount = 0` no `ON CONFLICT` é tratado como **rejeição explícita, nunca sucesso silencioso** — é o ponto em que a proteção vive ou morre. Cobre `createChannel` e `updateChannel` (que também libera o número anterior quando o canal troca de número, evitando reivindicação órfã apontando para canal que já não atende aquele número). FK `tenant_schema → tenants(schema_name)` com `ON DELETE CASCADE` é estrutural, não cosmética: sem ela, remover um tenant deixa a reivindicação órfã e o número fica reservado para sempre a um tenant inexistente — comportamento descoberto pela suíte de integração em segunda execução. Backfill idempotente (`ON CONFLICT DO NOTHING`) com abort em colisão cross-tenant; aplicado em produção com **1 número registrado, 1 canal pulado (credenciais vazias), 0 colisões**.
- **Fase 1 do roteamento canônico Grupo → Assunto — schema puramente aditivo** (commit `49a4fdf`). Cinco tabelas novas por tenant: `routing_groups`, `subjects`, `agent_groups`, `routing_group_skills`, `subject_skills` (taxonomia canônica + vínculo agente↔grupo + skills pertencentes à taxonomia, não ao menu). `bot_options.subject_id` transforma o menu em adaptador de navegação referenciando a taxonomia. `conversations` ganha 9 colunas de classificação (`initial_*`/`current_*` de assunto e grupo, `classification_source`/`_at`/`_updated_at`, `routing_hold_reason`/`_since`) e 2 CHECKs de pareamento — todas nullable, com as 5 colunas de roteamento legado (`bot_option_id`, `department_id`, `routing_used_skill_id`, `routing_started_at`, `queue_entered_at`) **intocadas**. `ON DELETE`: `RESTRICT` nas FKs de histórico/fronteira, `CASCADE` nas junções de configuração (precedente de `bot_option_skills`). DDL de fonte única via `ensureCanonicalRoutingInfrastructure` (idempotente, `IF NOT EXISTS`, CHECKs guardados por `pg_constraint` porque o Postgres 16 não suporta `ADD CONSTRAINT IF NOT EXISTS`), registrada em `provisionTenantSchema`. Sem espelho em `createTenantTables`: essa função tem **um único call site** — a própria `provisionTenantSchema` — então tenant novo e tenant retrofitado executam exatamente o mesmo DDL, o que satisfaz a regra AGENTS.md §5 sem duplicar definição; espelhar quebraria a ordem de FK (`bot_options.subject_id` referencia `subjects`, criada depois) e reintroduziria a classe de divergência do `tenant_voice_config`. Aplicado nos 3 tenants de produção (`Migrados=3 Erros=0`), com idempotência comprovada por hash de schema idêntico entre execuções. Nenhum dado migrado — a Fase 1 é estrutural.

### Segurança / Infraestrutura
- **Incidente `502` durante o deploy da Fase 1, com escopo maior do que aparentava.** Por ~4 minutos todas as 9 locations do upstream `ziradesk_api` ficaram fora — todo `/api/` e `/socket.io/` de todos os domínios, incluindo painel de todos os tenants e webhook da Meta —, mascarado pelo front continuar `200` (servido por `ziradesk_web`/`ziradesk_marketing`). **A causa não foi o `deploy-contabo.yml`**, que já executa `nginx -t` + `nginx -s reload` + smoke test de `/health` após o `up -d` desde `1d1cd14`: o deploy foi rodado manualmente via SSH (o GitHub Actions não disparava para o commit) e o script foi transcrito truncado, omitindo justamente essas linhas. Sem reload, o nginx manteve o IP antigo do container `api`. Corrigido com reload manual. Detalhe registrado em `ARQUITETURA_TECNICA.md` §16, junto do gotcha de `docker compose exec -T` sem `</dev/null` consumir o stdin do script chamador — e da dívida residual: o reload cobre o gatilho *deploy*, mas não recriação fora de banda (`restart: unless-stopped`).

- **GitHub Actions deixou de criar run para push em `main`, sem diagnóstico.** Nenhum run foi enfileirado para `49a4fdf` (`total_count: 0`) apesar de `main` apontar para o commit e ambos os workflows estarem `active`; o `workflow_dispatch` manual disparou mas foi `cancelled` em 15 minutos sem que o script remoto chegasse ao `git fetch`. Foi essa anomalia que forçou o deploy manual via SSH — e portanto a causa indireta do `502` acima. Logs do run não puderam ser lidos (exigem token autenticado). Registrado em `ARQUITETURA_TECNICA.md` §16 como dívida aberta, com hipóteses em aberto, as verificações já descartadas na VPS e o contorno (replicar o script **completo** do deploy, nunca um recorte).

### Documentação
- `ARQUITETURA_TECNICA.md` §16: incidente `502` registrado como resolvido, com ênfase em **não** "corrigir" o workflow de deploy (que está certo); nova dívida `[MÉDIO]` para a correção estrutural do cache de IP de upstream (`resolver` + `proxy_pass` com variável por location, cobrindo os 3 upstreams); e nova dívida `[MÉDIO]` para o CI/CD que parou de disparar workflows.

## [0.10.31] — Segunda causa raiz do incidente de canal WhatsApp: escopo do token

### Corrigido
- **Configuração de canal WhatsApp em produção concluída com sucesso.** Fechada a segunda causa raiz da mesma investigação aberta na 0.10.30: além do `WHATSAPP_VERIFY_TOKEN` vazio, o Access Token do tenant não tinha o escopo `whatsapp_business_management` no Meta Business Manager. A correção foi ajuste de escopo no console da Meta — **ação externa, sem commit associado**.
- **Padrão de diagnóstico registrado:** `OAuthException` código `100` sem `error_subcode` e com mensagem genérica `Authorization Error` no passo `waba_fields` indica escopo ausente no token ou WABA não atribuído ao usuário de sistema, não credencial incorreta. O token passava em `debug_token` (valida existência, não escopos) e em `app_subscriptions` (autentica com credencial de app, não do tenant), o que mascarava a origem.

### Adicionado
- **Logging estruturado por passo nas chamadas à Meta Graph API** (commit `6ac4409`), cobrindo `debug_token`, `app_subscriptions`, `waba_fields`, `phone_numbers`, `subscribed_apps`, `phone_webhook_config` e `phone_webhook_verify`, com `type`, `code`, `error_subcode` e `fbtrace_id` da Meta. Foi o que permitiu isolar o passo exato e separar as duas causas. Permanece no código como ferramenta de diagnóstico para onboarding de tenants futuros; não expõe credenciais.

## [0.10.30] — Fechamento do incidente WhatsApp Meta #194

### Segurança / Infraestrutura
- **Incidente de configuração do WhatsApp em produção fechado.** A causa raiz era `WHATSAPP_VERIFY_TOKEN` vazio em `apps/api/.env.production`: o schema de env exigia a variável como string, mas aceitava string vazia, então a API subia e a falha só aparecia ao salvar canal WhatsApp, quando a Meta Graph API rejeitava a configuração do webhook com `#194` por receber `callback_url` com `verify_token` vazio.
- **Token preenchido em produção sem exposição do valor** e callback público validado: a verificação `GET /api/webhooks/whatsapp` com `hub.mode=subscribe` e o token carregado do próprio `.env.production` passou de `403` para `200`.
- **Gotcha operacional documentado:** `docker compose restart api` não recarrega valores vindos de `--env-file`; a correção só entrou no runtime depois de recriar o container com `docker compose --env-file .env.production -f docker-compose.production.yml up -d --force-recreate --no-deps api`.
- **Lacuna de proteção de secrets fechada:** `.env.production` na raiz e em `apps/api/` estavam não rastreados, mas sem cobertura de `.gitignore`. A busca no histórico (`git log --all --full-history`) não encontrou commit desses arquivos, então não houve vazamento confirmado. O `.gitignore` agora cobre `.env.production*` e `.env.development*`, mantendo `.example` rastreável.
- **Arquivo órfão removido do servidor:** `apps/api/.env.production.save`, resíduo da migração de 2026-08-02, sem referência em scripts/docs e diferente do `.env.production` atual. O backup válido criado durante o atendimento (`apps/api/.env.production.bak-20260804-203426`) foi mantido.

## [0.10.29] — Blocos CRM 360 e tickets no showcase da landing

### Adicionado
- **Showcase da landing expandido com blocos subordinados de CRM 360 e tickets**, ainda dentro de `#showcase`, após a demonstração por abas. Os títulos novos usam `h3`, preservando o `h2` existente para a demonstração de canais.
- **Bloco CRM 360** com texto e card de contato da persona fictícia `Ana Paula Lima`, incluindo e-mail e telefone mascarados e chips neutros de perfil.
- **Bloco Tickets** com quadro kanban de três colunas (`Aberto`, `Em andamento`, `Resolvido`), contadores e cards com número, título, cliente fictício e prioridade.
- **`--amber` reintroduzido no `:root` com `#F59E0B`** para o badge de prioridade `Média`; o fundo tonal usa `color-mix()`, sem adicionar `--amber-dim`.

### Verificação
- Overflow medido em iframe real para 1440, 860, 640, 390 e 320px: `scrollWidth == clientWidth` em todos, sem elementos transbordantes. Screenshots gerados em 1440 e 375px cobrindo CRM e Tickets completos. Busca por nomes de teste reais retornou zero ocorrência; não há `@keyframes`, `animation`, `setInterval` ou `setTimeout`.

## [0.10.28] — Showcase interativo por canais na landing

### Adicionado
- **Seção showcase entre Pilares e Como funciona**, demonstrando a mesma cliente fictícia (`Ana Paula Lima`) entrando por WhatsApp, Instagram e e-mail. A seção usa abas manuais, sem autoplay e sem animação contínua.
- **Mockup de conversa reaproveitando as classes do hero** (`.mock-chat`, `.mock-head`, `.mock-avatar`, `.mock-badge`, `.mock-messages`, `.mock-bubble`, `.mock-input`), sem repetir a moldura de navegador. O wrapper externo usa `.card`.
- **Cores de canal finalmente consomem os tokens já declarados**: `--wa`, `--ig` e `--em` nos estados ativos das abas e nas variantes `.badge-wa`, `.badge-ig` e `.badge-em`.

### Verificação
- Cliques validados nos três canais: badge, cor ativa e mensagem mudam; nome e avatar permanecem estáveis. Screenshots gerados em 1440, 860 e 375px, com canais diferentes ativos. Overflow medido em iframe real para 1440, 860, 640, 390 e 320px: `scrollWidth == clientWidth` em todos.

## [0.10.27] — Hero da landing recriado em HTML/CSS

### Alterado
- **Hero da landing deixou de depender do screenshot estático como superfície visual principal.** A moldura de navegador existente foi preservada, mas a tag `<img src="/product-screenshot.png">` foi substituída por um mockup HTML/CSS de duas áreas: conversa aberta e painel de contato.
- **Persona fictícia padronizada no mockup:** o exemplo usa `Ana Paula Lima`, sem nomes ou e-mails reais de massa de teste. O painel mostra estado `Aberto`, duas bolhas de conversa e métricas resumidas do contato.
- **Responsividade mantida nos breakpoints existentes.** Abaixo de 860px o mockup empilha conversa e contato, evitando overflow dentro da moldura; abaixo de 640px os espaçamentos e métricas reduzem para preservar leitura em viewport estreito.

### Verificação
- Validação responsiva em iframe real para 1440, 860, 640, 390 e 320px: `scrollWidth == clientWidth` em todas as larguras, sem elementos transbordantes. Busca por nomes de teste reais retornou zero ocorrência.

## [0.10.26] — Revisão jurídica da Política de Privacidade concluída

### Corrigido
- **Revisão jurídica da Política de Privacidade concluída por advogado**, conforme confirmação do responsável pelo projeto. Era a última trava de publicação registrada: a pendência foi aberta na 0.10.23, mantida explicitamente na 0.10.25 e está riscada nas duas entradas apontando para cá. **Nenhuma alteração no texto da política acompanha este commit** — o documento segue exatamente como ficou na 0.10.25; o que muda é o status da revisão.
- Comentário no topo de `privacidade.html` atualizado de `ATENÇÃO: ... ainda PENDENTE antes de publicação` para o registro de conclusão. O aviso deixa de ser um bloqueio e passa a ser rastro: quem abrir o arquivo continua sabendo quando os dados foram preenchidos e que a revisão existiu.
- **Com isso a landing fica liberada para produção.** O pacote é indivisível e sai junto: `index.html` (faixa de confiança, footer LGPD, correção do header móvel) e `privacidade.html` completa, com o link do footer já apontando para ela.

### Verificação
- Este é o commit que precede o primeiro `push` desta série. `push` para `main` dispara o workflow **CI** e, na conclusão bem-sucedida dele, o **Deploy Contabo** por `workflow_run` — ou seja, a publicação em produção é encadeada automaticamente, não é um passo manual posterior. Registrado aqui porque cinco commits sobem de uma vez e a landing muda de conteúdo no apex no mesmo ato.
- Commits publicados nesta leva: `ac1d340` (faixa de confiança + footer LGPD), `59e6b72` (Política de Privacidade), `2006260` (colisão do header em viewport móvel), `d09aa09` (dados reais do controlador) e este.

## [0.10.25] — Dados reais do controlador na Política de Privacidade

### Corrigido
- **Os 5 placeholders da Política de Privacidade foram preenchidos com dado real**, fechando a pendência aberta na 0.10.23: razão social (AXLO TECNOLOGIA LTDA), CNPJ, endereço da sede, e-mail do Encarregado e data de publicação (04/08/2026). `grep "\[\["` no arquivo retorna **0**.
- **Tratamento tipográfico revisto conforme o papel de cada dado.** CNPJ e data ficaram em IBM Plex Mono, consistente com a convenção do design system para identificadores e timestamps; razão social, endereço e e-mail voltaram a texto corrido. O destaque em âmbar existia apenas para sinalizar lacuna — preenchido, o dado é texto legal comum, e mantê-lo em cor de alerta sugeriria um problema onde não há mais.
- **O peso da fonte Mono foi fixado em 500 explicitamente** na classe nova. A página declara **somente** a face IBM Plex Mono 500; sem o `font-weight` explícito o texto cairia em peso 400, sem `@font-face` correspondente, e o navegador sintetizaria a fonte.
- **`--amber` e `--amber-dim` removidas do `:root`** da página, junto com a regra `.ph` e sua contraparte no bloco de 640px. Confirmado antes de remover que não restava nenhum uso — `grep -i amber` retorna **0**.
- **E-mail do Encarregado agora é `mailto:`.** É o canal por onde o titular exerce os direitos do Art. 18 e o único endereço acionável do documento; deixá-lo como texto inerte transferia ao leitor o trabalho de copiar à mão o caminho que a própria política oferece. Sem classe própria — herda o `--teal` dos demais links da página.

### Pendente
- ~~**A revisão jurídica por advogado segue em aberto e NÃO é resolvida por este commit.** Este preenchimento tratou apenas dos dados do controlador; o enquadramento das bases legais — em particular o legítimo interesse invocado para a captação de leads — continua sendo decisão jurídica, não de engenharia. O aviso permanece no comentário do topo de `privacidade.html`, agora reescrito para refletir que os placeholders foram resolvidos e que só esta trava resta.~~ — ✅ **Resolvido na 0.10.26.**
- **A natureza da trava de publicação mudou, e isso importa.** Antes ela era mecânica: campos vazios em âmbar, impossíveis de publicar por engano sem notar. Agora é de julgamento, e **nada no arquivo renderizado impede alguém de publicar sem ter lido o comentário HTML**. Quem for ao deploy precisa saber disso por este registro, não pela página.
- Seguem válidos da 0.10.23: o `index.html` e a `privacidade.html` formam um pacote de deploy indivisível (o footer já linka a página), e *Termos de Uso* (`/termos`) continua como `href="#"`, tarefa futura separada.

### Verificação
- `grep "\[\["` → 0; `grep 'class="ph"'` → 0; `grep -i amber` → 0. Os cinco valores conferidos um a um nas posições certas: data no cabeçalho de metadados, os três dados do controlador na seção 1, e-mail na seção 10.
- Renderização conferida em 760px e 320px: CNPJ e data em Mono, demais dados em prosa, sem resquício do destaque âmbar, sem transbordo horizontal na largura mínima. O `mailto:` renderiza em `--teal`, sem sublinhado em repouso, com o ponto final da frase fora do link — mesmo tratamento dos demais `<a>` do documento.
- Achado lateral **não corrigido**, registrado para não se perder: `404.html` tem o mesmo defeito de peso que foi evitado aqui — `.code` usa `var(--mono)` sem `font-weight` e a página declara apenas Mono 500, então aquela fonte está sendo sintetizada. Correção de uma palavra, fora do escopo deste commit.

## [0.10.24] — Colisão do header da landing em viewport móvel

### Corrigido
- **O header da landing colidia em praticamente todo telefone em uso.** Defeito pré-existente da 0.10.20, registrado como pendência na 0.10.23 e fechado aqui. Sintoma: o wordmark e o link *Entrar* se encostavam sem separação (`ZiraDeskEntrar`), o CTA quebrava em duas linhas — saltando de 38px para **61px de altura dentro de uma barra de 64px** — e transbordava a borda direita, recortado em silêncio pelo `overflow-x: hidden` do `body`.
- **Mecanismo, medido antes de corrigir.** O `.nav` era `display: flex` com `justify-content: space-between` e **sem `gap`**: a separação entre marca e ações era feita exclusivamente de espaço livre, então zerava junto com ele. Sem `flex-wrap`, nada ia para uma segunda linha. Itens flex têm `min-width: auto`, e como `.brand` (117px) e `.link-login` (40px) não têm ponto de quebra, o único elemento elástico era o CTA, que comprimia de 181px até o min-content de 123px quebrando o rótulo em duas linhas. Somados `padding` de 48px + 117 + 237, o header exigia **~402px** para não colidir — acima de iPhone SE/8 (375), iPhone 12–15 (390) e da maioria dos Androids. **Nenhuma media query tocava o header**: os dois blocos responsivos existentes cobriam apenas grids de conteúdo e footer.
- **Correção em quatro regras, todas dentro do breakpoint de 640px já existente** — nenhum breakpoint novo: `gap: 16px` no `.nav`, criando um piso de separação que não depende de sobra; `white-space: nowrap` no `.btn-sm`, impedindo a quebra em duas linhas; `.link-login { display: none }` abaixo de 640px, deixando só o CTA primário; e rótulo curto no CTA abaixo de 640px.
- **`white-space: nowrap` foi aplicado ao `.btn-sm`, não ao `.btn` base.** `.btn-sm` é usado apenas no header e no banner de cookie (rótulos curtos); o `.btn` base cobre também o submit do formulário, que é `width: 100%` dentro de um card com 32px de padding e **depende da quebra de linha para caber no mobile** — `nowrap` ali teria criado um transbordo novo no lugar do corrigido.
- **Rótulo curto por dois `<span>` no mesmo `<a>`**, alternados por CSS (`.cta-full` / `.cta-short`), sem JS e sem duplicar o botão. Mantém um único elemento âncora — um destino, um foco de teclado — e, como `display: none` remove o conteúdo da árvore de acessibilidade, o leitor de tela anuncia "Agendar" no mobile e "Agendar demonstração" no desktop, nunca dois CTAs.

### Verificação
- **Primeira tentativa reprovou e a medição pegou.** Com apenas `nowrap` + ocultar *Entrar*, o CTA ficou congelado em 181px e criou um piso rígido de **362px** (48 + 117 + 16 + 181): ocultar *Entrar* devolvia 56px, mas travar o botão custava 58. O resultado **regrediu** nas larguras extremas — `scrollWidth` a 305px subiu de 320 (antes) para 338 (depois) —, ainda transbordando em Galaxy S8–S10 (360px) e iPhone SE 1ª geração (320px). O rótulo curto derrubou o CTA para 85px e o piso para **266px**.
- Geometria conferida em 700, 655, 641, 640, 430, 390, 375, 360, 320, 305 e 280px, com viewport real por `<iframe>`. Abaixo de 640: *Entrar* oculto, CTA renderizando 85px (`.cta-full: none` / `.cta-short: block` confirmados no `display` computado), **altura estável em 38px** e `scrollWidth == clientWidth` em todas — inclusive 280px, com 16px de folga sobrando. Em 641px e acima o header é idêntico ao anterior: *Entrar* visível, CTA de 181px com rótulo completo, mesma folga marca↔ações do `HEAD` em cada largura.
- Um resíduo de **1px** (`scrollWidth` 686 contra `clientWidth` 685) aparece em 700px, mas é **idêntico no `HEAD`** e nenhum elemento excede a borda — arredondamento subpixel pré-existente, não introduzido aqui.
- Escopo: **um arquivo, só CSS e o rótulo do CTA**. `privacidade.html`, `404.html`, nginx e o restante do repositório intocados.

## [0.10.23] — Política de Privacidade da landing (LGPD)

### Adicionado
- **`apps/marketing/public/privacidade.html`** — página institucional em 11 seções cobrindo o tratamento de dados pessoais **do site**, com escopo explicitamente separado do tratamento **dentro da plataforma** (dados dos clientes dos tenants), que é regido por instrumento contratual próprio. Cobre a coleta real da landing, não uma genérica: o formulário de demonstração (`POST /api/leads` — `name`, `company`, `email`, `phone`, `message`, com apenas nome e e-mail obrigatórios) e o Google Analytics carregado somente após consentimento. **Bases legais declaradas**: legítimo interesse (Art. 7º, IX) para os dados do formulário; consentimento (Art. 7º, I) para os cookies analíticos. Direitos do titular do Art. 18 enumerados na seção 7, com canal do Encarregado na seção 10.
- **Operadores divulgados**: Google (Google Analytics, mediante consentimento), Cloudflare (DNS, entrega e segurança do site), Contabo (hospedagem da infraestrutura) e Resend (envio de e-mails). A lista foi conferida contra o repositório antes de ser afirmada — Cloudflare como DNS/HTTPS de borda (`ARQUITETURA_TECNICA.md:56,1194`), Contabo como origem do VPS onde `public.leads` persiste, e Resend em `apps/api/src/services/email.service.ts`. O domínio citado no documento é **ziradesk.com**, conforme `server_name` em `deploy/nginx/conf.d/ziradesk.conf:147` e o `og:url` da landing — não `ziradesk.com.br`, que sobrevive apenas em `.env.example` e docs de design.
- **Link do footer conectado**: o item *Política de Privacidade* saiu de `href="#"` para `/privacidade.html`. Extensão explícita porque o `try_files $uri $uri/ =404` do `nginx.default.conf` não faz mapeamento sem extensão — `/privacidade` devolveria 404 real. *Termos de Uso* e *Contato* seguem em `#`.
- Moldura visual seguindo o padrão do `404.html`: HTML único com CSS inline, IBM Plex self-hosted (5 `@font-face`, só os pesos usados), subset de 10 CSS vars. Sem `noindex` — ao contrário do 404, a política deve ser indexável. `--amber`/`--amber-dim` importados com os valores canônicos de `apps/web/src/styles/tokens.css:31-32` para destacar os placeholders. Referências cruzadas a "seção 10" viraram âncoras internas, sem alterar uma palavra do texto.

### Pendente
- ~~**A página NÃO pode ir a produção enquanto os 5 placeholders não forem preenchidos com dado real**: `[[RAZÃO SOCIAL]]`, `[[CNPJ]]`, `[[ENDEREÇO]]`, `[[E-MAIL DO ENCARREGADO]]` e `[[DATA DE PUBLICAÇÃO]]`. Estão renderizados em âmbar sobre fundo âmbar, em IBM Plex Mono, deliberadamente impossíveis de ignorar — um documento de identificação do controlador com lacuna visível é pior que documento nenhum.~~ — ✅ **Resolvido na 0.10.25.**
- ~~**Revisão jurídica pendente antes de produção.** Registrado também como comentário no topo do arquivo. O enquadramento do legítimo interesse para captação de leads, em particular, é decisão jurídica e não de engenharia.~~ — ✅ **Resolvido na 0.10.26.**
- **O link do footer já aponta para `/privacidade.html`, logo o `index.html` não pode ser publicado sem a página completa** — publicar só o index produz 404 no item Política de Privacidade; publicar com placeholders expõe documento legal incompleto. Os dois arquivos são um pacote de deploy indivisível.
- **Termos de Uso (`/termos`) segue como `href="#"`** — página não existe, tarefa futura separada. O `TODO` no HTML do footer permanece válido para ela.
- ~~Fora do escopo desta entrega, registrado por ter sido encontrado durante a validação: **o header da landing colide em viewport móvel** — a 375px o wordmark e o link *Entrar* se sobrepõem e o `btn-primary` invade a borda; `scrollWidth` 320 contra `clientWidth` 305 a 320px, com `DIV.nav-actions` e `A.btn-primary` como elementos transbordantes. Defeito pré-existente da 0.10.20, não introduzido aqui.~~ — ✅ **Resolvido na 0.10.24.**

### Verificação
- `/privacidade.html` → 200, `/` → 200, `/termos.html` → **404** (correto — a página não existe e o link não aponta para ela). Os 5 placeholders presentes e únicos após as correções factuais; `grep ziradesk.com.br` → **0**. As 5 referências de `@font-face` conferidas uma a uma contra `public/fonts/`.
- **Correção de método na validação responsiva.** As medidas de "320px" e "390px" reportadas na 0.10.22 não mediram o que diziam: o Chrome headless desta máquina **clampa o viewport em 489 CSS px**, e `--window-size` menor apenas recorta a imagem, sem reflow. Refeito medindo dentro de `<iframe>`, que dá viewport real ao documento interno. Nos valores corretos: `privacidade.html` tem `scrollWidth == clientWidth` a **375px e 305px**, sem nenhum elemento transbordante; `index.html` acusa 15px de overflow a 305px, rastreado até o header (ver Pendente). A conclusão da 0.10.22 sobre faixa e footer se manteve — ambos empilham corretamente —, mas o "sem overflow a 320px" afirmado lá valia para 489px e foi retificado aqui.

## [0.10.22] — Faixa de confiança e footer LGPD reestruturado na landing

### Adicionado
- **Faixa de confiança** acima do footer (`.trust`, fundo `--bg-2`), com três selos — *Feito no Brasil*, *Conforme LGPD*, *Sem fidelidade* — em `grid-template-columns: repeat(3, 1fr)`, colapsando para coluna única aos 640px. Ícones SVG inline stroke-only (`stroke-width="1.4"`, `fill="none"`, `currentColor` herdando `--teal`), sem biblioteca de ícones e sem emoji: bandeira, escudo-com-check e porta-de-saída.
- **Footer reestruturado** de faixa única (marca + 3 links + copyright em uma linha) para grid de três colunas — marca `2fr` / Produto / Legal —, com fundo `--bg-3`. Antes era transparente sobre `--bg` e se dissolvia no fim da página; o `--bg-3` cria separação real do conteúdo, mantido o `border-top` em `--line`. Coluna *Produto* com âncoras internas (Recursos, Como funciona, Demonstração) mais o *Entrar* que já existia no footer antigo; coluna *Legal* com Política de Privacidade, Termos de Uso e Contato. Aos 860px vira duas colunas com a marca ocupando a linha inteira — sem isso a coluna `2fr` esmagaria as outras duas na faixa de 640–860px; aos 640px, coluna única.
- **`id="como-funciona"`** na `<section class="how">`, que não tinha âncora — as únicas da página eram `#pilares` e `#demo`, e a coluna *Produto* precisava de um terceiro destino. Nome em uma palavra, alinhado às existentes. A classe `.how` não é referenciada por JS (aparece só na própria regra CSS), então o atributo não teve efeito colateral.

### Corrigido
- **Reprovação de contraste AA no copyright do footer, pré-existente.** O texto usava `--txt-3` (`#5C6370`), que sobre o `--bg` (`#0E0F11`) da composição anterior dava **3.2:1** — abaixo do mínimo de **4.5:1** do WCAG AA para texto normal. Sobre o `--bg-3` (`#1A1C20`) do footer novo cairia para **2.8:1**, agravando a falha. Trocado para `--txt-2` (`#9DA3AE`): **6.7:1**. A dívida vinha da 0.10.20 e foi encontrada ao recalcular os contrastes da superfície nova, não reportada por ferramenta.

### Verificação
- Renderização conferida em **Chrome headless** nos quatro breakpoints — **1440, 800, 390 e 320px** —, com a faixa e o footer isolados num arquivo temporário que oculta o conteúdo acima (o layout dos dois é width-driven e não depende dos irmãos anteriores, então o que renderiza é o real). Sem overflow horizontal a 320px; o copyright cabe em uma linha na largura mínima.
- Duas correções de alinhamento saíram dessa validação, não da leitura do código. A primeira versão da faixa usava `flex-wrap` e quebrava **2+1** aos 800px, com o terceiro selo órfão e centralizado — daí a troca para grid de 3 colunas fixas. O grid então expôs o problema seguinte: com descrições de 1 e 2 linhas convivendo na mesma linha, `align-items: center` desalinhava verticalmente o terceiro selo, e `align-items` centrado no item desalinhava os ícones entre si. Resolvido com `align-items: start` no grid e `flex-start` no item, que travam títulos e ícones na mesma base independentemente de quantas linhas a descrição ocupe.
- Escopo confinado a `apps/marketing/public/index.html` — um único arquivo alterado. `apps/api/`, `apps/web/`, `deploy/` e a config do nginx intocados. Nenhuma dependência adicionada; a landing segue HTML/CSS/JS puro, sem terceiros.

### Pendente
- *Política de Privacidade* e *Termos de Uso* apontam para `href="#"` — as páginas `/privacidade` e `/termos` não existem, marcado com `TODO` no HTML. **O selo "Conforme LGPD" da faixa é uma afirmação que a landing ainda não sustenta**: a mesma página coleta dado pessoal por dois caminhos — o formulário de leads (`POST /api/leads`, campos `name`/`company`/`email`/`phone`/`message`) e o Google Analytics pós-consentimento. Redigir a política é a tarefa imediatamente seguinte e destrava os dois links.
- CNPJ do bloco inferior reservado como comentário preenchível, com o `<p class="footer-cnpj">` já escrito e estilizado dentro dele. Optou-se por não renderizar elemento vazio nem número fictício em faixa de identificação legal.

## [0.10.21] — IBM Plex self-hosted, Google Fonts removido da landing (estágio 2c)

### Corrigido
- **Google Fonts eliminado da landing**, fechando a pendência registrada na 0.10.20. As duas páginas carregavam IBM Plex de `fonts.googleapis.com`/`fonts.gstatic.com` via `<link>` no `<head>` — requisição a terceiro disparada no carregamento, **antes de qualquer interação com o banner de consentimento**, expondo o IP do visitante. O banner sempre cobriu apenas o Google Analytics; as fontes escapavam dele por serem `<link>` estático e não script condicional. Agora `grep "googleapis\|gstatic"` retorna **0** em `index.html` e `404.html`.
- Fontes servidas pelo próprio container: 7 arquivos `.woff2` em `public/fonts/` (IBM Plex Sans Light/Regular/Medium/SemiBold/Bold + IBM Plex Mono Regular/Medium), subset latino, **111 KB somados**. IBM Plex é licenciado sob OFL, que permite redistribuição. `index.html` declara os 7 `@font-face`; `404.html` declara os 5 que de fato usa.
- `font-display: swap` em todos os `@font-face` — o texto renderiza imediatamente com a fonte de sistema e troca quando o arquivo chega, em vez de ficar invisível. `<link rel="preload">` nos dois pesos above-the-fold (Sans Regular e SemiBold), que sem isso só seriam descobertos depois do CSS ser parseado.

### Verificação
- Integridade cruzada das referências: cada `src` de `@font-face` nos dois HTML aponta para arquivo existente em `public/fonts/`, e nenhum `.woff2` do diretório ficou órfão — as duas direções conferidas, para não deixar nem 404 de fonte nem peso morto no container.
- Container buildado e exercitado: healthcheck **`healthy`**; `/fonts/IBMPlexSans-Regular.woff2` → **200 com `Content-Type: font/woff2`** (o `mime.types` do nginx já cobre `woff2`, sem configuração extra); as **7** fontes respondem 200; `/` → 200, `/product-screenshot.png` → 200, `/nao-existe` → **404** — o 404 real da 0.10.20 preservado.
- Escopo confinado a `apps/marketing/`: `deploy/nginx/`, `apps/api/` e `docker-compose.production.yml` intocados. Nenhuma mudança de infraestrutura neste estágio — só conteúdo do container.

## [0.10.20] — Conteúdo real da landing + 404 real (estágio 2b)

### Adicionado
- **`apps/marketing/public/index.html`** substitui a holding page do estágio 2a. Estrutura: hero (`Todo o seu atendimento no WhatsApp, organizado num só lugar`) com screenshot do produto em moldura de browser, faixa de canais (WhatsApp/Instagram/e-mail), três seções — *Menos apps abertos, mais clientes atendidos*, *No ar em poucos dias* e o formulário *Veja o ZiraDesk funcionando com os dados da sua empresa*. Tipografia IBM Plex Sans/Mono, tema escuro alinhado à identidade do produto.
- **`public/product-screenshot.png`** (~141 KB) e **`public/404.html`** com a mesma identidade visual da landing.
- **Formulário de demonstração integrado ao endpoint público de leads.** Envia `POST` para **`/api/leads` em caminho relativo** — same-origin pelo `location /api/` do bloco do apex (estágio 2a) —, o que dispensa CORS por completo: `server.ts` não foi tocado e a regex de origem continua sem cobrir o apex, sem necessidade. Os cinco campos (`name`, `company`, `email`, `phone`, `message`) correspondem exatamente ao `createLeadSchema` da 0.10.16; opcionais vazios são removidos do payload antes do envio. Validação de `name` e `email` no cliente antes do POST, com o servidor como autoridade — erro do servidor cai numa mensagem genérica, sucesso limpa o formulário.
- **Banner de consentimento LGPD para analytics.** O Google Analytics (`G-N0T4RVFHNT`) **não é carregado no `<head>`**: o script só é injetado dentro de `loadGA()`, chamada exclusivamente quando o visitante clica em *Aceitar* ou quando `localStorage.zd_ga_consent === 'granted'` de uma visita anterior. Recusa grava `'denied'` e nada é carregado; a escolha é persistida nos dois sentidos, então o banner não reaparece. `anonymize_ip: true` na configuração, e o evento `generate_lead` só dispara se `window.gtag` existir — ou seja, nunca para quem recusou.

### Alterado
- **Soft-404 eliminado.** O `nginx.default.conf` do container `marketing` trocou `try_files $uri $uri/ /index.html` (herdado do padrão SPA de `apps/web`) por `try_files $uri $uri/ =404`, com `error_page 404 /404.html` e a página marcada `internal`. URL inexistente agora devolve **404 real** em vez de 200 com o index — a pendência registrada na 0.10.18, que num site de marketing prejudica indexação.

### Corrigido
- **`listen [::]:80` restaurado** no `nginx.default.conf` do `marketing`, retomando a paridade com `apps/web/nginx.default.conf`. A linha se perdera na reescrita da config, deixando o nginx ouvindo só em `0.0.0.0:80`; como o `HEALTHCHECK` do Dockerfile usa `http://localhost/healthz` e o Alpine resolve `localhost` para `::1` antes de `127.0.0.1`, o container era reportado **`unhealthy`** — `wget: can't connect to remote host: Connection refused`, com `wget http://127.0.0.1/healthz` funcionando normalmente. Pego na validação local, antes do commit. **Produção não chegou a ser afetada e não teria sido**: o healthcheck declarado em `docker-compose.production.yml` substitui o da imagem e usa `127.0.0.1` explícito — confirmado empiricamente rodando o container com o comando exato do compose, que reportou `healthy` mesmo sem IPv6. Ainda assim o defeito importava: o `depends_on: marketing: service_healthy` do nginx da borda depende desse sinal, e o `HEALTHCHECK` do Dockerfile ficaria decorativo em qualquer uso fora do compose. Depois da correção o container escuta em `0.0.0.0:80` e `:::80`, e os dois caminhos (`localhost` e `127.0.0.1`) respondem.

### Verificação
- Container buildado e exercitado rota a rota: `/` → 200, `/healthz` → 200, `/product-screenshot.png` → 200, **`/nao-existe` → 404** (era 200 antes desta mudança), com o corpo servindo a `404.html` própria (`ERRO 404` presente). `/404.html` acessada diretamente também devolve 404, efeito pretendido do `internal`.
- Antes de o changelog afirmar qualquer coisa, as duas garantias foram conferidas no fonte: `fetch('/api/leads')` é relativo (`index.html:561`) e o GA está atrás do consentimento (`index.html:504-520`).
- `deploy/nginx/` e `apps/api/` **não foram tocados** — este estágio muda apenas o conteúdo do container `marketing` e a config interna dele. O `ziradesk.conf` da borda segue como ficou no estágio 2a.

### Pendente
- A landing carrega **Google Fonts** (`fonts.googleapis.com`/`fonts.gstatic.com`) no `<head>`, sem passar pelo banner. Não é analytics e não usa cookies, mas é conexão a terceiro que expõe o IP do visitante antes de qualquer escolha — o banner cobre apenas o Google Analytics. Se o critério de LGPD adotado for estrito, a saída é servir as fontes localmente (`@font-face` com os arquivos em `public/`), o que também remove duas conexões externas do carregamento.

## [0.10.19] — Guarda do `nginx -t` pré-deploy estendida ao serviço `marketing`

### Corrigido
- O Deploy Contabo do commit `774c00c` (0.10.18) **falhou**, e este é o conserto. O `nginx -t` **pré-deploy** (`deploy-contabo.yml:73-79`) roda `exec` no container nginx **já existente**, que enxerga a config **nova** porque `deploy/nginx/conf.d` é bind mount e o `git pull` do próprio deploy acabou de atualizá-la. Essa config referencia `upstream ziradesk_marketing { server marketing:80; }`, mas o container `marketing` só é buildado na linha 81 e sobe na 93. O nginx resolve hostname de upstream **no load da configuração**, não sob demanda, então o teste aborta com `[emerg] host not found in upstream "marketing:80"` e o `set -euo pipefail` derruba o deploy.
- **Terceiro ponto de lista explícita de serviços** no mesmo arquivo, depois do `up -d` (linha 93) e da limpeza de containers órfãos (linha 87), ambos já tratados na 0.10.18. A guarda existe exatamente para pular o check enquanto um serviço ainda não subiu — o `else` dela já dizia isso — e só não tinha sido estendida ao serviço novo. Correção é uma linha: `&& is_compose_service_running marketing` na condição, mais a mensagem do `else` atualizada.
- Comportamento resultante: **neste** deploy a guarda pula o check pré-deploy (marketing ainda não existe), o script segue para `build` → `up -d` com marketing → nginx sobe após o healthcheck de marketing → e o `nginx -t` **pós-deploy** (linha 95) valida a config de verdade, já com o upstream resolvível. Deploys seguintes voltam a exercer o check pré-deploy normalmente, sem perda de proteção.

### Verificação
- Causa reproduzida localmente antes do conserto: `nginx -t` na config real, na imagem `nginx:1.27-alpine`, com `--add-host` para `api` e `web` mas **sem** `marketing`, devolve exatamente `nginx: [emerg] host not found in upstream "marketing:80" in /etc/nginx/conf.d/ziradesk.conf:25`. A validação da 0.10.18 passara por ter incluído `--add-host marketing`, simulando um container que ainda não existia — o cenário que escapou.
- **Falha foi fail-safe**: a linha 76 antecede `compose build`, `up -d postgres redis`, `api-migrate` e o `up -d` dos serviços. Nada chegou a ser aplicado. Confirmado durante o incidente: `app.ziradesk.com` 200, `api.ziradesk.com/health` 200, e `ziradesk.com` ainda servindo o SPA do app (`/assets/index-*.js`), sem vestígio da landing.
- **DNS do apex confirmado existente** — a pendência aberta na 0.10.18. `ziradesk.com` responde 200 hoje, servindo o app pelo `default_server`, o que prova que há registro apontando para a origem. A landing passa a aparecer assim que o deploy concluir.

## [0.10.18] — Landing page estática no apex (infraestrutura, estágio 2a)

### Adicionado
- **`apps/marketing/`** — landing page estática servida por container `nginx:alpine`, **deliberadamente fora do workspace pnpm**: a pasta não tem `package.json`, então `pnpm-workspace.yaml` (`apps/*`) não a captura e o `pnpm-lock.yaml` fica intocado. Isso evita a armadilha mapeada na auditoria: os Dockerfiles de api e web rodam `pnpm install --frozen-lockfile` na raiz, e um pacote novo no workspace sem lockfile regenerado **quebraria o build dos dois**, não só o do app novo. Conteúdo atual é holding page mínima (`public/index.html` + favicon); o conteúdo real vem no estágio 2b.
- Serviço `marketing` no `docker-compose.production.yml`: `expose: 80` sem porta no host, na rede `ziradesk-internal`, healthcheck espelhando o do `web` (`wget /healthz`), `mem_limit: 128m`. Adicionado também ao `depends_on` do nginx com `condition: service_healthy`, junto de api e web.
- **Bloco Nginx para `ziradesk.com` e `www.ziradesk.com`**, escrito **dentro do `ziradesk.conf` existente** em vez de um arquivo novo — `conf.d/*.conf` é incluído em ordem alfabética, e um `marketing.conf` ordenaria antes de `ziradesk.conf`, fazendo seu primeiro bloco `listen 443` virar o default server e capturar todo host desconhecido. Serve a landing em `location /` e faz proxy de `location /api/` para a API.

### Alterado
- **`location /api/` no apex torna o formulário de leads same-origin**, o que elimina a necessidade de CORS — a pendência deixada explícita na 0.10.16. A regex de origem em `server.ts` (`/\.ziradesk\.com$/`) exige ponto literal antes do domínio e por isso **não** cobre `https://ziradesk.com`; em vez de adicionar o apex ao array, a landing chama a própria origem. `server.ts` não foi tocado. Os headers `X-Forwarded-*` foram copiados do bloco do app, que é o que o `trustProxy: 1` (0.10.16) precisa para resolver o IP real do cliente.
- **`default_server` explícito nas duas linhas `listen 443` do bloco `app.ziradesk.com`.** Até aqui, "host desconhecido cai no app" era efeito **posicional** — o app era o primeiro bloco 443 do arquivo, e a auditoria confirmou zero ocorrências de `default_server` no repositório. A diretiva **fixa o comportamento atual**, não o altera, e protege contra um bloco novo ou um `conf.d` que ordene antes roubar o default silenciosamente.
- **`www.ziradesk.com` passa a servir a landing.** Hoje ele casa com a regex de tenant (`~^([a-z0-9-]+)\.ziradesk\.com$`) e é proxiado com `X-Tenant-Slug: www`, que a API rejeita — `www` está em `RESERVED_SUBDOMAINS` (`auth.routes.ts`) e leva `400` em `middleware/tenant.ts`. Como `server_name` exato vence regex no nginx, o bloco novo captura o host sem precisar alterar a regex de tenant. `ziradesk.com` e `www.ziradesk.com` também foram adicionados ao `server_name` do bloco de redirect `:80`, tornando explícito o que já funcionava por posição.
- `deploy-contabo.yml`: `marketing` incluído nas **duas** listas explícitas do deploy. Na do `up -d` (linha 93), sem a qual o serviço seria buildado e **nunca subiria** — falha silenciosa, já que `--remove-orphans` não alcança serviço declarado mas não listado. E no regex de limpeza de containers órfãos (linha 87), pelo mesmo motivo que ele existe para api/web/nginx: um container renomeado vira órfão que segura o nome e faz o `up -d` seguinte falhar.

### Verificação
- `docker build ./apps/marketing` limpo; container executado com `/healthz` → `200 ok`, `/` → `200` com `<title>ZiraDesk</title>`, `/favicon.svg` → `200`, e `HEALTHCHECK` do Dockerfile reportando `healthy` no `docker inspect`.
- **`nginx -t` executado na configuração real**, na mesma imagem de produção (`nginx:1.27-alpine`), com `nginx.conf` e `conf.d/` montados, certificados autoassinados e `--add-host` para `api`/`web`/`marketing` (o nginx resolve nomes de upstream no load e falharia sem isso): `syntax is ok` / `test is successful`. Sintaxe, pareamento de blocos e o `default_server` validados pelo próprio nginx, não por leitura.
- `docker compose -f docker-compose.production.yml config --services` lista `marketing` entre os 7 serviços.

### Pendente
- **Registro DNS do apex não verificado.** `ARQUITETURA_TECNICA.md` §2 documenta o DNS como `app.ziradesk.com, api.ziradesk.com, *.ziradesk.com` — **sem o apex**. Se não houver registro para `ziradesk.com` no Cloudflare, o bloco novo simplesmente não recebe tráfego; nada quebra, mas a landing não aparece. Confirmar no painel antes de considerar o estágio concluído.
- `try_files $uri $uri/ /index.html` foi herdado do padrão de `apps/web`, onde é correto por ser SPA. Num site estático isso faz URL inexistente devolver o index com **200 em vez de 404** — soft 404, indesejável justamente num site de marketing. Trocar por `=404` com página própria no estágio 2b.

## [0.10.17] — `schema.prisma` sincronizado com o banco (dois drifts fechados)

### Corrigido
- **`model TenantVoiceConfig` adicionado a `schema.prisma`**, fechando o drift [ALTO] registrado no §16 na 0.10.16. A tabela existia em produção desde a migration `20260613120000_add_tenant_voice_config` e era consumida por `voice-config.service.ts` e `tenants.service.ts`, mas sem model correspondente — então qualquer `prisma migrate dev` futuro, para qualquer mudança não relacionada, emitiria `DROP TABLE tenant_voice_config` no diff, silenciosamente.
- O model foi escrito **a partir de introspecção real** (`\d+ tenant_voice_config`), não da descrição textual do §16 — e isso importou: a introspecção revelou três atributos que o registro não tinha, porque a inspeção original truncou o rodapé do `\d`. `tenant_id` e `twilio_phone_number` são **UNIQUE** (a relação com `Tenant` é **1:1**, não 1:N) e existe **FK `ON DELETE CASCADE`** para `tenants(id)`, que exigiu campo de relação no model e a back-relation `voiceConfig TenantVoiceConfig?` em `Tenant`. Escrever de memória teria deixado três `ALTER TABLE` residuais no diff.
- Dois mapeamentos foram decisivos para o diff zerar, ambos casos em que o default do Prisma diverge do banco: `@default(dbgenerated("gen_random_uuid()"))` em vez de `@default(uuid())` — este último é gerado no cliente e **não** cria default de coluna, o que produziria um `DROP DEFAULT` —, e `onUpdate: NoAction` explícito na relação, já que o default do Prisma para relação obrigatória é `Cascade` e o banco tem `NO ACTION`. Somam-se `@db.Uuid`, `@db.VarChar(20)` e `@db.Timestamptz(6)`.
- **Segundo drift fechado no mesmo diff**: `conversations.waiting_expires_at` e `queue_entered_at` são `timestamptz` no banco (migration `20260523120000_restructure_conversation_status:140`) mas estavam declarados como `DateTime?` sem `@db`, que o Prisma mapeia para `timestamp(3)` **sem** timezone. Um `migrate dev` futuro emitiria `ALTER COLUMN ... SET DATA TYPE TIMESTAMP(3)` — que no PostgreSQL descarta o offset e rotaciona os valores para o timezone da sessão. Perda silenciosa de dado num campo que controla expiração de conversa em fila. `@db.Timestamptz(6)` aplicado aos dois; precisão 6 confirmada por `information_schema.columns`.
- As colunas irmãs `closed_at` e `csat_expires_at` foram **deliberadamente não marcadas**: em `public` são `timestamp(3)` sem timezone de fato, e marcá-las criaria o drift inverso. A assimetria está comentada no próprio `schema.prisma` para não parecer descuido.

### Verificação
- **`migrate diff --from-migrations` final totalmente vazio** — saída completa `-- This is an empty migration.`, 32 bytes, zero linhas não-comentário, verificada com `cat -A` para descartar conteúdo invisível. Nenhum `ALTER`/`CREATE`/`DROP` para nenhuma tabela. É a prova de que `schema.prisma` está 100% sincronizado com o histórico de migrations, e de que o próximo `migrate dev` vai gerar **só** a mudança pretendida.
- **Nenhuma migration criada.** As duas mudanças são sincronização do model com tabelas já existentes; nenhum SQL é executado no banco por este commit, em nenhum ambiente.

### Documentação
- §16: item [ALTO] do `tenant_voice_config` marcado como resolvido, com registro dos três atributos que a introspecção revelou e dos dois mapeamentos não-óbvios, para quem enfrentar caso parecido.
- §16: item novo **[BAIXO]** — `conversations.closed_at`/`csat_expires_at` divergem entre `public` (`timestamp(3)` sem tz, a sombra legada e vazia) e os schemas de tenant (`timestamptz(6)`, onde os dados reais vivem, confirmado em `tenant_demo` e `tenant_codexa`). O `model Conversation` descreve hoje a sombra, não os tenants, nesses dois campos. Impacto de runtime nulo — `prisma.conversation.*` não é usado em lugar nenhum, todo acesso é SQL raw. O conflito é irresolvível pelos dois lados: alinhar com os tenants reabriria o diff pedindo a conversão destrutiva no `public`. Vinculado à decisão pendente sobre o destino das tabelas-sombra, no item [MÉDIO] correspondente.

### Testes
- `type-check` limpo em `@ziradesk/api`. Suíte: **352 passed | 3 failed | 10 skipped**, contagem idêntica à da 0.10.16 — as 3 falhas seguem sendo as de `omnichannel.webhooks.integration.test.ts` já registradas como item [BAIXO] no §16 e verdes no CI.

## [0.10.16] — Endpoint público de leads (landing page, estágio 1)

### Adicionado
- `POST /api/leads` — rota pública sem auth e sem middleware de tenant, para o formulário da futura landing page. Segue o molde de `legal.routes.ts` e é registrada no mesmo bloco de `server.ts` que os webhooks, sob o comentário "sem auth JWT e sem tenant middleware". Validação zod em `leads.schema.ts` (`name` obrigatório, `email` com formato válido, `company`/`phone`/`message` opcionais, todos com `.trim()` e teto de tamanho — o endpoint é escrita pública, então campo sem `max` é superfície de abuso de armazenamento). Diferente do `forgot-password`, **não** há anti-enumeração aqui: nada no corpo revela existência de conta, então erro de validação devolve `400` com `fieldErrors` em vez de `200` mudo.
- `model Lead` em `schema.prisma` (tabela `public.leads`) + migration `20260803170254_add_leads_table`. Vive em `public` porque o lead é anterior a qualquer cadastro e não pertence a tenant nenhum. `'lead'` foi adicionado a `ROOT_PRISMA_MODEL_PROPS` (`config/database.ts`), seguindo a convenção de `plan`/`tenant`/`subscription`: sem isso, um `prisma.lead` chamado dentro de request com contexto de tenant entraria na transação request-scoped daquele tenant e um erro posterior daria rollback no lead.
- Rate limit dedicado de **5/min** para `/api/leads` em `rateLimitMax()`, e o `keyGenerator` do `@fastify/rate-limit` estendido para chavear essa rota por IP sempre — nunca pelo header `Authorization`. Sem essa segunda parte, um cliente anônimo escaparia do balde mandando um `Authorization` arbitrário e diferente a cada request.

### Corrigido
- **`trustProxy: 1` adicionado à instanciação do Fastify** (`server.ts`), que rodava sem nenhum valor: `request.ip` resolvia para o IP interno do container do Nginx, igual para todo cliente, tornando o rate limit por IP efetivamente **global** em vez de por cliente. Já afetava `/api/auth/*` (os 10/min eram compartilhados por toda a plataforma) e afetaria `/api/leads` do mesmo jeito.
- O valor é `1` e **não `true`** deliberadamente. O Nginx usa `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for`, que **anexa** ao XFF enviado pelo cliente em vez de substituí-lo; com `trustProxy: true` o `proxy-addr` devolve a entrada mais à **esquerda** da cadeia — justamente a que o cliente escreveu —, e um bot trocando o header a cada request teria um `request.ip` novo a cada request, saindo de "rate limit global demais" para "rate limit inexistente". Com `1`, vale sempre a última entrada, a que o Nginx anexou a partir de `$remote_addr` (já derivado de `CF-Connecting-IP` via `real_ip_header`), e o spoof não tem efeito. Comportamento verificado no código de `fastify/lib/request.js` (número vira `(a, i) => i < tp`) e `proxy-addr/index.js`.
- Efeito colateral desejado nos 6 usos de `request.ip` fora do rate limit (audit log de CRM em `organizations.routes.ts`/`contacts.routes.ts`, `conversations.routes.ts`, `active-outbound.routes.ts`): passam a gravar o IP real do cliente em vez do IP do container. Nenhum deles ramifica lógica sobre o valor. Sob `inject`/light-my-request não há XFF, então `request.ip` continua `127.0.0.1` e nada nos testes muda; `createIsolatedTestServer` recebeu o mesmo `trustProxy: 1` por paridade com `server.ts`.

### Documentação
- `ARQUITETURA_TECNICA.md` §16 registra novo item **[ALTO]**: drift entre `schema.prisma` e o banco real em `tenant_voice_config`. A tabela existe em produção (migration `20260613120000_add_tenant_voice_config`) e é consumida por `voice-config.service.ts` e `tenants.service.ts`, mas não tem model correspondente — então **qualquer `prisma migrate dev` futuro, para qualquer mudança não relacionada, gera `DROP TABLE tenant_voice_config` no diff**, silenciosamente. Descoberto ao gerar a migration de `leads`: o `migrate dev` recusa rodar em terminal não-interativo, o SQL saiu de `migrate diff --from-migrations` contra shadow DB descartável, e o diff veio com o `DROP TABLE`, o `DROP CONSTRAINT` da FK e um `ALTER COLUMN ... TIMESTAMP(3)` em `conversations`. Os drops foram excluídos à mão da migration commitada; a causa raiz não foi corrigida e fica como tarefa própria. O item registra o shape real da tabela para baratear essa correção.

### Pendente
- **CORS não resolvido para o apex.** A regex de origem em `server.ts` (`/\.ziradesk\.com$/`) exige ponto literal antes de `ziradesk.com`, então cobre `www.ziradesk.com` mas **não** `https://ziradesk.com` — o `/` de `https://` não casa. Decisão adiada para o estágio de infraestrutura (Nginx): servindo a landing e a API no mesmo host, via `location /api/` no bloco do apex como `app.ziradesk.com` já faz, o formulário fica same-origin e não há CORS a configurar. A alternativa — adicionar `'https://ziradesk.com'` ao array — só é necessária se a landing chamar `api.ziradesk.com` direto do browser.

### Testes
- `type-check` limpo em `@ziradesk/api`. Suíte da API: **352 passed | 3 failed | 10 skipped**. As 3 falhas continuam sendo as de `omnichannel.webhooks.integration.test.ts` (e-mail inbound, timeout de 15s nos caminhos de sucesso; o caminho de rejeição passa). **Não são regressão**: A/B com as alterações rastreadas em `git stash` reproduziu exatamente as mesmas 3 falhas na baseline, 16 passed no arquivo isolado.
- **Correção do registro das versões 0.10.14 e 0.10.15**, que atribuíram essas falhas a "execução local contra o Postgres de desenvolvimento na porta 5432 em vez do banco de teste em 5433". Esta execução usou um Postgres de teste dedicado **de fato em 5433** (container `pgvector/pgvector:pg16` próprio, com `prisma migrate deploy` aplicado), conforme o `.env.test` espera — e as 3 falharam igual. A porta não é a causa; o motivo real segue não diagnosticado.
- Smoke test do endpoint via `app.inject`: `201 {"success":true}` no caminho válido, `400` com `fieldErrors` de `name` e `email` no inválido, e a linha gravada em `public.leads` com `name` já trimado e `null` nos opcionais ausentes.

## [0.10.15] — Frontend reage a conta suspensa

### Adicionado
- O interceptor global de resposta (`services/api.ts`) passou a reconhecer `code: 'TENANT_SUSPENDED'` no corpo do erro, acionando `handleTenantSuspended()`: derruba a sessão pelo store, exibe toast de aviso e redireciona para `/login` após 2s. Segue o padrão já estabelecido pelo handler de `auth:force_logout` em `services/socket.ts` — `getState()` no store, `i18n.t(..., { ns: 'auth' })` para a mensagem e `window.location.href` para navegar, já que o interceptor roda fora do React e o app usa `<BrowserRouter>`, sem router object acessível.
- Este é o **único ponto do interceptor que ramifica pelo corpo da resposta**, e não apenas pelo status: o refresh devolve `401`, mesmo status de token expirado, então o código no payload é a única forma de distinguir os dois. Um helper `getApiErrorCode()` isola essa leitura, com `axios.isAxiosError` como guarda para não tocar `.response` em erro de rede.
- O `catch` de `refreshAccessToken` distingue o caso antes do comportamento atual: `TENANT_SUSPENDED` chama `handleTenantSuspended()`; os outros 5 motivos de recusa do refresh continuam caindo em `shouldLogoutAfterRefreshFailure` + `logout()`, sem redirect, exatamente como antes.
- `Login.tsx` passou a inspecionar o código do erro em vez de renderizar string fixa: conta suspensa e credenciais inválidas agora produzem mensagens distintas. Antes, qualquer falha de login — inclusive o `403` de conta suspensa — exibia "E-mail ou senha inválidos".
- i18n: chaves `tenantSuspended` em `auth.json` nos 3 locales (`pt-BR`, `en-US`, `es`), em dois blocos — `login.errors` para a mensagem inline do formulário e `session` para o toast, irmã de `forcedLogout`.

### Corrigido
- Mensagem do refresh para tenant suspenso corrigida no backend: `TenantSuspendedError` passou a carregar `msg.tenantSuspended` (chave nova no catálogo de `auth.service.ts`, nos 3 idiomas) em vez de `msg.tokenExpired`. Fecha a pendência deixada na 0.10.14, onde o discriminador estava correto mas o texto dizia "Sessão expirada, faça login novamente". É mudança de texto em resposta de API existente; a auditoria de consumidores confirmou que nenhum código de `apps/web` lê esse campo nessas rotas.

### Testes
- `type-check` limpo em `@ziradesk/api` e `@ziradesk/web`. Suíte da API: **352 passed | 3 failed | 10 skipped** — as 3 falhas são as mesmas de `omnichannel.webhooks.integration.test.ts` já caracterizadas na 0.10.14 como ambiente (execução local contra o Postgres de desenvolvimento na porta `5432`, não o banco de teste em `5433`), e que passaram verdes no CI de `ab278d7`.

## [0.10.14] — Discriminador `TENANT_SUSPENDED` nos pontos de enforcement

### Adicionado
- `TenantSuspendedError` (`auth.service.ts`) passa a distinguir tenant suspenso/cancelado dos demais motivos de recusa do refresh token. Antes, `verifyRefreshToken` lançava `Error(msg.tokenExpired)` em 6 condições diferentes — JWT inválido, cutoff de `force_logout`, super admin ausente, payload sem `tenantId`, tenant suspenso e usuário inexistente —, todas indistinguíveis pelo `catch`. A classe segue o molde de `InviteEmailError`/`RoleUpdateError` (campo `code` como literal, atribuído no construtor). Os outros 5 pontos continuam com `Error` cru, sem mudança de comportamento.
- O `catch` do `POST /auth/refresh` (`auth.routes.ts`) ganhou branch para a nova classe **antes** do fallback genérico, devolvendo `{ success: false, error: { code: 'TENANT_SUSPENDED', message } }`. O `clearCookie` do refresh token continua rodando para todos os casos, inclusive este — conta bloqueada também deve perder o token.

### Alterado
- Envelope de erro migrado do formato legado `{ error: string }` para o padrão coded `{ success: false, error: { code, message } }` nos três pontos restantes de tenant bloqueado: `middleware/tenant.ts`, `middleware/tenantSchemaFromJwt.ts` e o login em `auth.routes.ts`, todos com `code: 'TENANT_SUSPENDED'`. O padrão é o mesmo já usado por `rbac.ts`, `entitlement.ts` e `meta-signature.ts`.
- **Status HTTP preservados** de propósito (402/403/403/401): a mudança é aditiva no payload, para não alterar o contrato de status enquanto o frontend não trata o caso. Em particular o `401` do refresh mantém o comportamento de `shouldLogoutAfterRefreshFailure` no cliente, que já desloga em 401/403.
- Auditoria prévia dos consumidores confirmou zero quebras: nenhum código de `apps/web` lê `data.error` como string nessas rotas, o interceptor global (`services/api.ts`) ramifica só por `status`, e a tela de login descarta o corpo da resposta. As duas leituras string-puras que existem (`ForgotPassword.tsx`, `ResetPassword.tsx`) apontam para rotas fora desta migração.
- `portal.service.ts` (404/403) e o `200` anti-enumeração do `forgot-password` ficaram intencionalmente de fora — categorias diferentes.

### Testes
- `type-check` da API limpo. Suíte local: **352 passed | 3 failed | 10 skipped**. As 3 falhas são de `omnichannel.webhooks.integration.test.ts` (e-mail inbound, timeout de 15s) e **não são regressão**: A/B com as alterações revertidas via `git stash` reproduziu exatamente as mesmas 3 falhas na baseline. Essas rotas de webhook não passam por nenhum dos middlewares alterados. Atribuídas a ambiente — a execução usou o Postgres de desenvolvimento (`5432`) em vez do banco de teste que o `.env.test` espera em `5433`, ocupado por container de outro projeto.

## [0.10.13] — Bucket de backup alinhado e divergência de caminho documentada

### Corrigido
- Default de `R2_REMOTE` em `ops/restore.sh` corrigido de `r2:ziradesk-backups` para `r2:ziradesk-backups-prod`, alinhando com `ops/backup.sh` (corrigido em 0.10.12). A assimetria era mais grave que a do backup: um restore sem override gravava/lia do bucket errado justamente em cenário de disaster recovery, quando não há margem para descobrir o engano. Restore do histórico no bucket antigo, se vier a ser necessário, passa a exigir `R2_REMOTE` explícito.
- `.github/workflows/backup-manual.yml` apontava a listagem de conferência pós-backup (`rclone ls`) para o bucket antigo, então a saída "Arquivos no R2" do workflow não refletia o destino real dos uploads.
- As 4 referências ao bucket antigo em `docs/technical/DEPLOY_VPS_DOCKER_COMPOSE.md` (destino, árvore de diretórios, comando de verificação e comando de restore) foram alinhadas ao mesmo nome.

### Documentação
- `DEPLOY_VPS_DOCKER_COMPOSE.md` passou a registrar que `/home/deploy/scripts/backup.sh` e `/home/deploy/scripts/restore.sh` são **cópias manuais** de `ops/*.sh` — arquivos regulares, não symlinks — e que o `git pull --ff-only` do `deploy-contabo.yml` atualiza somente `~/ziradesk/app/ops/`, sem propagar para o caminho que cron, `backup-manual.yml` e SSH manual de fato invocam. O trecho anterior afirmava que os scripts do repositório podiam ser chamados "nos três caminhos de invocação", o que nunca foi verdade. Inclui o `cp` + `chmod +x` de re-sincronização como passo pós-deploy explícito.
- `ARQUITETURA_TECNICA.md` §16 registra a divergência de caminho como causa-raiz adicional do item [INFRA]: o Deploy Contabo #213 completou com `success` e ainda assim o backup de produção seguiu rodando a versão antiga, sem `verify_uploaded` e com o bucket errado, até a re-cópia manual em 2026-08-03. Deploy verde não implica script de backup atualizado. Follow-up estrutural pendente: step de sincronização no `deploy-contabo.yml` ou substituição das cópias por symlinks.

### Segurança / Infraestrutura
- §16 qualificado quanto aos secrets SSH: `CONTABO_SSH_PRIVATE_KEY` já está funcional — os passos de SSH do `deploy-contabo.yml` executaram e completaram contra o host correto em Deploy Contabo #213 (run 30822031385), incluindo `git pull`, rebuild dos containers, `api-migrate` e health check. A afirmação anterior de que os dois workflows falhavam na autenticação não se aplica mais a esse secret. `VPS_SSH_KEY` permanece não verificado, pois `backup-manual.yml` é `workflow_dispatch` apenas e não rodou.

## [0.10.12] — Verificação pós-upload dos backups no R2

### Corrigido
- `ops/backup.sh` passou a confirmar cada upload no destino via `rclone lsf` após cada `copy` (os dois diários e os dois mensais), abortando o script quando o objeto não é encontrado. Antes o script reportava "Backup concluido com sucesso" mesmo quando nada persistia: o `rclone copy` saía 0 e nenhuma checagem lia o destino de volta.
- As duas condições de falha passaram a ter log distinto para diagnóstico: `falha ao listar destino para verificacao` (o `lsf` não rodou — rede, credencial ou path) e `upload nao confirmado no destino` (listou, mas o objeto não está lá).
- Default de `R2_REMOTE` corrigido de `r2:ziradesk-backups` para `r2:ziradesk-backups-prod`. O bucket errado foi uma das causas dos backups que reportavam sucesso sem persistir; a outra foi um endpoint malformado gravando em path fantasma.
- Limitação conhecida, registrada em comentário no próprio script: a verificação usa a mesma config do `copy`, então um endpoint mal configurado engana as duas pontas — o `lsf` lista o mesmo path fantasma e confirma o objeto. A validação do endpoint continua manual, na configuração do rclone.

## [0.10.11] — Migração de infraestrutura para novo Contabo VPS

### Documentação
- Registrada a migração concluída em 2026-08-02 para o novo Contabo Cloud VPS 6 Core em US-East (`66.94.105.48`, hostname `vmi3482143`), incluindo a decisão Core vs Performance e o achado de drop-ins do SSH na imagem Ubuntu 24.04 da Contabo.
- `docs/technical/DEPLOY_VPS_DOCKER_COMPOSE.md` passou a cobrir o passo "VPS crua -> repo clonado": bootstrap, checagens de conflito, protocolo de sessão root salva-vidas, deploy key dedicada, clone e diretórios persistentes.
- Corrigida a documentação de TLS: Cloudflare Origin Certificates não suportam wildcard de dois níveis (`*.*.ziradesk.com`), então `suporte.{tenant}.ziradesk.com` exige abordagem alternativa.
- Documentados os requisitos de boot de produção para `META_APP_SECRET` e `RESEND_FROM_EMAIL`.

### Segurança / Infraestrutura
- Registradas como pendentes a troca do IP antigo nos workflows de deploy/backup, a regeneração dos secrets SSH do GitHub para o novo servidor, a reconfiguração do cron de backup R2 e o teste funcional completo de login via seed super admin.

## [0.10.10] — Decisão de não restaurar tenants de teste

### Documentação
- `ARQUITETURA_TECNICA.md` passou a registrar que `tenant_demo`, `tenant_multsoft_desenvolvimento_de_sistemas` e `tenant_sepol` eram ambientes de teste da VPS Contabo anterior e **não serão restaurados** a partir do backup no Cloudflare R2.
- Documentado que tenants no novo destino de infraestrutura devem ser provisionados do zero via `createTenantTables`, com schema limpo, sem carregar shape legado dos ambientes de teste.
- Removido o bloqueio operacional implícito de "backup verificado" para decidir sobre `agent_bot_skills`; a decisão sobre manter ou remover a tabela fica para tarefa própria, sem depender de restore dos tenants de teste.
- Anotado que `migrate:lgpd-shape` deve ser reavaliado futuramente se não houver schemas reais legados a migrar. O backup R2 continua como histórico/precaução, sem plano ativo de restore para os três tenants de teste.

## [0.10.9] — `conversations` blindada contra `0A000` por enum OID

### Corrigido
- Os 7 statements de `conversations` com `RETURNING *` passaram a qualificar a tabela por schema via `lib/conversations/schema.ts` (`conversationsRef`). O vetor era `conversation_status` criado por schema: mesmo enum textual (`open`, `waiting`, `closed`), mas `pg_type.oid`/`atttypid` diferente entre tenants, fazendo `equalTupleDescs` recusar o plano cacheado quando o mesmo texto SQL era reusado após troca de `search_path`.
- `conversationsRef` resolve `current_schema()` antes de montar o SQL quando o call site não informa `schemaName`, então o statement final contém literal como `"tenant_demo".conversations`; isto cria texto distinto por tenant e fecha o cache de prepared statements sem trocar `RETURNING *` por colunas explícitas.

### Testes
- Adicionada sonda gated `src/lib/conversations/__probes__/0A000-conversations.probe.test.ts` para reproduzir deterministicamente o vetor `0A000` de `conversations`: `conversation_status` é `CREATE TYPE` por schema, então `status` retorna `atttypid` diferente mesmo com os mesmos labels (`open`, `waiting`, `closed`).
- A prova mede os OIDs de `conversation_status` nos dois schemas efêmeros, confirma a colisão com statement não-qualificado + `RETURNING *`, confirma o gate com nome de tabela qualificado por schema, documenta que colunas explícitas incluindo `status` não fecham este vetor e adiciona um caso usando o helper real.

## [0.10.8] — `lgpd_requests` unificada e blindada contra `0A000` (Frente A)

### Corrigido
- `lgpd_requests` tinha **duas definições lazy divergentes** — `crm.infrastructure.ts` (`request_type VARCHAR(40)`, `status VARCHAR(20) DEFAULT 'processed'`, FKs `ON DELETE SET NULL`) e `portal.service.ts` (`VARCHAR(30)`, `VARCHAR(30) DEFAULT 'pending'`, FKs sem `ON DELETE`) —, ambas com `CREATE TABLE IF NOT EXISTS`: quem chegasse primeiro no schema definia o shape. Mesmos nomes e mesma ordem de coluna, `atttypmod` diferente, o que basta para `equalTupleDescs` (plancache.c) recusar o plano cacheado e disparar `0A000 cached plan must not change result type`.
- Shape unificado em fonte canônica única (`lib/lgpd/schema.ts`, `ensureLgpdRequestsTable`): `request_type VARCHAR(30)` (maior valor real `'external_anonymization'`, 22 chars), `status VARCHAR(20) DEFAULT 'pending'` (maior valor `'processed'`, 9 chars; a máquina de estados nasce em `pending`), FKs `requested_by`/`processed_by` com `ON DELETE SET NULL`. Os dois call sites passaram a chamar a canônica no ponto onde tinham DDL inline; os caches `Set<string>` por schema de cada módulo seguem com quem chama.
- `createLgpdRequestRecord` (`lib/lgpd/requests.ts`) passou a **sempre qualificar** a tabela por schema. O ramo não-qualificado antigo produzia texto de statement idêntico entre tenants, então o mesmo prepared statement era reusado na mesma conexão do pool contra schemas de shape diferente — o par de colisão. Quando o chamador não informa `schemaName` (caminho do CRM, que entra por `withOptionalSchema` recorrendo com `undefined`), o schema ativo é resolvido por `current_schema()`, mesmo padrão de `ensureTicketInfrastructure`.
- `RETURNING *` trocado por lista explícita das 15 colunas (`LGPD_REQUEST_COLUMNS`), fixando contagem e ordem do descritor de resultado contra colunas adicionadas por retrofit.

### Testes
- Sonda `src/lib/lgpd/__probes__/0A000-lgpd-requests.probe.test.ts` (fora da suíte, atrás de `ZIRADESK_PROBE_0A000=1`) passou a separar os três eixos do mecanismo, com cache de prepared statements isolado por caso (reconexão) e `DROP SCHEMA CASCADE` no teardown: **(a)** nome cru + `RETURNING *` sobre as defs legadas ainda dispara `0A000` — o vetor original continua detectável; **(b1)** shape canônico nos dois lados não colide; **(b2)** nome cru + colunas explícitas sobre typmod divergente **ainda dispara** `0A000`; **(b3)** o statement de produção (qualificado + explícito) não colide nem com typmod divergente.
- Medição de (b2) corrige uma premissa: **colunas explícitas não blindam divergência de `atttypmod`** — `RETURNING request_type` continua carregando o typmod da coluna. Quem fecha o vetor independente do shape físico é a **qualificação** do nome da tabela; a lista explícita cobre o eixo de contagem/ordem.
- Suíte: **355 passed | 5 skipped** (os 5 são a sonda desligada), sem regressão sobre a baseline de 355.

## [0.10.7] — Shape multitenant LGPD parcialmente unificado

### Corrigido
- Provisionamento de tenant novo (`createTenantTables`) passou a criar as 16 colunas do Grupo A que já existiam via retrofits lazy: colunas LGPD de `users` e `contacts`, `conversations.department_id`, `tickets.sla_warning_sent_at`, `ticket_attachments.contact_id` e `bot_options.department_id`.
- As colunas foram posicionadas no fim de cada `CREATE TABLE`, espelhando a ordem física que `ALTER TABLE ... ADD COLUMN` produz em tenants retrofitados. Tipos/defaults iguais não bastavam: queries com `SELECT *` ainda mudavam o result type se a ordem ordinal divergia, mantendo o risco de `0A000 cached plan must not change result type`.
- O erro intermitente `0A000` em execuções paralelas da suíte foi rastreado para colisão de plano cacheado causada por drift de shape entre schemas, não por PgBouncer, Socket.io ou race genérica do pool. Esta correção fechou a divergência do Grupo A em `contacts`/`users`, a instância que o export LGPD de contato expunha com mais frequência, e reduziu a frequência observada do erro.
- A classe `0A000` **não está fechada**: investigação posterior reproduziu 2 ocorrências em 19 execuções paralelas, e prova controlada com `SELECT * FROM conversations/tickets LIMIT 0` entre `tenant_demo` e `test_1785238505693` confirmou drift físico residual em schemas limpos. Instâncias abertas incluem colunas lazy fora das 16, como `conversations.outbound_expires_at`, `conversations.routing_started_at`, `conversations.routing_used_skill_id` e ordem histórica divergente em `tickets`.

### Segurança / Infraestrutura
- Adicionado `migrate:lgpd-shape` (`apps/api/src/scripts/migrate-lgpd-and-shape-columns.ts`) para aplicar as 12 colunas LGPD e `ticket_attachments.contact_id` em tenants existentes de forma idempotente.
- Registrado `migrate:departments` no `package.json` da API para expor o script já existente que cobre `conversations.department_id` e `bot_options.department_id`.
- `AGENTS.md` passou a registrar a regra de que todo `ADD COLUMN IF NOT EXISTS` lazy precisa ter par no `createTenantTables`.

### Testes
- `pnpm --filter @ziradesk/api type-check` e suíte sequencial (`355/0`) passaram na validação original. A rodada de 10 execuções paralelas sem `0A000` foi insuficiente para declarar fechamento: uma investigação ampliada reproduziu `0A000` 2/19. Estado correto: instância `contacts`/`users` mitigada; classe `0A000` permanece aberta para tabelas tenant-scoped com `SELECT *`/`RETURNING *` e `ADD COLUMN` lazy, com dimensionamento e correção estrutural pendentes.

## [0.10.6] — Som global de notificações de atendimento

### Alterado
- Frontend Omnichannel: o som de nova mensagem e novo atendimento passou para listeners globais em `TenantLayout`, independentes da montagem da página de conversas e sem bloquear reprodução quando a aba está em background.
- Eventos Socket.io `conversation:assigned` e `conversation:created` passaram a carregar `assignedTo` e `actorUserId`, permitindo tocar som apenas quando o atendimento vira do usuário por ação de outro agente ou do sistema.
- O atendimento aberto na tela passa a ser registrado em estado global para suprimir o som da conversa ativa sem depender da URL.
- Adicionado unlock do Web Audio no primeiro gesto do usuário após o shell autenticado montar, reduzindo falhas silenciosas por política de autoplay.

### Removido
- `ConversationList` deixou de disparar sons locais de mensagem, conversa criada e atribuição, evitando duplicidade dentro de `/omnichannel`.

## [0.10.5] — Remoção de reabertura de conversas e UX final do close-config (Passo 6/6)

### Alterado
- Omnichannel: o banner de conversa encerrada passou a ser apenas informativo; a ação de reabrir conversa foi removida para manter a regra de que protocolos encerrados não reabrem.
- Admin close-config: registros de sistema agora aparecem com badge "Sistema", não podem ser arrastados e têm alternância, edição e exclusão desabilitadas na UI; payloads de reorder filtram `isSystem` por defesa em profundidade.

### Removido
- Frontend Omnichannel: removidos `reopenMutation`, alias `omnichannelApi.reopen`, helper órfão `omnichannelApi.updateConversation` e chaves `resolve.reopen`/`resolve.reopenError` dos 3 locales.

### Corrigido
- Close-config: frontend passou a tipar `ConversationCloseConfigItem.isSystem`, alinhando o contrato que a API já expunha desde o Passo 2.

### Testes
- Adicionado `close-config.integration.test.ts` com 5 casos cobrindo reorder admin-only, rejeição de IDs `sys_*` em tipos/desfechos e exposição de `isSystem` em `GET /types` e `GET /outcomes`.

### Notas de migração / Produção
- A correção de closure-reason em 6 passos está concluída em código. As pendências de produção ficam aguardando a restauração da Hetzner: executar/confirmar `pnpm --filter @ziradesk/api migrate:close-config-system` nos schemas reais e verificar `agent_bot_skills`/`tenant_multsoft` antes de qualquer limpeza ou migration destrutiva.

## [0.10.4] — Mensagem pós-CSAT deixa de cair em conversa encerrada (Passo 4/6)

### Corrigido
- Webhook WhatsApp: mensagem de cliente em conversa encerrada cujo CSAT havia expirado — mas antes do sweeper horário passar — deixou de ser sepultada na conversa fechada ou de reabri-la com o protocolo antigo. Agora a janela de CSAT da conversa velha é finalizada (ela permanece `closed`) e a mensagem abre conversa nova com protocolo próprio. Três sub-casos convergiram: (a) com agente atribuído, a mensagem entrava na conversa fechada sem nenhuma notificação; (b) sem agente e com bot, a conversa velha era reaberta sob o protocolo antigo; (c) sem agente e com `bot_stage='done'` — o estado comum de conversa já atendida — a mensagem sumia sem resposta ao cliente e sem agente atribuído para vê-la.
- A correção não inventa semântica: é exatamente o desfecho que o sistema já produz 1h depois, quando `cleanup-csat.job.ts` fecha a janela e o inbound seguinte deixa de casar com o `SELECT` de resolução (`status IN ('open','waiting') OR csat_stage IN ('sent','waiting_comment')`) e cai no caminho de criação. O bug era a inconsistência restrita à janela de corrida.
- Deduplicação por `external_id` movida para antes da resolução de conversa: uma reentrega da Meta durante a janela não cria mais conversa órfã vazia. Fecha também um latente pré-existente no caminho normal de criação, onde o `return null` do dedup **commitava** a conversa recém-criada.

### Alterado
- A decisão de reutilizar ou não a conversa existente foi hoistada para antes da bifurcação de resolução: `reusableConversation = null` força o `else` que já existia (`callGenerateProtocol` + `INSERT`), então os três sub-casos reusam o downstream de conversa nova (mensagem de protocolo, `conversation:created`, bot, auto-assign) sem nenhum ramo novo e sem duplicar código.
- `finalizeExpiredCsat(tx, conversationId)` extraída do `UPDATE` que era inline no webhook — mesmo SET, sem mudança de comportamento; a extração só permite executá-lo antes da bifurcação, ligado à conversa velha.
- Bloco `if (isCsatPending) { if (csatExpired) {...} }` removido: com `currentConversation = null` nesse cenário, `hasAssignedAgent`, `currentBotStage`, `isAIAgentActive`, `isWaitingReturnFlow` e `isWaitingForHumanQueue` já caem nos defaults de conversa nova. Saldo líquido do arquivo: +88/−65 linhas.
- Escritas intencionais em conversa encerrada preservadas: palavra-chave `#sair` (encerra a conversa velha, sem abrir uma só para fechá-la em seguida) e resposta de CSAT **dentro** do prazo (pertence à conversa avaliada). Ambas cobertas por teste de regressão.

### Testes
- 5 testes de integração novos em `omnichannel.webhooks.integration.test.ts`, que não tinha nenhuma cobertura de CSAT nem de reabertura de conversa. Os 3 casos de bug foram verificados vermelhos com o fonte revertido via `git stash` (testes mantidos); os 2 de regressão passam nos dois lados, que é o papel deles.
- Suíte da API: **340 testes, 0 falhas** (baseline anterior 335). Nenhum teste existente precisou mudar.

### Notas de migração
- **Nenhuma migration.** Conversas que já receberam mensagem na janela com o comportamento antigo não são corrigidas retroativamente: as do sub-caso (b) seguem reabertas sob o protocolo antigo, e as de (a)/(c) seguem com a mensagem do cliente dentro da conversa encerrada. Um backfill exigiria separar essas mensagens em conversas novas com protocolo retroativo — não feito, e provavelmente não desejável.
- `cleanup-csat.job.ts` **não foi tocado**. O webhook e o sweeper agora produzem o mesmo desfecho por caminhos independentes; o `UPDATE` de finalização é idêntico nos dois e idempotente.

## [0.10.3] — Classificação de sistema nos encerramentos automáticos (Passo 3/6)

### Alterado
- Omnichannel: os 9 caminhos que encerram conversa automaticamente passaram a gravar `close_type_id = 'sys_auto'` e o `close_outcome_id` do respectivo caminho, deixando de sumir das métricas como fechamento sem classificação. Mapeamento: inatividade → `sys_inactivity`; expiração de espera (job e webhook) → `sys_no_reply`; falha de entrega outbound → `sys_delivery_fail`; encerramento pela supervisão no monitor → `sys_supervisor`; expiração de 24h na fila → `sys_queue_24h`; palavra-chave do cliente → `sys_by_client`; caminhos de CSAT (webhook expirado, webhook finalizado e sweeper) → `sys_auto_generic`.
- `closure_reason` (JSONB) passou a ser montado por `buildSystemClosureReason`, no mesmo formato que `closeConversation` grava para o agente (`reason`, `notes`, `closeTypeId`, `closeTypeLabel`, `closeOutcomeId`, `closeOutcomeLabel`, `resolvedAt`, `agentId`), preservando os campos de diagnóstico próprios de cada caminho (`provider`, `messageId`, `errorMessage` e o merge de `metadata.waiting_expired`).
- Fila 24h: o `closure_reason` passou a usar a chave `reason` em vez de `type`, alinhando com os demais caminhos — inventários por `closure_reason->>'reason'` deixam de perder esses registros silenciosamente.
- `closed_by_user_id` permanece `NULL` nos fechamentos de sistema: a coluna é FK para `users`, e um usuário fantasma vazaria para `byAgent`, listas de agentes e a aba "Encerrados". A autoria de sistema é identificada por `close_type_id = 'sys_auto'`. Exceção: o encerramento pela supervisão no monitor grava o `userId` real, por ser ação humana com desfecho de sistema.

### Corrigido
- Normalização de `closed_at`/`resolved_at`: o encerramento por inatividade não gravava `closed_at`, e a expiração de 24h na fila e o encerramento por palavra-chave não gravavam `resolved_at`. Todos os caminhos passam a gravar os dois.
- Caminhos que agem sobre conversa já encerrada (palavra-chave e os três de CSAT) passaram a usar `COALESCE` em `close_type_id`, `close_outcome_id` e `closure_reason`: como o CSAT é disparado depois do encerramento, gravar direto sobrescreveria a classificação feita pelo agente.
- Fila 24h: adicionado `AND status = 'open'` ao `UPDATE`, fechando a janela TOCTOU entre o `SELECT` que lista as conversas expiradas e o `UPDATE` linha a linha.

### Notas de migração
- **Nenhuma migration.** A mudança é só de escrita: conversas encerradas antes deste release seguem sem `close_type_id`/`close_outcome_id`. Um backfill retroativo por `closure_reason->>'reason'` seria possível para os 5 caminhos que já gravavam JSONB, mas não foi feito — e os 4 caminhos que não gravavam nada não têm como ser reclassificados.
- `metrics.service.ts` **não foi tocado**. O alinhamento de predicado entre `byType` (que exige `status = 'closed'`) e `byOutcome` (que não exige) é o passo 5. Até lá, conversas reabertas contam de formas diferentes nos dois gráficos — agora de forma visível, porque os fechamentos automáticos passaram a ter id.

## [0.10.2] — Registros de sistema para encerramento de conversas (Passo 2/6)

### Adicionado
- Close-config: coluna `is_system` em `conversation_close_types` e `conversation_close_outcomes`, criada pelo DDL de `ensureCloseConfigInfrastructure` (mantido separado do DML de seed) e no `CREATE TABLE` de provisionamento de tenant novo.
- Close-config: 1 tipo e 7 desfechos de sistema com IDs fixos e prefixo `sys_` — `sys_auto` (tipo) e `sys_no_reply`, `sys_inactivity`, `sys_delivery_fail`, `sys_supervisor`, `sys_queue_24h`, `sys_by_client`, `sys_auto_generic` (desfechos). Constantes `SYSTEM_CLOSE_TYPES`/`SYSTEM_CLOSE_OUTCOMES` exportadas de `closeConfig.seed.ts` como fonte única compartilhada entre o seed e a migration.
- Script `apps/api/src/scripts/migrate-close-config-system.ts` (`pnpm migrate:close-config-system`), idempotente via `ON CONFLICT DO NOTHING`, com aviso explícito quando algum `sys_*` não é criado por colisão de label com registro do admin.

### Alterado
- Close-config admin: registros com `is_system = true` passam a ser imutáveis — `update`, `delete` e `reorder` retornam `409 ConflictError`. As rotas de reorder passaram a mapear `ConflictError` para 409 (antes só tratavam 404, o que transformaria o guard em 500).
- Close-config admin: DTO passa a expor `isSystem`, preparando o badge visual de "sistema" na tela de administração.
- Modal de encerramento do agente: `listActiveCloseConfig` filtra `is_system`, então os registros automáticos não aparecem como opção selecionável manualmente.
- Schema de reorder: aceita ID em formato cuid **ou** com prefixo `sys_`, sem afrouxar a validação de cuid (que continua usando `z.string().cuid()` como autoridade). Aceitar o formato não autoriza a ação — o guard de negócio segue barrando com 409.

### Notas de migração
- Rodar `pnpm --filter @ziradesk/api migrate:close-config-system` (aceita `--schema=<tenant>` para um schema específico). Verificado idempotente em `tenant_demo`: a segunda execução insere 0 registros e não falha.
- **Nenhum job, webhook ou métrica foi alterado neste passo** — é apenas a fundação de dados. Os caminhos de encerramento automático seguem gravando só `closure_reason` (JSONB) e continuam fora de `byType`/`byOutcome` até o passo 3.
- Regressão conhecida: o reorder da tela `/admin/close-config` falha com 409 enquanto o frontend enviar os IDs de sistema no payload (`CloseConfig.tsx` monta `next.map((item) => item.id)` com a lista inteira). Será fechado no passo de frontend, filtrando por `isSystem`.

## [0.10.1] — Isolamento transacional por tenant e estabilização de webhooks

### Alterado
- API multitenant: `tenantSchemaFromJwt` deixou de usar `SET search_path` solto no pool e passou a vincular requests autenticadas de tenant a uma transação Prisma request-scoped com `SET LOCAL search_path`.
- Prisma: o client exportado passou a ser um proxy com contexto via `AsyncLocalStorage`; modelos globais (`tenant`, `plan`, `usageSnapshot`, `subscription`, `superAdmin`) seguem sempre pelo Prisma raiz.
- Tickets: tarefas best-effort de e-mail, webhooks e Redmine agora rodam em contexto Prisma raiz quando destacadas da resposta HTTP.

### Corrigido
- Webhooks Meta: preHandlers de assinatura agora retornam a resposta enviada em falhas de HMAC, evitando continuação da rota e erro `Cannot write headers after they are sent`.
- Webhook WhatsApp: o processamento pós-ACK foi explicitamente destacado com `setImmediate`, preservando resposta rápida sem dupla finalização de reply.
- Testes de e-mail inbound: fixtures passaram a usar segredo Svix válido e headers `svix-*` assinados, alinhados ao padrão atual do Resend.

### Segurança / Infraestrutura
- Fechada a dívida crítica de race condition de `search_path` entre tenants sob pool de conexões concorrente.
- Adicionados testes de integração para schema ativo, transação aninhada via proxy Prisma e isolamento concorrente entre tenants.

### Documentação
- `ARQUITETURA_TECNICA.md` atualizado para refletir o novo isolamento transacional e o estado real da dívida técnica.

## [0.10.0] — Remoção do módulo legado de roteamento OR-logic (Fase 4b parte 1)

### Removido
- Módulo legado de roteamento OR-logic (Fase 4b parte 1): `skills.service.ts`, `skills.routes.ts`, `skills.schema.ts`, `legacy-skills.infrastructure.ts`, provisionamento de `agent_bot_skills` para tenants novos, página `Skills.tsx`, `adminApi.skills.*`, interface `Skill` órfã, bloco i18n `tenantAdmin.skills` (pt-BR/en-US/es). Commit `655ca31` — 12 arquivos, 1040 deleções, zero inserções.
- `POST /api/admin/skills/agents/:userId` e os demais endpoints de `/api/admin/skills` deixam de existir; `/api/admin/skills-v2` é agora o único CRUD de habilidades. A rota `/admin/skills` do frontend já apontava para `SkillsV2` e segue funcionando (chave de nav `tenantAdmin.nav.skills` preservada).

### Documentação
- `ARQUITETURA_TECNICA.md` §16 atualizado: 3 novos itens de dívida técnica registrados (segundo motor de roteamento sem skills em tickets, `.env.test` com porta Postgres errada, tipos `AgentSkill`/`AgentWithSkills` desatualizados).

### Notas de migração
- **Nenhuma migration criada.** A tabela `agent_bot_skills` permanece intacta em todos os schemas existentes — apenas deixou de ser criada para tenants novos e não tem mais nenhum caminho de leitura ou escrita no código. Vazia em `tenant_demo`; **não verificada em produção** (pendente de restauração do servidor). O `DROP TABLE` e o eventual backfill dos vínculos legados para `skills`/`agent_skills`/`bot_option_skills` ficam para a parte 2.

## [0.9.9] — Correção do ACK do webhook de email inbound

### Corrigido
- API Webhooks: `POST /api/webhooks/email` valida assinatura antes de responder e aguarda o processamento do inbound antes do `200`, evitando ACK antecipado sem criação de ticket.
- Admin Canais: ao salvar um canal de e-mail, o endereço inbound gerado passa a ser enviado pela UI e persistido em `tenant.settings.inbound_email_address`, permitindo que o webhook resolva o tenant sem ajuste manual no banco.

### Segurança / Infraestrutura
- Email inbound: `RESEND_WEBHOOK_SECRET` ausente agora bloqueia em produção com `500`; fora de produção registra warning e permite o fluxo para desenvolvimento local.
- Email inbound: validação de assinatura passa a usar Svix (`svix-id`, `svix-timestamp`, `svix-signature`) com raw body da requisição, conforme o padrão do Resend.

## [0.9.8] — Settings públicos para agentes

### Adicionado
- API/Admin Settings: novo `GET /api/admin/settings/public`, autenticado para qualquer role do tenant, retorna somente permissões granulares de agente e flags operacionais não sensíveis.
- Web/Tickets: listagem e detalhe passam a consumir settings públicos para espelhar `agent_can_export_tickets` e `agent_can_delete_tickets` na UI.

### Segurança / Infraestrutura
- Settings públicos usam payload allowlist e não expõem campos administrativos, tokens, chaves, secrets ou configurações de webhook/SMTP.

## [0.9.7] — Ajustes visuais no detalhe de tickets

### Corrigido
- Tickets: removidos labels duplicados nas seções de atribuição e prazo do painel lateral, preservando o destaque de prazo vencido.
- Tickets: card de anexos do detalhe recebeu hover, badge de extensão e botão de remoção com estados visuais alinhados ao design system.

## [0.9.6] — Correção visual dos checkboxes do checklist

### Corrigido
- Tickets: checkboxes do checklist no detalhe passam a usar estilo customizado com tokens do design system, evitando aparência nativa inconsistente entre navegadores.

## [0.9.5] — Correção do toggle de SLA automático

### Corrigido
- Admin SLA: removido o handler duplicado no toggle de SLA automático, mantendo apenas o `onChange` do checkbox para evitar disparo duplo ao alternar a política.

## [0.9.4] — Correção do menu de ações do detalhe de tickets

### Corrigido
- Tickets: o menu de três pontos do detalhe não abre mais vazio para perfis sem permissão de exclusão e passa a renderizar fora dos painéis com `overflow`, evitando corte visual no cabeçalho.

## [0.9.3] — Correção de anexos órfãos em tickets

### Adicionado
- Tickets: o kanban passa a inicializar filtros por URL (`assigned_to`, `priority`, `category`, `status`, `overdue`) e o widget "Meus tickets" envia links contextuais para os tickets do agente.
- API Tickets: `GET /api/tickets` aceita `overdue=true` para filtrar tickets com prazo vencido.

### Corrigido
- Tickets: a listagem de anexos agora valida a existência do objeto no storage, remove registros órfãos e evita que o detalhe do ticket tente pré-carregar previews que resultariam em 404.
- Tickets: o autosave do detalhe consome cada patch debounced uma única vez, evitando loop de `PATCH` ao transferir/atribuir o ticket para outro agente.

## [0.9.2] — Skills v2, roteamento AND logic, reorganização de nav e bloqueadores de produção

### Adicionado
- Tickets: fila `queued`, auto-assign, claim e departamento no create (Bloco A)
- Tickets: presence status considerado no auto-assign (Bloco B)
- Tickets: e-mail de aviso de SLA 30min antes do vencimento (Bloco C)
- Tickets: aceitação explícita pelo agente designado
- Tickets: restrições de edição por status/role
- Tickets: pausa de SLA + escalação automática, CSAT por e-mail após resolução, notificações automáticas de e-mail ao contato, campo/modal de motivo de espera (`waiting_reason`), `ticket_number` sequencial com zero-padding
- Skills v2: novo modelo de dados (Fase 1), motor de roteamento AND logic com fallback inteligente (Fase 2), Admin UI + integração no BotMenu (Fase 3), métricas e limpeza do legado (Fase 4)
- Nav rail reorganizado: 12 itens → 8, com abas (Monitor+Fila, Análise = Métricas+Histórico+Performance, CRM = Contatos+Organizações)
- Nav lateral expansível
- Abrir atendimento diretamente pelo protocolo
- Script `apps/api/src/scripts/migrate-ticket-indexes.ts` — índices de `tickets` para tenants existentes

### Alterado
- Reestruturação visual do `TicketDetail` (arquétipo B)
- Refatoração visual do `Toaster` (estrutura zd-toast + ícones stroke-only)
- Melhorias visuais/UX da central de atendimento: bolha do cliente legível no tema claro, separador de mensagem de sistema, i18n da toolbar, hint Enter/Shift+Enter, painel de informações compactado
- `ensureTicketInfrastructure`: cache por schema (`Set<string>` via `current_schema()`) em vez de flag booleana global de processo — corrige tenants que ficavam sem o retrofit incremental de DDL

### Corrigido
- Guard de edição de ticket permitia agente fechar ticket resolvido
- SkillsV2: classe fantasma no header, selects cortados no modal de atribuição de agente
- Modal: `backdropFilter` blur removido (artefato de cor no overlay)
- Scroll vertical das colunas do kanban de tickets
- Busca de tickets por número e por status resolvido
- Categorias de ticket carregadas via API em vez de derivadas do lado do cliente
- i18n: nav rail, `OrganizationDetail`, componentes globais e páginas individuais (portal, campanhas, métricas, contatos, tickets, `CampaignDetail`, `ChecklistSection`, `TimeTrackingSection`)

### Removido
- Tipo `Ticket` duplicado em `packages/shared/src/types/ticket.ts` (não tinha consumidores)

### Segurança / Infraestrutura
- `tenantSchemaFromJwt.ts`: `schemaName` validado por regex (`^[a-z0-9_]+$`) antes de interpolar em `SET search_path` — fecha o vetor de injeção. **A race condition do `SET` sem `LOCAL` sob pool de conexões concorrente permanece — ver `ARQUITETURA_TECNICA.md` §16, é dívida técnica crítica, não foi resolvida nesta sessão.**
- `prisma/seed.ts`: seed do Super Admin agora falha (`throw`) se `SEED_SUPER_ADMIN_PASSWORD` não estiver definida — removido o fallback hardcoded (`ZiraDesk@2025`)
- Índices adicionados em `tickets(status)`, `tickets(assigned_to)`, `tickets(created_at)` e `tickets(department_id, status)` — ausentes desde a criação da tabela, agora presentes tanto no provisionamento de tenants novos quanto via script de migração para tenants existentes

### Documentação
- Auditoria completa de prontidão para produção (infra/deploy, banco/migrações, segurança, features críticas, testes, frontend, dívida técnica, config de produção, multitenancy, performance)
- `ARQUITETURA_TECNICA.md` §16 sincronizado: itens resolvidos marcados, novos itens registrados (race condition de `search_path`, bundle sem lazy-loading, CI não valida `apps/web`)

## [0.9.1] — Ajustes de Deploy Contabo
### Alterado
- Deploy de producao movido para workflow dedicado `.github/workflows/deploy-contabo.yml`
- Fluxo de deploy da VPS passou a usar `api-migrate` para `prisma migrate deploy`
- `docker-compose.production.yml` sobe apenas `postgres`, `redis`, `api`, `web` e `nginx` como servicos persistentes

### Corrigido
- Removida dependencia de `pnpm dlx` em runtime durante o deploy da Contabo
- Imagem final da API passou a embarcar o Prisma Client gerado no build
- Falha de restart da API em producao por `@prisma/client did not initialize yet`

### Documentacao
- `docs/technical/DEPLOY_VPS_DOCKER_COMPOSE.md` sincronizado com o workflow real da Contabo
- `docs/technical/DEPLOY.md` convertido para refletir a infra atual
- `ARQUITETURA_TECNICA.md` ajustado para VPS Contabo, dominios `.com` e portal desativado no Nginx

## [0.9.0] — Sprint de Estabilização
### Adicionado
- Abstração de storage com interface `StorageProvider`
- `R2StorageProvider` via `@aws-sdk/client-s3` (Cloudflare R2)
- `LocalStorageProvider` mantém comportamento de dev
- 78 testes de integração cobrindo: auth, middleware tenant, omnichannel webhooks, tickets, CRM, notifications, portal, super-admin, admin, calls, search, redmine, templates
- Portal: `POST /auth/forgot-password` e `POST /auth/reset-password`
- CI gate no GitHub Actions: testes obrigatórios antes do deploy Railway

### Alterado
- `settings.service.ts`, `profile.routes.ts`, `tickets.service.ts`: uploads migrados de disco local para `StorageProvider`
- Zero referências hardcoded a `public/uploads` no código

### Corrigido (correções de produção expostas pelos testes)
- Logout agora invalida sessão de fato (`auth:force_logout_after`)
- Tenant suspenso retorna 402 corretamente
- JWT de tenant A rejeitado em rotas de tenant B (403)
- HMAC inválido em webhooks retorna 401
- Webhooks WhatsApp/Instagram ignoram credenciais corrompidas sem quebrar
- `schemaName` propagado em tickets (`updateTicket`, `deleteTicket`, `attachments`)
- `schemaName` propagado em CRM (`organizations`, `contacts`)
- Vazamento de schema em eventos de tickets corrigido
- `channels.service.ts` e `channels.routes.ts` usam schema qualificado
- `tenants.service.ts` resiliente a schemas temporários durante agregação

### Documentação
- Sprint 3 (CRM) e Sprint 4 (Tickets) marcados como ✅ (estavam ❌)
- `ARQUITETURA_TECNICA.md` sincronizado com código real
- Nova seção 14: módulos além do MVP original
- Nova seção 15: dívida técnica conhecida

## [0.8.0] — Reestruturação do Omnichannel
### Adicionado
- Novo ciclo de status de conversas: `open`, `waiting` e `closed`.
- Migration multitenant para migrar status legados e adicionar `closure_reason`, `waiting_expires_at` e `queue_entered_at`.
- Nova fila operacional em `GET /api/omnichannel/queue`, com atribuição manual em `POST /api/omnichannel/queue/:id/assign-me`.
- Novo encerramento único em `POST /api/omnichannel/conversations/:id/close`, gravando motivo, desfecho, observações, agente e data de encerramento.
- Modal de encerramento consumindo os motivos/desfechos ativos cadastrados em `/api/omnichannel/close-config`.
- Job de expiração de conversas `waiting`, encerrando automaticamente envios ativos sem resposta.
- Separação de grupo e assunto do bot na fila de atendimento.

### Alterado
- Envio ativo passa a usar `status = waiting` com `conversation_type = outbound`.
- Conversas sem agente continuam com `status = open`, mas são tratadas como fila quando `assigned_to IS NULL`.
- Aba **Aberto** exibe apenas atendimentos atribuídos a agentes humanos.
- Página **Fila de atendimentos** exibe somente conversas abertas sem agente e mostra o tempo de espera na coluna **Espera**.
- Botão de encerramento simplificado para **Encerrar**.
- `omnichannelApi` passou a usar `closeConversation`, `getQueue`, `getQueueCount` e `assignMe`.

### Removido
- Fluxos legados baseados em `pending`, `resolved`, `bot`, `active_outbound` e `in_service`.
- Endpoint legado `/api/omnichannel/conversations/:id/resolve`.
- Modal legado `ResolveModal`.

### Compatibilidade
- Esta versão altera contrato de API e persistência. Rodar a migration Prisma antes do deploy da API/web.

## [0.7.0] — Sessão atual — Evolução pós-MVP
### Adicionado
- RBAC completo: middleware backend (requirePermission/requireAnyPermission),
  hook usePermission, PermissionGate, ProtectedRoute, tela de Permissões e Acessos
- Tipos compartilhados de permissões em packages/shared (Role, Permission, ROLE_PERMISSIONS)
- Validação x-hub-signature-256 nos webhooks Meta (WhatsApp + Instagram)
- Instagram outbound via Meta Graph API com retry inteligente e erros permanentes
- Email outbound via Resend com fallback de credenciais para .env
- CSAT expiration configurável por tenant (campo csatExpirationHours nas settings)
- Logger estruturado Pino com redact de dados sensíveis (substitui console.* de runtime)
- Super Admin Tenants: KPIs globais, colunas Usuários/Conversas/Trial até,
  dropdown de ações, impersonate, modal editar plano, confirmação de cancelamento
- Super Admin Dashboard: seções "Últimos tenants" e "Trials expirando em breve"
- Monitor em tempo real: subtítulo, contexto no SLA, CSAT com estrela
- Tela de Usuários: modal de confirmação Desativar/Reativar, badge "Você", estado vazio
- i18n Admin completo: nav lateral e Settings sem textos hardcoded
- Correção de presença: reconnect robusto, heartbeat manual 25s,
  grace period 5s, Page Visibility API
- Fix de logout involuntário na atribuição: auto-assign valida socket ativo,
  atribuição manual bloqueia agente offline (409)
- Filtros de notificação: sem notificação para conversas no bot (status=bot)
  e para conversas de outros agentes
- Balões de mensagem curtos: min-width e padding consistentes
- Remoção de Dashboard do painel Admin (redirect para Usuários)
- Remoção de EditClientModal.tsx órfão

### Corrigido
- Badge "Aguardando" em âmbar (era roxo) nas métricas de tickets
- i18n: pluralização "há 1 dia" (era "há 1 dias")
- Coluna Usuários: limite ilimitado exibe "—" em vez de "∞"
- Idioma padrão nas Settings agora aplica i18n.changeLanguage() imediatamente

---

## [0.6.1] — Sprint 6B — Preparação para produção
### Adicionado
- Code splitting com manualChunks (bundle < 500kB)
- Rota /health com verificação de banco e Redis
- Graceful shutdown (SIGTERM/SIGINT)
- CORS restrito para domínios ZiraDesk em produção
- Rate limiting por tipo de rota
- Dockerfile otimizado multi-stage para a API
- railway.toml para configuração de deploy
- scripts/deploy.sh automatizado
- docs/technical/DEPLOY.md completo

---

## [0.6.0] — Sprint 6 — Polimento MVP
### Adicionado
- Central de notificações in-app com badge e dropdown
- Busca global com atalho ⌘K/Ctrl+K
- Onboarding checklist para novos tenants
- Página de upgrade de plano
- Error boundary global
- Toast notifications em todas as ações
- Página 404 customizada
- Empty states em todas as listas

---

## [0.5.0] — Sprint 5B — Omnichannel Frontend completo
### Adicionado
- Layout 3 painéis: lista de conversas, chat e painel de info do contato
- Mensagens em tempo real via Socket.io (conversation:new_message, conversation:updated, conversation:created)
- Balões de mensagem com status de entrega (enviado / entregue / lido) e ícones de check
- Indicador de digitação animado (3 pontos pulsantes)
- Notas internas com fundo âmbar e label "NOTA INTERNA"
- Respostas rápidas como chips clicáveis no chat
- Auto-resize do textarea de mensagem
- Painel de info do contato com tabs: Contato, Canais, Histórico
- Mini-stats do contato: mensagens, atendimentos, 1º contato, engajamento
- Botão "Ver perfil completo" navegando para /crm/contacts?id=:id
- Ações rápidas: criar proposta, agendar, ver tickets, criar ticket
- Modal de criação de nova conversa (busca de contato + seleção de canal + assunto + mensagem inicial)
- Filtro "Meus atendimentos" com toggle animado na lista
- Unread dot e nome/preview em negrito para conversas com mensagens não lidas
- Badge de contagem de conversas no header da lista
- Botão "Novo atendimento" funcional na topbar e na lista (via CustomEvent)
- Namespace i18n `omnichannel` em pt-BR, en-US e es
- omnichannelApi em services/api.ts: listConversations, getConversation, createConversation, listMessages, sendMessage, resolve, assign, transfer

---

## [0.5.0-backend] — Sprint 5A — Omnichannel Backend
### Adicionado
- Padronização de status: open, pending, resolved, bot (substituído in_service)
- Filtro assigned_to_me na listagem de conversas
- Criação de nova conversa via POST /api/omnichannel/conversations
- Rota de assign separada: POST /api/omnichannel/conversations/:id/assign
- Rota de transfer: POST /api/omnichannel/conversations/:id/transfer
- Socket.io: agent rooms (agent:{userId}) para notificações direcionadas
- Webhooks sem auth JWT: WhatsApp (Evolution API), Instagram (Meta Graph), Email (Resend inbound)
- Verificação HMAC-SHA256 no webhook WhatsApp via EVOLUTION_API_KEY
- Verificação de token no webhook Instagram via META_VERIFY_TOKEN
- Lookup cross-tenant por instance/page_id/email nas credenciais dos canais
- Processamento de webhooks em transações Prisma com SET LOCAL search_path
- Fila de mensagens BullMQ (3 tentativas, backoff exponencial 2s)
- Worker de envio real via Evolution API para WhatsApp
- config/redis.ts centralizado com ioredis
- utils/crypto.ts com decryptCredentials compartilhado

---

## [0.1.1] — i18n
### Adicionado
- i18next + react-i18next no frontend
- Suporte a pt-BR, en-US e es
- Detecção automática de idioma pelo browser
- Namespaces: common, auth
- Middleware de linguagem no backend (Accept-Language)
- Mensagens de erro da API internacionalizadas

---

## [0.1.0] — Sprint 0 — Fundação
### Adicionado
- Monorepo pnpm workspaces (apps/api, apps/web, packages/shared)
- PostgreSQL 16 + Redis 7 via Docker Compose
- Schema público com tabelas: plans, tenants, subscriptions, super_admins
- Autenticação JWT com access token (15min) + refresh token (7 dias) em httpOnly cookie
- Middleware de tenant por subdomínio com SET search_path
- Middleware de autenticação e RBAC
- Socket.io com rooms por tenant
- Axios com interceptor de refresh automático de token
- Zustand store de autenticação
- React Router v6 com guards RequireAuth e RequireSuperAdmin
- Tela de login e recuperação de senha
- Componentes UI base: Button, Input, Card
- i18n completo: pt-BR, en-US, es (interface + erros da API)
- Middleware de linguagem no backend (Accept-Language)
