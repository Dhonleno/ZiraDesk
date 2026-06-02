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

## 4) Subir stack

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

## 5) Verificações rápidas

```bash
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs -f nginx
docker compose -f docker-compose.production.yml logs -f api
curl -I https://api.ziradesk.com/health
```

## 6) CI/CD para Contabo

O workflow `.github/workflows/ci.yml` faz deploy na VPS Contabo depois que o
job de testes passa em pushes para `main`.

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
5. `prisma migrate deploy`
6. `docker compose ... up -d --remove-orphans`
7. `nginx -t`, reload do Nginx e smoke test interno da API

## Observações de segurança aplicadas

- Apenas `nginx` publica portas externas (`80` e `443`).
- `postgres` e `redis` não possuem publish de porta externa.
- Dados persistentes ficam fora do repositório em `../data/*`.
- Limites de memória somam ~`5.25GB` (folga para VPS de 8GB).
