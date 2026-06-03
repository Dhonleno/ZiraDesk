# Deploy — ZiraDesk

## Estado atual

Este projeto nao usa mais Railway para producao.

O ambiente atual de producao roda em:
- VPS Contabo
- Docker Compose
- Nginx
- Cloudflare (DNS e proxy)

Dominios atuais:
- `https://app.ziradesk.com`
- `https://api.ziradesk.com`
- `https://{tenant}.ziradesk.com`

## Guia oficial

O guia operacional atual de deploy esta em:

- [DEPLOY_VPS_DOCKER_COMPOSE.md](./DEPLOY_VPS_DOCKER_COMPOSE.md)

Esse documento cobre:
- preparacao da VPS
- variaveis de ambiente
- certificados TLS
- fluxo manual de deploy
- CI/CD via GitHub Actions para a Contabo

## Notas de escopo

- O portal `suporte.{tenant}.ziradesk.com` esta desativado no Nginx por
  decisao de escopo e por falta de cobertura TLS no certificado atual.
- O wildcard de tenant ativo em producao hoje eh `*.ziradesk.com`.
