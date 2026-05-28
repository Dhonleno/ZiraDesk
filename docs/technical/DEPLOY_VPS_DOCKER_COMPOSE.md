# Deploy em VPS (Docker Compose)

Este é o guia oficial de produção do ZiraDesk no ambiente Contabo.

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

## 6) Deploy remoto a partir desta máquina (Windows/PowerShell)

Comando de acesso SSH desta máquina:

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519" deploy@85.239.245.8
```

Deploy completo em um único comando:

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519" deploy@85.239.245.8 "set -euo pipefail; cd ~/ziradesk/app; git fetch --all --prune; git checkout main; git pull --ff-only origin main; docker compose --env-file .env.production -f docker-compose.production.yml up -d --build; docker compose -f docker-compose.production.yml ps"
```

## Observações de segurança aplicadas

- Apenas `nginx` publica portas externas (`80` e `443`).
- `postgres` e `redis` não possuem publish de porta externa.
- Dados persistentes ficam fora do repositório em `../data/*`.
- Limites de memória somam ~`5.25GB` (folga para VPS de 8GB).
