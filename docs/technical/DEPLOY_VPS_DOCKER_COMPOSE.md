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
docker compose --env-file .env.production -f docker-compose.production.yml up -d --remove-orphans postgres redis api web nginx
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

Pendencia da migracao de 2026-08-02: o workflow ainda tem o IP antigo
`85.239.245.8` como default/valor hardcoded e nao funciona corretamente para o
novo VPS (`66.94.105.48`) ate ser atualizado em tarefa propria.

O workflow `.github/workflows/ci.yml` continua responsavel apenas pelos testes.

Secret obrigatorio no GitHub:
- `CONTABO_SSH_PRIVATE_KEY`: chave privada SSH autorizada para o usuario
  `deploy` na VPS.

Secrets opcionais, com defaults atuais:
- `CONTABO_HOST` (default atual no workflow: `85.239.245.8`, pendente de troca)
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
6. `docker compose ... up -d --remove-orphans postgres redis api web nginx`
7. `nginx -t`, reload do Nginx e smoke test interno da API

Detalhes importantes do fluxo atual:
- `api-migrate` usa o stage `builder` do `apps/api/Dockerfile`
- a migration nao depende de `pnpm dlx` nem de download em runtime
- a imagem final da API ja carrega o Prisma Client gerado no build

## Backup e Recuperação

### Configuração

O backup automático é executado diariamente às 03h00 via cron
no usuário `deploy` da VPS.

Pendencia da migracao de 2026-08-02: o cron de backup (`rclone` + `pg_dump` para
Cloudflare R2) ainda nao foi reconfigurado no servidor novo. O
`vps-bootstrap.sh` nao cobre essa etapa.

**Destino:** Cloudflare R2 — bucket `ziradesk-backups`
**Ferramenta:** rclone v1.74+ (instalado em `/usr/bin/rclone`)
**Config rclone:** `/home/deploy/.config/rclone/rclone.conf`

`ops/backup.sh` e `ops/restore.sh` têm defaults alinhados à topologia de
produção (`POSTGRES_USER=ziradesk`, `UPLOADS_DIR=/home/deploy/ziradesk/data/uploads`),
então podem ser chamados sem variáveis extras nos três caminhos de invocação:
cron, GitHub Action "Backup Manual" e execução manual via SSH. Todas as
variáveis continuam overridáveis por ambiente caso a topologia mude
(`POSTGRES_CONTAINER`, `POSTGRES_USER`, `POSTGRES_DB`, `UPLOADS_DIR`,
`R2_REMOTE`, `RCLONE_CONFIG`, `LOG_FILE`).

### O que é salvo

| Item | Formato | Retenção |
|------|---------|----------|
| PostgreSQL (dump completo) | `.dump` (pg_dump -Fc) | 7 dias diários + 4 mensais |
| Uploads (anexos e arquivos) | `.tar.gz` | 7 dias diários + 4 mensais |

### Estrutura no R2

```text
ziradesk-backups/
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
rclone ls r2:ziradesk-backups \
  --config /home/deploy/.config/rclone/rclone.conf
```

### Restaurar um backup

```bash
# 1. Baixar o dump do R2
rclone copy r2:ziradesk-backups/daily/postgres/postgres_YYYY-MM-DD_HH-MM-SS.dump \
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

- `.github/workflows/deploy-contabo.yml` ainda aponta para o IP antigo
  `85.239.245.8`; deploy automatico via `git push` para `main` depende da troca
  para `66.94.105.48`.
- `.github/workflows/backup-manual.yml` ainda usa o IP antigo como unico valor
  conhecido.
- Secrets GitHub `CONTABO_SSH_PRIVATE_KEY` e `VPS_SSH_KEY` precisam ser
  regenerados para o servidor novo.
- Cron de backup com `rclone` + `pg_dump` para Cloudflare R2 ainda nao foi
  reconfigurado no novo VPS.
- Teste funcional completo de login via seed do super admin ainda nao foi
  realizado nesta migracao; ate agora houve apenas validacao tecnica (`/health`
  e `curl -I`).
