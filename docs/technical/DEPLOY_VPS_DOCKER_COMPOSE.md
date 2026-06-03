# Deploy em VPS (Docker Compose)

Este guia usa os arquivos:
- `docker-compose.production.yml`
- `apps/api/Dockerfile`
- `apps/web/Dockerfile`
- `deploy/nginx/*`

## 1) Preparar variáveis

No servidor (`~/ziradesk/app`):

```bash
cp .env.production.example .env.production
cp apps/api/.env.production.example apps/api/.env.production
```

Edite:
- `.env.production` (senhas, domínios e URLs públicas)
- `apps/api/.env.production` (todas as variáveis obrigatórias da API)

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
- O portal `suporte.{tenant}.ziradesk.com` esta intencionalmente desativado.
- O Origin Certificate atual nao cobre `*.*.ziradesk.com`.
- Para reativar o portal, e necessario emitir novo certificado com cobertura
  para esse padrao e restaurar o vhost removido do Nginx.

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

O workflow `.github/workflows/ci.yml` continua responsavel apenas pelos testes.

Secret obrigatorio no GitHub:
- `CONTABO_SSH_PRIVATE_KEY`: chave privada SSH autorizada para o usuario
  `deploy` na VPS.

Secrets opcionais, com defaults atuais:
- `CONTABO_HOST` (default: `85.239.245.8`)
- `CONTABO_USER` (default: `deploy`)
- `CONTABO_PORT` (default: `22`)
- `CONTABO_DEPLOY_PATH` (default: `/home/deploy/ziradesk/app`)

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

## Observações de segurança aplicadas

- Apenas `nginx` publica portas externas (`80` e `443`).
- `postgres` e `redis` não possuem publish de porta externa.
- Dados persistentes ficam fora do repositório em `../data/*`.
- Limites de memória somam ~`5.25GB` (folga para VPS de 8GB).
