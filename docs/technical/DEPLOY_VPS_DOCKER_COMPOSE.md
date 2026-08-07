# Deploy em VPS (Docker Compose)

Este guia usa os arquivos:
- `docker-compose.production.yml`
- `apps/api/Dockerfile`
- `apps/web/Dockerfile`
- `deploy/nginx/*`

## Passo 0: Provisionamento de VPS nova (root -> deploy)

Este passo cobre o intervalo "VPS crua -> repo clonado". Na migracao de
2026-08-02, o procedimento foi executado no novo Contabo Cloud VPS 6 Core
(`66.94.105.48`, hostname `vmi3482143`, US-East).

1. Copiar `vps-bootstrap.sh` para o servidor:

```bash
scp vps-bootstrap.sh root@<ip-da-vps>:/root/vps-bootstrap.sh
ssh root@<ip-da-vps>
cd /root
file vps-bootstrap.sh
```

Se o checkout Windows introduzir CRLF, corrigir antes de executar:

```bash
sed -i 's/\r$//' vps-bootstrap.sh
```

2. Verificar conflitos antes de rodar o bootstrap:

```bash
ls /etc/apt/sources.list.d/
ls /etc/apt/keyrings/
swapon --show
```

Se o Docker ja foi instalado manualmente pelo mesmo metodo do script, nao
duplicar repositorio/chave. Se ja houver swap ativo, nao criar swap duplicado.

3. Conferir drop-ins do SSH antes de assumir que `sshd_config` e efetivo:

```bash
ls -la /etc/ssh/sshd_config.d/
sshd -T | grep -Ei 'permitrootlogin|passwordauth'
```

Atencao Contabo/Ubuntu 24.04: drop-ins em `/etc/ssh/sshd_config.d/` podem ser
lidos antes do `/etc/ssh/sshd_config` principal, e no OpenSSH a primeira
ocorrencia de uma diretiva vence. Na migracao de 2026-08-02,
`50-cloud-init.conf` continha `PasswordAuthentication yes`; foi necessario
corrigir manualmente antes do bootstrap:

```bash
sed -i 's/PasswordAuthentication yes/PasswordAuthentication no/' \
  /etc/ssh/sshd_config.d/50-cloud-init.conf
sshd -T | grep -Ei 'permitrootlogin|passwordauth'
```

`PermitRootLogin` nao tinha conflito em drop-in nessa imagem, entao o
`vps-bootstrap.sh` resolveu a diretiva no arquivo principal.

4. Manter uma segunda sessao SSH root aberta como salva-vidas. O bootstrap
desabilita `PermitRootLogin` no passo 3 de 10 antes de validar a chave do
usuario `deploy`.

5. Rodar o bootstrap diretamente como root, com TTY interativo:

```bash
SSH_PUB_KEY="<linha completa da chave publica>" bash vps-bootstrap.sh
```

Nao rodar via pipe/non-interactive sem `AUTO_CONFIRM=true`. Evitar `sudo` para
este comando: `sudo` pode descartar `SSH_PUB_KEY` por `env_reset`.

6. Antes de fechar as sessoes root, abrir uma terceira sessao nova e validar:

```bash
ssh -i <chave> -o IdentitiesOnly=yes deploy@<ip-da-vps>
sudo whoami
docker ps
```

7. Como `deploy`, gerar uma deploy key dedicada para o GitHub:

```bash
ssh-keygen -t ed25519 -C "ziradesk-deploy-<host>" \
  -f ~/.ssh/id_ed25519_github -N ""
cat ~/.ssh/id_ed25519_github.pub
```

Cadastrar a chave publica em GitHub -> Settings -> Deploy keys do repo, sem
`Allow write access`. O acesso somente leitura e suficiente para `git pull`.

8. Configurar `~/.ssh/config` do usuario `deploy`:

```sshconfig
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/id_ed25519_github
  IdentitiesOnly yes
```

9. Clonar o repo e criar os diretorios persistentes um nivel acima do clone:

```bash
mkdir -p ~/ziradesk
cd ~/ziradesk
git clone git@github.com:Dhonleno/ZiraDesk.git app
mkdir -p ~/ziradesk/data/{postgres,redis,uploads}
mkdir -p ~/ziradesk/logs/nginx
mkdir -p ~/ziradesk/certs
```

## 1) Preparar variáveis

No servidor (`~/ziradesk/app`):

```bash
cp .env.production.example .env.production
cp apps/api/.env.production.example apps/api/.env.production
```

Edite:
- `.env.production` (senhas, domínios e URLs públicas)
- `apps/api/.env.production` (todas as variáveis obrigatórias da API)

Notas de boot em producao:
- `META_APP_SECRET` e validado como obrigatorio no boot mesmo sem canal
  WhatsApp ativo. Enquanto a integracao real nao estiver configurada, usar um
  placeholder nao-vazio e substituir pela credencial real depois.
- `RESEND_FROM_EMAIL` precisa ter formato de e-mail valido. String vazia e
  rejeitada; usar um endereco de formato valido, por exemplo
  `noreply@ziradesk.com`, ate configurar `RESEND_API_KEY`.

## 2) Garantir diretórios persistentes (fora do repositório)

```bash
mkdir -p ~/ziradesk/data/{postgres,redis,uploads}
mkdir -p ~/ziradesk/logs/nginx
mkdir -p ~/ziradesk/certs
```

## 3) Certificados TLS

Os certificados devem existir em:
- `~/ziradesk/certs/fullchain.pem`
- `~/ziradesk/certs/privkey.pem`

O Nginx usa esses arquivos para `app.ziradesk.com`, `api.ziradesk.com` e
`*.ziradesk.com`.

Observacao operacional:
- O certificado Origin CA gerado na migracao de 2026-08-02 cobre
  `ziradesk.com` e `*.ziradesk.com`, valido ate 2041.
- Origin Certificates da Cloudflare nao suportam wildcard de dois niveis
  (`*.*.ziradesk.com`) nem wildcard interno. Portanto, gerar novamente um
  Origin Certificate nao resolve `suporte.{tenant}.ziradesk.com`.
- Consequencia: o portal `suporte.{tenant}.ziradesk.com` continua sem TLS de
  origem valido. Alternativas futuras, ainda nao implementadas: enumerar
  hostnames por tenant no certificado; investigar Cloudflare Advanced
  Certificate Manager; ou redesenhar a URL do portal para evitar dois niveis de
  subdominio.

## 4) Subir stack

```bash
docker compose --env-file .env.production -f docker-compose.production.yml build
docker compose --env-file .env.production -f docker-compose.production.yml up -d postgres redis
docker compose --env-file .env.production -f docker-compose.production.yml run --rm api-migrate
docker compose --env-file .env.production -f docker-compose.production.yml up -d --remove-orphans postgres redis api web marketing nginx
```

## 5) Verificações rápidas

```bash
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs -f nginx
docker compose -f docker-compose.production.yml logs -f api
curl -I https://api.ziradesk.com/health
```

## 6) CI/CD para Contabo

O deploy automatico da VPS Contabo roda no workflow dedicado
`.github/workflows/deploy-contabo.yml`.

Atualizado em 2026-08-02: o default do host no workflow ja aponta para o novo
VPS (`66.94.105.48`). Continua pendente a regeneracao do secret
`CONTABO_SSH_PRIVATE_KEY`, que ainda contem a chave do servidor antigo — ate
isso ser feito no painel do GitHub, o deploy automatico falha na autenticacao
SSH mesmo com o IP correto.

O workflow `.github/workflows/ci.yml` continua responsavel apenas pelos testes.

Secret obrigatorio no GitHub:
- `CONTABO_SSH_PRIVATE_KEY`: chave privada SSH autorizada para o usuario
  `deploy` na VPS.

Secrets opcionais, com defaults atuais:
- `CONTABO_HOST` (default atual no workflow: `66.94.105.48`)
- `CONTABO_USER` (default: `deploy`)
- `CONTABO_PORT` (default: `22`)
- `CONTABO_DEPLOY_PATH` (default: `/home/deploy/ziradesk/app`)

Tambem pendente: os secrets `CONTABO_SSH_PRIVATE_KEY` e `VPS_SSH_KEY` ainda
referenciam a chave do servidor antigo e precisam ser regenerados para o novo
servidor.

Fluxo executado no servidor:
1. `git pull --ff-only origin main`
2. `nginx -t` antes do deploy, quando o container ja existe
3. `docker compose --env-file .env.production -f docker-compose.production.yml build`
4. `docker compose ... up -d postgres redis`
5. `docker compose ... run --rm api-migrate`
6. `docker compose ... up -d --remove-orphans postgres redis api web marketing nginx`
7. `nginx -t`, reload do Nginx e smoke test interno da API

Detalhes importantes do fluxo atual:
- `api-migrate` usa o stage `builder` do `apps/api/Dockerfile`
- a migration nao depende de `pnpm dlx` nem de download em runtime
- a imagem final da API ja carrega o Prisma Client gerado no build

## Resolução dinâmica de upstream no Nginx (`resolver`)

O Nginx **não usa mais blocos `upstream` nomeados**. Os três backends são
declarados por server block em variáveis (`set $backend_api "api:3333";` etc.) e
os 13 `proxy_pass` usam essas variáveis com `$request_uri` explícito. O
`resolver 127.0.0.11 valid=10s ipv6=off` fica no bloco `http{}` de
`deploy/nginx/nginx.conf`.

Motivo: com upstream nomeado o hostname era resolvido uma única vez, na carga da
config. Se o container `api` fosse recriado fora de um deploy (OOM, crash, reboot
do host), o Nginx seguia apontando para o IP morto até o próximo reload — 502 nas
9 locations de API, mascarado por `/` continuar em 200. Ver
`ARQUITETURA_TECNICA.md` seção 16.

### Verificação pós-deploy

```bash
docker compose -f docker-compose.production.yml exec -T nginx nginx -t </dev/null
```

Erro `unknown "backend_xxx" variable` significa que algum server block usa uma
variável que não declarou — a conversão é por-server, cada bloco declara as suas.

Smoke das 10 locations alcançáveis de fora (trocar `{tenant}` por um tenant real):

```bash
for u in \
  https://app.ziradesk.com/ \
  https://app.ziradesk.com/api/webhooks/whatsapp \
  "https://app.ziradesk.com/socket.io/?EIO=4&transport=polling" \
  https://ziradesk.com/ \
  https://ziradesk.com/api/webhooks/whatsapp \
  https://api.ziradesk.com/health \
  "https://api.ziradesk.com/socket.io/?EIO=4&transport=polling" \
  https://{tenant}.ziradesk.com/ \
  https://{tenant}.ziradesk.com/api/webhooks/whatsapp \
  "https://{tenant}.ziradesk.com/socket.io/?EIO=4&transport=polling" ; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$u")" "$u"
done
```

Esperado: `200` nas rotas de front e em `/health`; `403` em
`/api/webhooks/whatsapp` (sem token). Qualquer `502` é regressão.

As 3 locations de `suporte.{tenant}.ziradesk.com` **não são testáveis de fora**:
o certificado da Cloudflare não cobre dois níveis de subdomínio e o handshake TLS
falha na borda (`curl` sai com código 35, com ou sem `-k`). Testar direto na
origem, de dentro do container:

```bash
docker compose -f docker-compose.production.yml exec -T nginx \
  wget -qS -O /dev/null --no-check-certificate \
  --header="Host: suporte.{tenant}.ziradesk.com" \
  https://127.0.0.1/api/webhooks/whatsapp </dev/null
```

### Prova de fechamento: absorver IP novo sem reload

Valida a correção, não apenas a não-regressão. Derruba a API por alguns segundos
por natureza (`--force-recreate`), então rodar em janela de baixo tráfego e com o
comando de recuperação já pronto.

```bash
# 1. Canário: recriar `marketing` primeiro (raio de ação = só a landing do apex)
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ziradesk-marketing </dev/null
docker compose -f docker-compose.production.yml up -d --force-recreate --no-deps marketing </dev/null
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ziradesk-marketing </dev/null
sleep 12 && curl -s -o /dev/null -w '%{http_code} apex /\n' https://ziradesk.com/

# 2. Só se o canário passar: o `api`
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ziradesk-api </dev/null
docker compose -f docker-compose.production.yml up -d --force-recreate --no-deps api </dev/null
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ziradesk-api </dev/null

# 3. Esperar `healthy` ANTES de medir
until [ "$(docker inspect -f '{{.State.Health.Status}}' ziradesk-api)" = healthy ]; do sleep 3; done

# 4. Passar o valid=10s e medir, SEM reload
sleep 12
curl -s -o /dev/null -w '%{http_code} app /api/webhooks (esperado 403)\n' https://app.ziradesk.com/api/webhooks/whatsapp
curl -s -o /dev/null -w '%{http_code} api /health (esperado 200)\n' https://api.ziradesk.com/health

# 5. Recuperação, se der 502
docker compose -f docker-compose.production.yml exec -T nginx nginx -s reload </dev/null
```

### Armadilhas medidas

- **`/api/health` retorna `404`, não `200`.** A rota da API é `/health`
  (`apps/api/src/server.ts`); `/api/health` não existe. O `404` vem do Fastify
  (`{"message":"Route GET:/api/health not found",...}`) e portanto prova que o
  upstream está vivo — upstream morto dá `502`. Ainda assim, preferir
  `/api/webhooks/whatsapp` (`403`) como sinal positivo inequívoco.
- **`sleep 12` sozinho não basta após `--force-recreate`.** O healthcheck do
  `api` tem `start_period: 20s` e `interval: 15s`; medir antes de `healthy`
  produz `502` de container subindo, que parece falha da conversão. Daí o passo 3.
- **Todo `docker compose exec -T` precisa de `</dev/null`.** Sem isso o comando
  consome o stdin do script chamador e a linha seguinte não roda, em silêncio.
- **Falha de backend migrou de startup-time para request-time.** Antes, um nome
  errado impedia o Nginx de subir (`host not found in upstream`); agora aparece
  como `502` + `could not be resolved` no error log. Variável não declarada
  continua sendo pega por `nginx -t`.

## Backup e Recuperação

### Configuração

O backup automático é executado diariamente às 03h00 via cron
no usuário `deploy` da VPS.

Pendencia da migracao de 2026-08-02: o cron de backup (`rclone` + `pg_dump` para
Cloudflare R2) ainda nao foi reconfigurado no servidor novo. O
`vps-bootstrap.sh` nao cobre essa etapa.

**Destino:** Cloudflare R2 — bucket `ziradesk-backups-prod`
**Ferramenta:** rclone v1.74+ (instalado em `/usr/bin/rclone`)
**Config rclone:** `/home/deploy/.config/rclone/rclone.conf`

`ops/backup.sh` e `ops/restore.sh` têm defaults alinhados à topologia de
produção (`POSTGRES_USER=ziradesk`, `UPLOADS_DIR=/home/deploy/ziradesk/data/uploads`),
então podem ser chamados sem variáveis extras. Todas as variáveis continuam
overridáveis por ambiente caso a topologia mude (`POSTGRES_CONTAINER`,
`POSTGRES_USER`, `POSTGRES_DB`, `UPLOADS_DIR`, `R2_REMOTE`, `RCLONE_CONFIG`,
`LOG_FILE`).

**Atenção: os scripts que executam em produção NÃO são os do repositório.** Os
três caminhos de invocação — cron das 03h00, GitHub Action "Backup Manual"
(`backup-manual.yml`) e execução manual via SSH — chamam
`/home/deploy/scripts/backup.sh` e `/home/deploy/scripts/restore.sh`. Esses são
**cópias manuais** de `ops/*.sh`: arquivos regulares, **não symlinks**
(verificar com `ls -la /home/deploy/scripts/`). O `git pull --ff-only` do
`deploy-contabo.yml` atualiza somente `~/ziradesk/app/ops/`, e **nenhum passo do
deploy propaga para `/home/deploy/scripts/`**.

Consequência prática: toda alteração em `ops/backup.sh` ou `ops/restore.sh`
exige re-cópia manual no servidor antes de ter qualquer efeito real. Depois do
deploy, rodar:

```bash
cp ~/ziradesk/app/ops/backup.sh ~/ziradesk/app/ops/restore.sh /home/deploy/scripts/
chmod +x /home/deploy/scripts/backup.sh /home/deploy/scripts/restore.sh
```

Isto já causou dessincronização real: em 2026-08-03, após o deploy que levou ao
repositório a verificação pós-upload (`verify_uploaded`) e a correção do bucket
para `ziradesk-backups-prod`, o `/home/deploy/scripts/backup.sh` continuou sendo
a versão antiga — sem verificação e apontando para o bucket errado — até a
re-cópia manual ser executada. Enquanto a cópia não é feita, o repositório e o
que roda às 03h00 divergem silenciosamente.

### O que é salvo

| Item | Formato | Retenção |
|------|---------|----------|
| PostgreSQL (dump completo) | `.dump` (pg_dump -Fc) | 7 dias diários + 4 mensais |
| Uploads (anexos e arquivos) | `.tar.gz` | 7 dias diários + 4 mensais |

### Estrutura no R2

```text
ziradesk-backups-prod/
├── daily/
│   ├── postgres/   ← retém 7 dias
│   └── uploads/    ← retém 7 dias
└── monthly/
    └── YYYY-MM/    ← retém 120 dias / ~4 meses (criado dia 1 de cada mês)
```

### Executar backup manual

**Via GitHub Actions (recomendado):**
1. Actions → "Backup Manual" → Run workflow
2. Digite "backup" no campo de confirmação

**Via SSH:**
```bash
ssh deploy@66.94.105.48
/home/deploy/scripts/backup.sh
tail -50 /home/deploy/ziradesk-backup.log
```

### Verificar backups no R2

```bash
ssh deploy@66.94.105.48
rclone ls r2:ziradesk-backups-prod \
  --config /home/deploy/.config/rclone/rclone.conf
```

### Restaurar um backup

```bash
# 1. Baixar o dump do R2
rclone copy r2:ziradesk-backups-prod/daily/postgres/postgres_YYYY-MM-DD_HH-MM-SS.dump \
  /tmp/ --config /home/deploy/.config/rclone/rclone.conf

# 2. Executar restore (interativo, pede confirmação)
/home/deploy/scripts/restore.sh /tmp/postgres_YYYY-MM-DD_HH-MM-SS.dump
```

### Log de backups

```bash
tail -100 /home/deploy/ziradesk-backup.log
```

## Observações de segurança aplicadas

- Apenas `nginx` publica portas externas (`80` e `443`).
- `postgres` e `redis` não possuem publish de porta externa.
- Dados persistentes ficam fora do repositório em `../data/*`.
- Limites de memória somam ~`5.25GB` (folga para VPS de 8GB).

## Pendências conhecidas pós-migração 2026-08-02

- Secrets GitHub `CONTABO_SSH_PRIVATE_KEY` e `VPS_SSH_KEY` precisam ser
  regenerados para o servidor novo. O IP ja foi corrigido para `66.94.105.48`
  em `deploy-contabo.yml` e `backup-manual.yml`, mas enquanto os secrets
  apontarem para a chave do servidor antigo os dois workflows falham na
  autenticacao SSH. E acao fora do repo: gerar o par de chaves no servidor e
  cadastrar a privada em GitHub -> Settings -> Secrets.
- `backup-manual.yml` mantem o host como valor literal, sem o padrao
  `secrets.CONTABO_HOST || <default>` usado no deploy, e usa `VPS_SSH_KEY` em
  vez de `CONTABO_SSH_PRIVATE_KEY`. Unificar host e secret de chave entre os
  dois workflows fica para a tarefa de regeneracao dos secrets.
- Cron de backup com `rclone` + `pg_dump` para Cloudflare R2 ainda nao foi
  reconfigurado no novo VPS.
- Teste funcional completo de login via seed do super admin ainda nao foi
  realizado nesta migracao; ate agora houve apenas validacao tecnica (`/health`
  e `curl -I`).
