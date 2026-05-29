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

O Nginx usa esses arquivos para `app.ziradesk.com.br` e `api.ziradesk.com.br`.

## 4) Subir stack

```bash
docker compose --env-file .env.production -f docker-compose.production.yml up -d --build
```

## 5) Verificações rápidas

```bash
docker compose -f docker-compose.production.yml ps
docker compose -f docker-compose.production.yml logs -f nginx
docker compose -f docker-compose.production.yml logs -f api
curl -I https://api.ziradesk.com.br/health
```

## Observações de segurança aplicadas

- Apenas `nginx` publica portas externas (`80` e `443`).
- `postgres` e `redis` não possuem publish de porta externa.
- Dados persistentes ficam fora do repositório em `../data/*`.
- Limites de memória somam ~`5.25GB` (folga para VPS de 8GB).
