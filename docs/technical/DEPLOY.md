# Deploy — ZiraDesk

## Status atual (oficial)
O ambiente de produção oficial está em VPS Contabo com Docker Compose.

Use como referência principal:
- `docs/technical/DEPLOY_VPS_DOCKER_COMPOSE.md`
- `docker-compose.production.yml`
- `vps-bootstrap.sh`

Para deploy remoto via SSH a partir desta máquina (Windows/PowerShell), use a seção `6)` de `DEPLOY_VPS_DOCKER_COMPOSE.md`.

## Fluxo oficial de deploy
1. Atualizar código no servidor VPS.
2. Garantir `.env.production` e `apps/api/.env.production` configurados.
3. Executar:
   `docker compose --env-file .env.production -f docker-compose.production.yml up -d --build`
4. Validar:
   - `docker compose -f docker-compose.production.yml ps`
   - `curl -I https://api.ziradesk.com.br/health`

## CI/CD no GitHub Actions
O workflow `CI` no GitHub Actions funciona como gate de qualidade (testes).
O deploy de produção não é disparado pelo GitHub Actions.

## Nota sobre Railway
A documentação e arquivos de Railway permanecem apenas como referência histórica/alternativa.
Não representam o fluxo oficial atual de produção.
