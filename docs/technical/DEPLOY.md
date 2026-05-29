# Deploy — ZiraDesk

## Pré-requisitos
- Conta no Railway (railway.app)
- Domínio configurado (ziradesk.com.br)
- DNS Cloudflare com wildcard *.ziradesk.com.br

## Serviços no Railway
1. PostgreSQL 16 (plugin oficial)
2. Redis 7 (plugin oficial)
3. API (Fastify) — Dockerfile em apps/api/
4. Web (React) — deploy como Static Site

## Variáveis de ambiente
Configurar todas as variáveis de apps/api/.env.production.example
no serviço da API no Railway.

Obrigatórias para webhooks Meta:
- META_APP_SECRET
- WHATSAPP_VERIFY_TOKEN

Para o Web, configurar:
VITE_API_URL=https://api.ziradesk.com.br
VITE_SOCKET_URL=https://api.ziradesk.com.br

## Domínios customizados no Railway
- API: api.ziradesk.com.br
- Web: app.ziradesk.com.br

## Subdomínios de tenant
Configurar DNS wildcard no Cloudflare:
*.ziradesk.com.br → app.ziradesk.com.br (CNAME)

O middleware de tenant resolve o slug pelo subdomínio.

## Deploy inicial
1. Fazer push para o GitHub
2. Conectar repositório no Railway
3. Configurar variáveis de ambiente
4. Executar manualmente: railway run pnpm --filter @ziradesk/api db:seed
5. Verificar health: GET https://api.ziradesk.com.br/health

## Deploy contínuo
Railway detecta push na branch main e faz deploy automático.
Migrations rodam automaticamente via scripts/deploy.sh.
