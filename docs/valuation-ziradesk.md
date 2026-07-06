# ZiraDesk — Avaliação Econômica, Técnica e Societária

> **Data da avaliação:** 23 de junho de 2026  
> **Versão analisada:** 0.8.0 (branch `main`, commit `3dae5af`)  
> **Escopo:** análise exclusivamente baseada no repositório local, documentação interna e histórico Git. Nenhuma receita, cliente, custo externo ou dado financeiro foi fornecido pelo fundador — todas as estimativas pecuniárias são projeções técnicas fundamentadas, não fatos verificados.  
> **Status:** **Resultado Preliminar** — aguarda resposta ao questionário da Seção 17.

---

## Sumário Executivo

O ZiraDesk é uma plataforma SaaS B2B multi-tenant de atendimento omnichannel desenvolvida integralmente por um único fundador em um período de aproximadamente 58 dias de desenvolvimento intensivo (26/04/2026 – 23/06/2026). O produto encontra-se em estágio de **MVP Avançado Funcional**, com arquitetura enterprise, isolamento por schema PostgreSQL, módulos completos de CRM, omnichannel, tickets, campanhas, LGPD, super administração e infraestrutura de deploy.

### Faixas Preliminares

| Métrica | Faixa mínima | Faixa central | Faixa máxima |
|---|---:|---:|---:|
| **Custo de reposição bruto** | R$ 750.000 | R$ 1.100.000 | R$ 2.000.000 |
| **Custo de reposição ajustado** | R$ 500.000 | R$ 770.000 | R$ 1.400.000 |
| **Valuation pré-money (técnico conservador)** | R$ 350.000 | R$ 500.000 | R$ 700.000 |
| **Valuation pré-money (pré-receita provável)** | R$ 600.000 | R$ 900.000 | R$ 1.300.000 |

> Confiança atual: **baixa–média** — ausência de dados financeiros, comerciais e jurídicos. O valuation definitivo requer o questionário completo da Seção 17.

### Cinco Maiores Alavancas de Valor

1. Produto funcional com arquitetura enterprise multi-tenant por schema
2. Amplitude funcional (omnichannel, CRM, tickets, LGPD, IA, voz, campanhas)
3. Planos e estrutura de preços já definidos (Starter R$97 · Pro R$197 · Enterprise R$497/mês)
4. Aceleração do desenvolvimento (237 commits em junho vs. 52 em abril)
5. Documentação técnica extensa e design system consistente

### Cinco Maiores Redutores de Valor

1. Ausência de receita comprovada e clientes ativos confirmados
2. Dependência quase total de um único desenvolvedor (99% dos commits)
3. Billing e gateway de pagamento não implementados
4. Propriedade intelectual não formalizada em pessoa jurídica
5. Entitlement parcial e ledger de consumo incompleto

---

## 1. Escopo e Limitações

### O que foi analisado

- Código-fonte completo em `apps/api`, `apps/web` e `packages/shared`
- Histórico Git completo (493 commits, 50 dias únicos de desenvolvimento)
- Documentação: `ARQUITETURA_TECNICA.md` (68 KB), `docs/analise-precificacao-ziradesk.md`, `docs/technical/`, `docs/product/`
- Schema Prisma e 19 migrations
- Workflows GitHub Actions (CI, deploy, backup)
- Infraestrutura: `docker-compose.production.yml`, `deploy/nginx/`, `ops/backup.sh`
- Seed de planos: `apps/api/prisma/seed.ts`
- 29 arquivos de teste (integração e unitários)

### O que não foi analisado

- Receita, MRR, contratos ou faturas (não fornecidos)
- Clientes ativos ou pipeline (não confirmados no repositório)
- Custos operacionais reais (servidores, SaaS externos)
- Situação jurídica, CNPJ, contrato social, registro de marca
- Capital próprio investido pelo fundador
- Feedbacks de usuários ou NPS

### Premissas metodológicas

- Todos os valores monetários estão em **Reais (BRL)**, contexto de mercado brasileiro em 2026
- Salários de referência estimados com base em faixas de mercado brasileiro para desenvolvedores sênior TypeScript/Node/React — **não verificados junto ao fundador**
- Múltiplos de valuation adaptados para o mercado brasileiro de SaaS early-stage; fontes referenciadas onde aplicável
- Descontos e ajustes são cumulativos e ponderados, não somados mecanicamente

---

## 2. Inventário de Ativos

### 2.1 Ativos Tecnológicos

| Ativo | Estado | Maturidade | Dificuldade de reconstrução | Valor estratégico | Limitações |
|---|---|---|---|---|---|
| Multi-tenant (schema-per-tenant) | Funcional | Produção | Alta | Alto | Sem backup por tenant individual automatizado |
| Super Admin (gestão de tenants/planos) | Funcional | Produção | Alta | Alto | Sem billing automatizado |
| RBAC (6 papéis, permissões granulares) | Funcional | Produção | Média | Alto | Sem MFA |
| Autenticação JWT + refresh + cookie httpOnly | Funcional | Produção | Média | Alto | Sem MFA implementado |
| Entitlement por plano (`requireFeature`) | Parcial | MVP | Média | Alto | Cobre apenas 5–6 features; não cobre voz, IA, portal, Redmine |
| Omnichannel (inbox, fila, transferência, realtime) | Funcional | MVP avançado | Muito alta | Muito alto | Capacidade não medida; workers compartilhados |
| WhatsApp Cloud API | Funcional | Produção | Alta | Muito alto | Depende de conta Meta e homologação BSP |
| Instagram Direct | Parcial | MVP | Alta | Alto | Menor maturidade que WhatsApp; uploads incompletos |
| E-mail (entrada/saída via Resend/SMTP) | Funcional c/ limitações | MVP | Média | Alto | Threads/anexos de entrada não totalmente confirmados |
| CRM (contatos, organizações, importação) | Funcional | MVP avançado | Alta | Alto | Sem org limit; importação pode contornar `maxContacts` |
| Tickets (CRUD, tipos, checklist, tempo, métricas) | Funcional | MVP avançado | Alta | Alto | Sem limite por ticket nem storage por tenant |
| Campanhas WhatsApp | Funcional | MVP | Alta | Alto | Sem franquia mensal; worker compartilhado por plano |
| Portal do cliente | Parcial | MVP | Alta | Médio | TLS para `*.*.ziradesk.com` não cobre wildcard duplo em produção |
| Voz/Twilio | Funcional c/ limitações | MVP | Alta | Médio | Sem quota de minutos; sem entitlement de backend |
| IA / Base de conhecimento (OpenAI) | Experimental | Beta | Alta | Médio | Sem metering de tokens; sem quota por tenant |
| LGPD (consentimento, exportação, retenção, PII) | Funcional c/ limitações | MVP | Alta | Alto | Exclusão em backups não confirmada |
| Webhooks de saída | Funcional | MVP | Média | Alto | Sem metering de eventos; entitlement parcial |
| Integração Redmine | Funcional c/ limitações | MVP | Média | Médio | Sem entitlement de backend |
| Realtime Socket.io + Redis adapter | Funcional | Produção | Alta | Alto | Redis adapter adicionado recentemente (06/2026) |
| Filas BullMQ (12+ jobs) | Funcional | Produção | Alta | Alto | Workers compartilhados entre tenants |
| Storage (local + Cloudflare R2) | Funcional | Produção | Média | Médio | Sem quota por tenant; sem antivírus em uploads |
| Backup PostgreSQL + R2 | Funcional | Operacional | Média | Alto | Redis excluído; restore periódico não confirmado |
| Ledger de consumo (`usage_snapshots`) | Parcial | MVP | Alta | Muito alto | Cobre messages_sent e storage_bytes; não cobre voz, IA, e-mail, API |
| CI/CD GitHub Actions (CI + deploy + backup) | Funcional | Produção | Baixa | Médio | Deploy manual via workflow dispatch |
| Docker Compose + Nginx | Funcional | Produção | Baixa | Médio | Infraestrutura monolítica; sem K8s/orquestração |
| Design system (CSS tokens, IBM Plex, dark/light) | Funcional | Produção | Média | Médio | Bem documentado; padronizado |
| Internacionalização (i18n, pt-BR) | Parcial | MVP | Baixa | Baixo | Apenas PT-BR confirmado |
| Testes (29 arquivos, integração + unitários) | Parcial | MVP | Baixa | Médio | Cobertura limitada; sem testes E2E |
| Documentação técnica | Boa | Produção | Baixa | Médio | ARQUITETURA_TECNICA.md extenso; sem runbook de incidente |
| Observabilidade (Sentry + Umami + Pino) | Parcial | MVP | Baixa | Médio | Sem APM, sem alertas proativos, sem dashboards |
| Planos e assinaturas (modelo de dados) | Funcional | MVP | Alta | Muito alto | Gateway/checkout/cobrança recorrente ausente |

### 2.2 Ativos Comerciais e Intangíveis

| Ativo | Situação no repositório | Necessita confirmação do fundador |
|---|---|---|
| Marca "ZiraDesk" | Presente em código, documentação e seed (`ZiraDesk@2025`) | Registro INPI não confirmado |
| Domínio `ziradesk.com` + subdomínios | Configurado em Nginx e Cloudflare; DNS confirmado | Titularidade (fundador PF ou PJ?) não confirmada |
| Identidade visual / Design system | Confirma: logo SVG, tokens CSS, IBM Plex, teal `#00C9A7` | — |
| Planos comerciais (preços seed) | Confirmado: Starter R$97 · Pro R$197 · Enterprise R$497/mês | Validação de mercado, histórico de vendas |
| Documentação técnica (68 KB) | Confirmado | — |
| Análise de precificação (`docs/analise-precificacao-ziradesk.md`) | Confirmado | — |
| Propriedade intelectual (código) | Autor no Git: `dhonleno` / `Dhonleno` (PF) | Cessão à PJ não confirmada |
| Clientes ativos | Não confirmado | Fundador deve informar |
| Contratos / receita | Não confirmado | Fundador deve informar |
| Marca registrada (INPI) | Não confirmado | Fundador deve informar |
| Parcerias (Meta BSP, Twilio, Resend) | Integrações confirmadas; parceria formal não confirmada | Status de conta Meta/Twilio |
| Base de leads ou pipeline comercial | Não confirmado | Fundador deve informar |
| Investimento já realizado (capital próprio) | Não informado | Fundador deve informar |

---

## 3. Maturidade Técnica e Comercial

| Área | Nota (0–5) | Evidências | Risco para valuation |
|---|---:|---|---|
| Core SaaS (multi-tenant, provisionamento) | 4 | `tenants.service.ts`, schema isolado, trial/active/suspended/cancelled | Médio — billing ausente |
| Multi-tenant (isolamento) | 4 | Schema-per-tenant, `search_path`, middleware de tenant | Baixo |
| Segurança (auth, RBAC, Helmet, rate limit) | 3 | JWT, refresh, cookie httpOnly, RBAC, Helmet, CORS; sem MFA | Médio — MFA ausente |
| WhatsApp (Cloud API) | 4 | Webhook Meta, envio, templates, mídia, janela 24h, bot, CSAT | Baixo (depende de conta Meta ativa) |
| Omnichannel (inbox, fila, realtime) | 4 | Fila, presença, transferência, notas, bot, CSAT, Socket.io | Médio — capacidade não medida |
| CRM | 4 | Contatos, organizações, importação, tags, PII, portal access | Baixo |
| Tickets | 4 | CRUD, categorias, checklist, tempo, Redmine, portal | Baixo |
| Campanhas | 3 | Criação, agendamento, worker, relatório, opt-out | Médio — sem franquia mensal |
| Portal do cliente | 2 | Código funcional; deploy desativado por TLS | Alto — não disponível em produção |
| E-mail | 3 | Inbound Resend, SMTP outbound, conversas/tickets | Médio — threads incompletos |
| Instagram | 3 | Webhook, envio, configuração | Médio — maturidade inferior ao WhatsApp |
| Voz (Twilio) | 3 | Token, chamada, TwiML, gravações, call records | Alto — sem quota; custo Twilio externo |
| IA (OpenAI, base de conhecimento) | 2 | Configuração, embeddings, GPT-4o, chunks | Alto — sem metering de tokens; beta |
| LGPD | 3 | Consentimento, exportação, anonimização, SLA, PII masking | Médio — exclusão em backup não confirmada |
| Relatórios e métricas | 4 | Omnichannel, performance, tickets, TV, Super Admin, CSV | Baixo |
| Entitlement (controle por plano) | 2 | `requireFeature` para 5–6 features; voz, IA, portal sem gate | Alto |
| Billing (gateway, cobrança recorrente) | 1 | Modelo de dados presente (`paymentGateway`, `gatewaySubId`); sem implementação | Muito alto |
| Ledger de consumo | 2 | `usage_snapshots`, messages_sent, storage_bytes; voz/IA/e-mail ausentes | Alto |
| Backup operacional | 3 | `ops/backup.sh`, R2, workflow manual; Redis fora; restore não testado periodicamente | Médio |
| Observabilidade | 2 | Sentry + Umami declarados; Pino para logs; sem APM | Médio |
| Testes | 2 | 29 arquivos (integração + unitário); sem E2E; cobertura parcial | Médio |
| Escalabilidade | 2 | Redis adapter adicionado; Docker Compose; sem K8s; workers compartilhados | Alto |
| Documentação | 4 | ARQUITETURA_TECNICA.md extenso; design system documentado; runbook ausente | Baixo |
| Prontidão comercial | 2 | Planos e preços definidos; sem billing automatizado; sem autoatendimento | Alto |

**Pesos e média ponderada:**

| Grupo de áreas | Peso | Nota média do grupo | Contribuição |
|---|---:|---:|---:|
| Produto core (SaaS, multi-tenant, segurança) | 20% | 3,7 | 0,74 |
| Canais de comunicação (WA, omnichannel, e-mail, IG, voz) | 20% | 3,4 | 0,68 |
| Módulos funcionais (CRM, tickets, campanhas, relatórios) | 15% | 3,8 | 0,57 |
| Monetização (billing, entitlement, ledger) | 20% | 1,7 | 0,34 |
| Infraestrutura e operação (backup, CI/CD, observabilidade) | 10% | 2,7 | 0,27 |
| Escalabilidade e testes | 10% | 2,0 | 0,20 |
| Documentação e prontidão comercial | 5% | 3,0 | 0,15 |

> **Nota média ponderada: 2,95 / 5,0** — produto funcional em estado de venda assistida, com lacunas críticas na camada de monetização automatizada.

---

## 4. Histórico de Desenvolvimento

### 4.1 Síntese do Git

| Métrica | Valor |
|---|---|
| Data de início (primeiro commit) | 26 de abril de 2026 |
| Data do último commit analisado | 23 de junho de 2026 |
| Período total (dias corridos) | 58 dias |
| Dias únicos com commits | 50 dias |
| Total de commits | 493 |
| Média de commits por dia útil | ~9,9 |
| Contribuidores distintos | 1 (dhonleno/Dhonleno) |

### 4.2 Evolução mensal

| Mês | Commits | Observação |
|---|---:|---|
| Abril/2026 (últimos 5 dias) | 52 | Bootstrap do projeto; estrutura inicial |
| Maio/2026 | 201 | Expansão de módulos; omnichannel; CRM; tickets |
| Junho/2026 (23 dias) | 237 | Departamentos; ledger; notificações; exportação; Redis adapter |

A aceleração indica maturação do produto e domínio crescente do fundador sobre a base de código.

### 4.3 Fases identificadas

| Fase | Commits aproximados | Principais entregas |
|---|---|---|
| Fundação | Abril final | Monorepo, schema public, auth, multi-tenant, RBAC |
| Omnichannel core | Maio inicio | WhatsApp, fila, conversas, Socket.io, CRM |
| Expansão funcional | Maio meio | Tickets, portal, campanhas, IA, LGPD, Twilio |
| Robustez e escala | Junho | Departamentos, ledger, Redis adapter, índices, exportação |

### 4.4 Complexidade por módulo

Os módulos de maior complexidade identificados pelo volume de arquivos e camadas:

1. **Omnichannel** — 30+ arquivos, 12+ jobs BullMQ, Socket.io
2. **CRM** — importação CSV/XLSX/VCF, PII, embeddings IA
3. **Super Admin + Tenants** — provisionamento, planos, métricas globais
4. **LGPD** — consentimento, SLA, exportação, PII masking, auditoria
5. **Webhooks/Integrações** — Meta, Twilio, Resend, Redmine

### 4.5 Risco de concentração

**Risco alto.** 493 de 493 commits são de um único desenvolvedor. Todo o conhecimento arquitetural, decisões de design, bugs conhecidos e mapeamento de dívida técnica residem exclusivamente no fundador. Isso é o maior fator único de risco do negócio.

Mitigação parcial: a documentação técnica é extensa (ARQUITETURA_TECNICA.md = 68 KB) e o código usa TypeScript com tipagem forte, o que facilita onboarding de novos desenvolvedores mais do que código não tipado.

---

## 5. Custo de Reconstrução

> **Aviso:** custo de reconstrução é o custo de replicar o ativo existente, não o valor econômico do negócio. Um comprador racional pagará menos do que o custo de reconstrução se o negócio não tiver tração comercial.

### Premissas de esforço

Com base nos 466 arquivos TypeScript (~80.000–125.000 linhas), 19 migrations, 29 testes e complexidade de integração mapeada, o esforço estimado para reconstrução completa por equipe externa é de 6 a 24 meses, dependendo do perfil.

### Cenário A — Equipe enxuta (3 seniores)

| Perfil | Qtd | Meses | Custo/mês (est.) | Total |
|---|---:|---:|---:|---:|
| Senior Full-Stack TypeScript | 2 | 20 | R$ 14.000 | R$ 560.000 |
| DevOps/Infra | 1 | 12 | R$ 10.000 | R$ 120.000 |
| PM part-time | 0,5 | 20 | R$ 5.000 | R$ 100.000 |
| **Total bruto** | | | | **R$ 780.000** |

### Cenário B — Equipe profissional (8 pessoas)

| Perfil | Qtd | Meses | Custo/mês (est.) | Total |
|---|---:|---:|---:|---:|
| Senior Backend (Node/Fastify/Prisma) | 2 | 12 | R$ 15.000 | R$ 360.000 |
| Senior Frontend (React/TS) | 2 | 12 | R$ 13.000 | R$ 312.000 |
| DevOps/SRE | 1 | 10 | R$ 12.000 | R$ 120.000 |
| UX/UI Designer | 1 | 8 | R$ 9.000 | R$ 72.000 |
| QA Engineer | 1 | 10 | R$ 7.500 | R$ 75.000 |
| PM sênior | 1 | 12 | R$ 11.000 | R$ 132.000 |
| **Total bruto** | | | | **R$ 1.071.000** |

### Cenário C — Software house

| Item | Estimativa |
|---|---:|
| 6–8 meses de equipe completa (custo all-in) | R$ 1.200.000–R$ 1.600.000 |
| Margem de gestão / risco (30–40%) | R$ 360.000–R$ 640.000 |
| **Total bruto estimado** | **R$ 1.560.000–R$ 2.240.000** |

### Ajustes aplicáveis

| Item | Desconto | Justificativa |
|---|---:|---|
| Dívida técnica (entitlement, billing, portal TLS) | −10% | Trabalho adicional para correção |
| Funcionalidades incompletas (portal, IA, ledger parcial) | −12% | Não entregam valor comercial pleno |
| Falta de testes E2E e cobertura limitada | −5% | Risco de regressão em manutenção |
| Dependência de um desenvolvedor (custo de transferência) | −5% | Esforço extra para documentar e transferir |
| **Desconto total** | **~28–32%** | |

### Custo de reposição ajustado

| Cenário | Bruto | Desconto | **Ajustado** |
|---|---:|---:|---:|
| A — Enxuta | R$ 780.000 | 30% | **R$ 546.000** |
| B — Profissional | R$ 1.071.000 | 30% | **R$ 750.000** |
| C — Software house | R$ 1.560.000–R$ 2.240.000 | 28% | **R$ 1.123.000–R$ 1.613.000** |

> **Faixa técnica de reposição ajustada: R$ 546.000 – R$ 1.100.000**, com ponto central em R$ 770.000.

---

## 6. Métodos de Valuation

### 6.1 Método do Custo de Reposição

Considera o custo de reposição ajustado com penalidades adicionais por:
- Ausência de receita comprovada: −20%
- Dependência do fundador: −15%
- Propriedade intelectual não formalizada: −10%

Aplicando sobre o custo ajustado central de R$ 770.000:
- Desconto composto: ~38%
- **Valor técnico pelo custo de reposição: R$ 350.000 – R$ 600.000**

> Este método produz o piso de valuation. Um investidor racional prefere reconstruir do zero a pagar mais do que o custo ajustado por um ativo sem tração.

### 6.2 Método Berkus Adaptado (mercado brasileiro, SaaS early-stage)

> Berkus original: USD 500k/item (EUA, 2024). Adaptado para BR 2026 considerando diferença de mercado (fator ~0,3–0,4×).

| Item | Peso BR adaptado | Nota ZiraDesk (0–1) | Valor |
|---|---:|---:|---:|
| Ideia sólida / produto existente | R$ 150.000 | 0,90 | R$ 135.000 |
| Protótipo funcional e avançado | R$ 150.000 | 0,85 | R$ 127.500 |
| Equipe de execução | R$ 120.000 | 0,35 | R$ 42.000 |
| Relacionamentos estratégicos / integrações | R$ 100.000 | 0,55 | R$ 55.000 |
| Produto pronto para venda | R$ 120.000 | 0,45 | R$ 54.000 |
| Receita / tração comercial | R$ 100.000 | 0,10 | R$ 10.000 |
| Redução de risco tecnológico | R$ 80.000 | 0,75 | R$ 60.000 |
| **Total Berkus** | **R$ 820.000** | | **R$ 483.500** |

**Berkus adaptado: ≈ R$ 480.000 – R$ 550.000**

### 6.3 Scorecard para Startup Pré-Receita

| Fator | Peso | Nota ZiraDesk (−2 a +2) | Pontuação ponderada |
|---|---:|---:|---:|
| Qualidade e maturidade do produto | 20% | +1,5 | +0,30 |
| Mercado e tamanho da oportunidade | 15% | +1,5 | +0,23 |
| Equipe e capacidade de execução | 15% | −0,5 | −0,08 |
| Tecnologia e diferenciação | 15% | +1,0 | +0,15 |
| Tração e evidência de demanda | 10% | −1,0 | −0,10 |
| Receita e modelo comprovado | 10% | −1,5 | −0,15 |
| Propriedade intelectual | 5% | −1,0 | −0,05 |
| Escalabilidade | 5% | +0,5 | +0,03 |
| Risco jurídico | 5% | −1,0 | −0,05 |
| **Total** | | | **+0,28** |

Uma pontuação de +0,28 (escala −2 a +2) corresponde a **107% de um "startup médio pré-receita"** na escala. Se a mediana para SaaS B2B pré-receita no Brasil (2025–2026) for estimada em R$ 700.000–R$ 900.000 (fonte: Abstartups Radar 2024, valores ajustados), o scorecard produz:

**Scorecard: R$ 749.000 – R$ 963.000**

> Este resultado depende de dados de mercado externos que não foram individualmente verificados durante esta análise.

### 6.4 Risk Factor Summation

Base hipotética de R$ 500.000 para um SaaS B2B pré-receita brasileiro funcional.

| Risco | Classificação | Ajuste (R$) |
|---|---|---:|
| Risco técnico (arquitetura sólida, TypeScript, testes) | Positivo | +R$ 50.000 |
| Risco de produto (amplitude funcional, MVP avançado) | Muito positivo | +R$ 75.000 |
| Risco de mercado (mercado BR de helpdesk/CS em crescimento) | Positivo | +R$ 50.000 |
| Risco comercial (sem clientes comprovados, sem billing) | Muito negativo | −R$ 100.000 |
| Risco financeiro (sem receita, sem capital de giro) | Muito negativo | −R$ 75.000 |
| Risco jurídico (PI não formalizada, marca não registrada) | Negativo | −R$ 50.000 |
| Risco LGPD (fluxo implementado, exclusão em backup não confirmada) | Neutro | R$ 0 |
| Risco de segurança (sem MFA, antivírus ausente em uploads) | Negativo | −R$ 25.000 |
| Risco operacional (single developer, sem equipe) | Muito negativo | −R$ 75.000 |
| Dependência do fundador | Muito negativo | −R$ 75.000 |
| Risco de escalabilidade (VPS único, workers compartilhados) | Negativo | −R$ 25.000 |
| Risco de concorrência (Zendesk, Freshdesk, Movidesk, Octadesk) | Negativo | −R$ 25.000 |
| Risco de integrações externas (Meta, Twilio, OpenAI) | Neutro/Negativo | −R$ 25.000 |
| Risco de billing (sem gateway) | Muito negativo | −R$ 75.000 |
| Infraestrutura (backup operacional, R2, CI/CD) | Positivo | +R$ 25.000 |
| **Subtotal ajustes** | | **−R$ 350.000** |

> Ajuste total não é soma linear — riscos sobrepostos (dependência do fundador + risco operacional + falta de equipe) são parcialmente redundantes. Peso real: ~65% do subtotal.

**Risk Factor Summation: ≈ R$ 500.000 − (R$ 350.000 × 0,65) = R$ 273.000**

> Este resultado é o mais pessimista dos métodos — reflete corretamente os riscos acumulados de um projeto de desenvolvedor solo sem receita, e funciona como piso absoluto de valuation.

### 6.5 Múltiplos de Receita

**Não aplicável.** Não foram fornecidos dados de MRR, ARR, clientes ativos, churn ou crescimento.

Fórmulas para aplicação futura:
```
MRR = soma das receitas recorrentes mensais ativas
ARR = MRR × 12
Valuation = ARR × múltiplo

Múltiplos de referência (SaaS B2B Brasil early-stage, 2024–2026):
  Pré-receita / tração inicial:   4×–8× ARR
  MRR crescendo > 20%/mês:        10×–20× ARR
  Maturidade (> R$100k MRR):      5×–15× ARR
  
Fontes: Distrito SaaS Report 2024; Latitud VC data 2024; adaptação de SaaStr Americas 2024
```

### 6.6 Fluxo de Caixa Descontado (DCF)

**Não aplicável — modelo estrutural apenas.**

```
Estrutura DCF para preenchimento futuro:

Receita projetada (Ano 1-5):
  Ano 1:  [nº clientes] × [ticket médio mensal] × 12
  Crescimento anual: [%]

Custos operacionais:
  Infra + SaaS externos: [R$/mês]
  Equipe: [R$/mês]
  Comercial/CS: [R$/mês]

Impostos estimados (Simples/Lucro Presumido): [%]

Fluxo de caixa livre = Receita − Custos − Impostos − Investimentos

Taxa de desconto (WACC sugerido para startup BR 2026): 25–35%
Valor terminal (perpetuidade): FCL_N × (1 + g) / (WACC − g)
  g (crescimento terminal) = 3–5%

Análise de sensibilidade:
  Otimista: ticket R$300, 50 clientes em 12 meses, churn 2%/mês
  Realista: ticket R$197, 20 clientes em 12 meses, churn 5%/mês
  Pessimista: ticket R$97, 8 clientes em 12 meses, churn 8%/mês
```

> Resultado: **não conclusivo** até fornecimento de premissas reais pelo fundador.

---

## 7. Propriedade Intelectual

| Item | Situação | Risco | Impacto no valuation | Ação necessária |
|---|---|---|---|---|
| Autoria do código | Git: `dhonleno` / `Dhonleno` (PF) | Alto | Desconto ou condição precedente | Cessão formal à PJ antes do investimento |
| Licença do repositório | Não encontrada no repositório | Alto | Incerteza jurídica | Definir licença proprietária |
| Dependências open-source | MIT, Apache 2.0 predominantes; nenhuma GPL/AGPL identificada | Baixo | Nenhum | Auditoria formal de licenças |
| Titularidade do domínio `ziradesk.com` | Configurado; titular não confirmado | Médio | Risco de disputa | Confirmar que domínio está em nome da PJ |
| Registro de marca "ZiraDesk" (INPI) | Não confirmado | Alto | Risco de terceiro registrar | Verificar e protocolar registro |
| Contrato social / CNPJ | Não confirmado | Alto | Sem PJ, não há investimento formal | Constituir PJ ou confirmar existência |
| Cessão de PI por terceiros | Nenhum co-desenvolvedor identificado | Baixo | — | Manter documentação de autoria solo |
| Código gerado por IA | Alta probabilidade (ritmo de 9+ commits/dia) | Médio | Depende de interpretação jurídica | Consultar advogado especializado em PI digital |

> **Conclusão:** a propriedade intelectual não está formalizada. Qualquer investimento sério requer cessão do código à pessoa jurídica como condição precedente. A ausência desse instrumento reduz o valuation ou impede a conclusão do processo.

---

## 8. Dependências e Riscos Externos

| Dependência | Criticidade | Risco de bloqueio | Substituibilidade | Lock-in | Custo variável |
|---|---|---|---|---|---|
| Meta (WhatsApp Cloud API) | Muito alta | Alto (mudança de política, suspensão de conta) | Baixa — concorrentes dependem igualmente | Alto | Não — pago pelo cliente/meta |
| Twilio Voice | Média | Baixo | Média (Vonage, AWS Connect) | Médio | Sim — por minuto, não medido |
| OpenAI (GPT-4o, embeddings) | Média | Baixo | Média (Azure OpenAI, Gemini) | Médio | Sim — por token, não medido |
| Resend (e-mail inbound/outbound) | Média | Baixo | Média (SendGrid, AWS SES) | Baixo | Sim — por e-mail |
| Cloudflare R2 / DNS | Alta | Baixo | Média (AWS S3) | Médio | Sim — por GB, baixo custo |
| VPS Contabo | Alta | Médio (disponibilidade 99,5%) | Alta (qualquer cloud/VPS) | Baixo | Sim — fixo mensal |
| PostgreSQL 16 / pgvector | Alta | Muito baixo (auto-hospedado) | Baixa para migrar (ORM abstrai) | Baixo | Não |
| Redis 7 | Alta | Muito baixo (auto-hospedado) | Média (KeyDB, Upstash) | Baixo | Não |
| Prisma ORM | Média | Baixo | Média (Drizzle, TypeORM) | Médio | Não |
| GitHub Actions | Baixa | Baixo | Alta (GitLab CI, etc.) | Baixo | Baixo — uso free tier |
| Redmine (integração) | Baixa | Baixo | Alta | Baixo | Não |

**Riscos compostos de dependência:**
- O negócio depende da Meta para o canal de maior valor (WhatsApp). Política de uso, taxas de mensagem (conversation-based pricing) e aprovação de contas são fatores externos não controlados.
- Custos com Twilio, OpenAI e Resend são variáveis e não estão sendo medidos por tenant, criando risco de margem negativa em escala.

---

## 9. Fatores que Aumentam o Valuation

| Fator | Evidência | Relevância | Impacto no valuation |
|---|---|---|---|
| Produto funcional de amplitude SaaS enterprise | 14 módulos de API, 466 arquivos TS, MVP avançado | Muito alta | +++ |
| Arquitetura multi-tenant por schema (enterprise pattern) | `tenants.service.ts`, middleware de isolamento | Alta | ++ |
| WhatsApp Cloud API funcional e maduro | Webhook, envio, templates, bot, CSAT — módulo mais completo | Muito alta | +++ |
| Planos com preços definidos e estrutura comercial | Seed: Starter R$97, Pro R$197, Enterprise R$497 | Alta | ++ |
| Design system proprietário e consistente | CSS tokens, IBM Plex, dark/light, logo SVG | Média | + |
| Super Admin com gestão completa de tenants | Provisionamento, planos, suspensão, métricas globais | Alta | ++ |
| Realtime com Socket.io + Redis adapter (escala horizontal) | `@socket.io/redis-adapter` adicionado em junho/2026 | Alta | ++ |
| Filas assíncronas BullMQ com 12+ jobs | Jobs para campanhas, LGPD, IA, fila, presença, snapshots | Alta | ++ |
| LGPD implementada como diferencial B2B | Consentimento, exportação, anonimização, SLA, PII masking | Alta | ++ |
| CI/CD e deploy automatizado | GitHub Actions (CI + deploy + backup), Docker Compose | Média | + |
| Backup operacional com R2 | `ops/backup.sh`, `ops/restore.sh`, workflow manual | Média | + |
| Documentação técnica extensa | ARQUITETURA_TECNICA.md 68 KB, design system, precificação | Média | + |
| Aceleração do desenvolvimento | 52 commits em abril → 237 em junho | Alta | ++ |
| Velocidade de iteração demonstrada | 58 dias de calendário para MVP avançado | Alta | ++ |
| Custos de troca para clientes futuros | Portabilidade de histórico de conversas, CRM, tickets | Alta | ++ |
| Domínio e marca estabelecidos | `ziradesk.com`, `app.ziradesk.com`, `api.ziradesk.com` | Média | + |
| Uso de pgvector para IA/RAG | Embeddings OpenAI armazenados por tenant | Baixa | + |

---

## 10. Riscos e Descontos

| Risco | Probabilidade | Impacto | Desconto sugerido | Corrigível antes do investimento? |
|---|---|---|---:|---|
| Ausência de receita comprovada | Confirmado | Muito alto | −25% no valuation econômico | Sim — exige clientes pagantes |
| Ausência de clientes ativos confirmados | Confirmado | Muito alto | Já incluído acima | Sim |
| Ausência de billing e gateway | Confirmado | Alto | −15% | Sim (2–3 meses de trabalho) |
| Dependência de um único desenvolvedor | Confirmado | Muito alto | −15% | Parcialmente (doc + onboarding) |
| PI não formalizada em PJ | Provável | Alto | −10% condição precedente | Sim (instrumento jurídico) |
| Entitlement parcial | Confirmado | Médio | −8% | Sim (1–2 meses) |
| Ledger de consumo incompleto | Confirmado | Médio | Já incluído no entitlement | Sim |
| Portal desabilitado em produção (TLS) | Confirmado | Médio | −5% | Sim (wildcard TLS) |
| MFA ausente | Confirmado | Médio | −5% | Sim (1–2 semanas) |
| Redis fora do backup | Confirmado | Baixo | −2% | Sim |
| Antivírus ausente em uploads | Confirmado | Baixo | −2% | Sim |
| Concorrência estabelecida (Zendesk, Movidesk, Octadesk) | Alta | Alto | Contextual | Diferenciação de produto |
| Custo Meta/Twilio/OpenAI não medido | Confirmado | Alto | Risco de margem | Sim (ledger) |

**Aplicação dos descontos:**

Os descontos não são somados linearmente pois há sobreposições (ex.: ausência de clientes e ausência de billing são correlacionados). Aplicando o método de desconto composto sequencial sobre o valor base:

```
Base Berkus/Scorecard:  R$ 700.000
Após risco de receita:  R$ 700.000 × 0,75 = R$ 525.000
Após risco de billing:  R$ 525.000 × 0,85 = R$ 446.250
Após dependência:       R$ 446.250 × 0,85 = R$ 379.313
Após PI não formal:     R$ 379.313 × 0,90 = R$ 341.381
Após entitlement:       R$ 341.381 × 0,92 = R$ 314.071
Após portal/MFA:        R$ 314.071 × 0,93 = R$ 292.086
```

> Piso absoluto aplicando todos os descontos: **≈ R$ 290.000–R$ 320.000**

Este piso é o valor caso todos os riscos se materializem e nenhum dado positivo seja confirmado. Na prática, o fundador provavelmente resolverá parte desses itens antes da negociação.

---

## 11. Cenários de Valuation

| Cenário | Premissas | Faixa mínima | Faixa central | Faixa máxima | Confiança |
|---|---|---:|---:|---:|---|
| **1 — Técnico conservador** | Custo reposição ajustado; sem receita; máximo desconto de risco | R$ 290.000 | R$ 420.000 | R$ 600.000 | Média |
| **2 — Pré-receita provável** | Produto funcional; venda assistida; sem billing; mercado validado informalmente | R$ 600.000 | R$ 900.000 | R$ 1.300.000 | Baixa–média |
| **3 — Primeiros clientes** | Fórmula editável (ver abaixo) | — | — | — | Não calculável |
| **4 — Consolidação** | Fórmula editável (ver abaixo) | — | — | — | Não calculável |

### Cenário 3 — Primeiros clientes (fórmula editável)

```
Parâmetros de entrada:
  N_clientes = número de clientes ativos pagantes
  Ticket     = receita recorrente mensal por cliente (R$)
  Churn      = taxa de cancelamento mensal (%)
  Margem     = margem bruta estimada (%)
  Múltiplo   = múltiplo de ARR (típico early-stage BR: 4–8×)

Cálculo:
  MRR    = N_clientes × Ticket
  ARR    = MRR × 12
  Valuation = ARR × Múltiplo × (1 − Churn_anual)

Exemplo com 10 clientes, ticket R$ 197 (Pro), churn 3%/mês, múltiplo 6×:
  MRR    = 10 × 197 = R$ 1.970
  ARR    = R$ 23.640
  Churn anual ≈ 30,6%
  Valuation ≈ R$ 23.640 × 6 × 0,694 = R$ 98.390

→ Com 50 clientes, ticket R$ 300, churn 2%/mês, múltiplo 8×:
  ARR    = R$ 180.000
  Churn anual ≈ 21,5%
  Valuation ≈ R$ 180.000 × 8 × 0,785 = R$ 1.130.400
```

### Cenário 4 — Após consolidação (fórmula editável)

```
Para estágio com receita recorrente, retenção e processo comercial:
  MRR_consolidado    ≥ R$ 50.000
  Crescimento mensal ≥ 10%
  Churn              ≤ 3%/mês
  NPS                ≥ 30

  Valuation = ARR × 10–15× (mercado BR maturidade media)

Exemplo: MRR R$ 100k, múltiplo 12×:
  ARR = R$ 1.200.000
  Valuation = R$ 14.400.000
```

---

## 12. Simulações de Aporte — Pré-money e Pós-money

### Conceitos

```
Valuation pós-money    = valuation pré-money + aporte
Participação investidor = aporte ÷ valuation pós-money
Participação fundador   = 100% − participação do investidor
```

### Tabela de simulação — cenário conservador (pré-money R$ 420.000)

| Valuation pré-money | Aporte | Valuation pós-money | Part. investidor | Part. fundador |
|---:|---:|---:|---:|---:|
| R$ 420.000 | R$ 30.000 | R$ 450.000 | 6,7% | 93,3% |
| R$ 420.000 | R$ 60.000 | R$ 480.000 | 12,5% | 87,5% |
| R$ 420.000 | R$ 120.000 | R$ 540.000 | 22,2% | 77,8% |
| R$ 420.000 | R$ 210.000 | R$ 630.000 | 33,3% | 66,7% |

### Tabela de simulação — cenário provável (pré-money R$ 800.000)

| Valuation pré-money | Aporte | Valuation pós-money | Part. investidor | Part. fundador |
|---:|---:|---:|---:|---:|
| R$ 800.000 | R$ 50.000 | R$ 850.000 | 5,9% | 94,1% |
| R$ 800.000 | R$ 100.000 | R$ 900.000 | 11,1% | 88,9% |
| R$ 800.000 | R$ 200.000 | R$ 1.000.000 | 20,0% | 80,0% |
| R$ 800.000 | R$ 400.000 | R$ 1.200.000 | 33,3% | 66,7% |

### Tabela de simulação — cenário otimista (pré-money R$ 1.200.000)

| Valuation pré-money | Aporte | Valuation pós-money | Part. investidor | Part. fundador |
|---:|---:|---:|---:|---:|
| R$ 1.200.000 | R$ 100.000 | R$ 1.300.000 | 7,7% | 92,3% |
| R$ 1.200.000 | R$ 200.000 | R$ 1.400.000 | 14,3% | 85,7% |
| R$ 1.200.000 | R$ 400.000 | R$ 1.600.000 | 25,0% | 75,0% |
| R$ 1.200.000 | R$ 600.000 | R$ 1.800.000 | 33,3% | 66,7% |

> **Referência de mercado:** participações entre 10% e 25% são comuns em rounds early-stage para SaaS B2B brasileiro (Distrito, 2024). Participações acima de 30% sem investidor ativo podem gerar desincentivo ao fundador.

---

## 13. Aumento de Capital versus Venda de Quotas

### Aumento de capital (emissão de novas quotas)

**Como funciona:** novas quotas são criadas e vendidas ao investidor. O dinheiro entra na empresa.

**Vantagens:**
- Capital capitaliza a empresa para crescimento
- Fundador não recebe o dinheiro pessoalmente
- Estrutura típica para rounds de investimento e aceleradoras

**Riscos:**
- Fundador sofre diluição
- Empresa precisa ser uma PJ formalizada

**Quando preferir:** quando o objetivo é financiar o produto, equipe, marketing ou infraestrutura.

### Venda de quotas existentes

**Como funciona:** o fundador vende sua participação atual ao investidor. O dinheiro vai ao fundador, não à empresa.

**Vantagens:**
- Fundador recebe liquidez pessoal
- Não exige nova emissão

**Riscos:**
- A empresa não recebe recursos para crescer
- Pode gerar percepção negativa (fundador "sacando" antes de gerar valor)
- Dependendo da estrutura, pode não ser elegível para investidores institucionais

**Quando preferir:** quando o fundador precisa de liquidez pessoal e o investidor entende o contexto.

### Operação mista

Uma parte do aporte entra na empresa (aumento de capital) e outra parte remunera o fundador (compra de quotas). É legítima, mas cada parcela precisa de instrumento jurídico separado e avaliação fiscal.

### Recomendação técnica

Para o estágio do ZiraDesk (pré-receita, necessidade de desenvolvimento), **o aumento de capital é a estrutura mais indicada** — o dinheiro deve ir para a empresa financiar billing, ledger, marketing e CS. Venda de quotas parcial pode ser negociada se o fundador tiver custos pessoais que precisam ser cobertos.

> **Aviso:** esta análise não constitui aconselhamento jurídico ou fiscal. A estruturação do investimento deve ser validada por advogado societário e contador especializado em startups.

---

## 14. Uso Recomendado do Aporte

Com base nas lacunas identificadas, proposta de alocação percentual por prioridade de impacto:

### Para aporte de R$ 50.000–R$ 100.000 (pequeno)

| Destino | % | Justificativa |
|---|---:|---|
| Billing e gateway de pagamento | 30% | Bloqueador crítico para receita automatizada |
| Entitlement completo + ledger | 20% | Base para planos e controle de uso |
| MFA + segurança | 10% | Requisito B2B corporativo |
| Comercial (demos, materiais) | 20% | Primeiro cliente pagante |
| Jurídico e contábil (PI + PJ) | 15% | Condição precedente ao investimento |
| Reserva operacional | 5% | Custos de SaaS externos |

### Para aporte de R$ 200.000 (intermediário)

| Destino | % | Justificativa |
|---|---:|---|
| Billing + gateway + checkout | 25% | — |
| Primeiro contratado (full-stack) | 30% | Reduzir risco de dependência do fundador |
| Marketing digital e comercial | 20% | Pipeline e primeiros 10 clientes |
| Infraestrutura e observabilidade | 10% | APM, alertas, monitoramento |
| Entitlement, ledger e portal | 10% | Completar plataforma |
| Jurídico + capital de giro | 5% | — |

### Para aporte de R$ 400.000+ (relevante)

| Destino | % | Justificativa |
|---|---:|---|
| Equipe (2 desenvolvedores) | 35% | 12+ meses de salários |
| Marketing + comercial + CS | 30% | Time de receita |
| Billing + infraestrutura completa | 20% | Escala |
| Produto (IA, portal, voz) | 10% | Diferenciação |
| Jurídico, contábil e reserva | 5% | — |

---

## 15. Dados Faltantes — Questionário ao Fundador

### Financeiro

1. Qual é a receita atual mensal (MRR)?
2. Existe ARR definido? Qual?
3. Quais são os custos mensais totais? (infraestrutura, SaaS externos, domínios, ferramentas)
4. O produto tem dívidas? Existe capital de giro?
5. Quanto foi investido em dinheiro próprio até hoje? (R$ total aplicado)
6. Há obrigações fiscais pendentes?

### Comercial

7. Quantos clientes pagantes existem hoje?
8. Existem clientes em piloto ou trial gratuito? Quantos?
9. Qual é o ticket médio praticado ou esperado?
10. Existe pipeline de vendas? Quantas propostas ativas?
11. Qual a taxa de conversão de demos/trials em pagantes?
12. Existe churn histórico? (cancelamentos, inadimplências)
13. Quais são os concorrentes diretos que os prospects comparam?
14. Qual é o segmento prioritário: PME, médias empresas, corporativo?

### Desenvolvimento

15. Quantas horas aproximadas foram trabalhadas no projeto?
16. Algum terceiro contribuiu com código ou design? Se sim, existe contrato de cessão?
17. Houve gastos com freelancers, ferramentas pagas ou design?
18. O código foi desenvolvido com assistência de ferramentas de IA? (relevante para análise de PI)

### Jurídico

19. Existe pessoa jurídica (CNPJ) proprietária do ZiraDesk?
20. O domínio `ziradesk.com` está em nome da PJ ou PF?
21. A marca "ZiraDesk" está registrada no INPI?
22. Existe instrumento de cessão de propriedade intelectual do código para a PJ?
23. Há termos de uso e política de privacidade publicados?
24. Existem contratos assinados com clientes?
25. Há passivos jurídicos conhecidos?

### Operação

26. Qual a quantidade máxima de tenants simultâneos já testada?
27. Qual a disponibilidade histórica do sistema? (SLA real)
28. Houve incidentes graves (perda de dados, downtime prolongado)?
29. O restore do backup foi testado com sucesso? Quando foi o último teste?
30. Qual é o SLA prometido/contratado com clientes?

---

## 16. Resultado Preliminar

### Baseado exclusivamente nas evidências do repositório

**Faixa técnica de reposição:** R$ 546.000 – R$ 1.100.000  
**Faixa econômica preliminar:**

| Cenário | Faixa pré-money |
|---|---|
| Conservador (máximo desconto de risco) | R$ 290.000 – R$ 500.000 |
| Provável (produto funcional, sem tração) | R$ 600.000 – R$ 1.000.000 |
| Otimista (dados de mercado externos favoráveis) | R$ 1.000.000 – R$ 1.300.000 |

**Grau de confiança: Baixo–Médio**

Razão: ausência completa de dados financeiros, comerciais e jurídicos do fundador. A faixa econômica é altamente sensível à tração comercial — mesmo 5 clientes pagantes alterariam o valuation substancialmente.

**Principais descontos aplicados:**
- Ausência de receita: −25%
- Falta de billing/gateway: −15%
- Dependência do fundador: −15%
- PI não formalizada: −10%
- Entitlement parcial: −8%

**Principais ativos reconhecidos:**
- Produto multi-tenant funcional e de amplitude enterprise
- WhatsApp Cloud API maduro como canal core
- Planos e preços definidos (Starter/Pro/Enterprise)
- Aceleração de desenvolvimento demonstrada

**Dados indispensáveis que alterariam a avaliação:**
1. Clientes pagantes ativos (mesmo 3–5 mudam a base do valuation)
2. MRR, por mínimo que seja
3. Existência de PJ e cessão de PI
4. Capital próprio já aplicado
5. Status de conta Meta e homologação do WhatsApp

---

## 17. Modelo para Resultado Definitivo

O valuation definitivo deve ser preenchido após o fundador responder ao questionário da Seção 15.

```markdown
## ZiraDesk — Valuation Definitivo

Data: [DATA]
Responsável: [NOME]

### Dados fornecidos pelo fundador

MRR atual: R$ [___]
Clientes ativos: [___]
Capital próprio investido: R$ [___]
Custos mensais: R$ [___]
Situação jurídica: PJ [SIM/NÃO], CNPJ [___]
PI formalizada: [SIM/NÃO]
Marca INPI: [SIM/NÃO]

### Método de receita

MRR = R$ [___]
ARR = R$ [___]
Múltiplo aplicado = [___]×
Churn mensal = [___]%

Valuation por múltiplo de receita = R$ [___]

### Método de custo ajustado

Custo de reposição base: R$ 770.000 (cenário B — profissional)
Ajuste por tração: +[___]%
Ajuste por PI formalizada: +[___]%
Ajuste por equipe: +[___]%
Custo ajustado final: R$ [___]

### Valuation definitivo

Faixa mínima:  R$ [___]
Faixa central: R$ [___]
Faixa máxima:  R$ [___]
Grau de confiança: [BAIXO/MÉDIO/ALTO]

### Simulação de aporte recomendado

Valuation pré-money definido: R$ [___]
Aporte solicitado: R$ [___]
Valuation pós-money: R$ [___]
Participação do investidor: [___]%
Participação remanescente do fundador: [___]%

### Condições precedentes ao fechamento

1. [ ] Cessão de PI à PJ
2. [ ] Registro de marca INPI protocolado
3. [ ] Due diligence jurídica concluída
4. [ ] Due diligence técnica (teste de restore, auditoria de licenças)
5. [ ] Contrato de sociedade assinado
6. [ ] VESTING definido para o fundador
```

---

## 18. Evidências e Arquivos Analisados

### Estrutura analisada

```
d:\Projetos\ZiraDesk\
├── apps/
│   ├── api/                   # Backend Node.js/Fastify/TypeScript
│   │   ├── prisma/
│   │   │   ├── schema.prisma  # Modelo de dados (Plan, Tenant, Subscription, UsageSnapshot)
│   │   │   ├── seed.ts        # Planos Starter R$97, Pro R$197, Enterprise R$497
│   │   │   └── migrations/    # 19 migrations (2026-04-27 a 2026-06-22)
│   │   └── src/
│   │       ├── middleware/    # auth, tenant, rbac, entitlement, meta-signature
│   │       ├── modules/       # 14 módulos de domínio
│   │       └── jobs/          # 12+ workers BullMQ
│   └── web/                   # Frontend React/Vite/TypeScript
│       └── src/
│           └── pages/         # 15+ seções de tela
├── packages/shared/           # Tipos compartilhados (RBAC, PlanFeature)
├── ops/                       # backup.sh, restore.sh
├── deploy/                    # Nginx, configuração VPS
├── .github/workflows/         # CI, deploy-contabo, backup-manual
├── docker-compose.production.yml
├── ARQUITETURA_TECNICA.md     # 68 KB de documentação
└── docs/
    ├── analise-precificacao-ziradesk.md
    ├── technical/
    └── product/
```

### Evidências por conclusão

**Planos e preços:**
> `apps/api/prisma/seed.ts` — define Starter (R$97/mês, 3 usuários, 500 contatos), Pro (R$197/mês, 10 usuários, 5.000 contatos), Enterprise (R$497/mês, ilimitado). Confirmado na análise de precificação em `docs/analise-precificacao-ziradesk.md`.

**Entitlement parcial:**
> `apps/api/src/middleware/entitlement.ts` — `requireFeature` cobre: `whatsapp`, `email`, `reports`, `sla`, `webhooks`. Não cobre: portal, voz, Redmine, IA, exportações. Evidenciado em `campaigns.routes.ts`, `templates.routes.ts`, `smtp.routes.ts`, `metrics.routes.ts`.

**Ausência de billing:**
> `apps/api/prisma/schema.prisma` — modelo `Subscription` possui campos `paymentGateway` e `gatewaySubId` (null por padrão). Nenhum worker, webhook ou serviço de cobrança automática foi encontrado.

**Ledger parcial:**
> `apps/api/prisma/migrations/20260619150000_add_usage_snapshots/` — tabela `usage_snapshots`. `apps/api/src/jobs/usage-snapshot.job.ts` — mede `messages_sent` e `storage_bytes`. Voz, IA, e-mail e API não são medidos.

**Portal desabilitado:**
> `ARQUITETURA_TECNICA.md` seção 53: "O portal `suporte.{tenant}.ziradesk.com` não está ativo na produção atual." Confirmado no histórico de bugs e análise de TLS.

**Dependência de um desenvolvedor:**
> `git shortlog -sn --all`: dhonleno (484) + Dhonleno (9) = 493/493 commits (100%).

**Aceleração do desenvolvimento:**
> `git log --date=format:"%Y-%m"`: abril/2026 (52), maio/2026 (201), junho/2026 (237 em 23 dias).

**Socket.io Redis adapter (escala):**
> `apps/api/src/socket/index.ts` — `@socket.io/redis-adapter` adicionado em commit `fix(scale)` de 22/06/2026.

**Testes presentes:**
> 29 arquivos `.test.ts` e `.integration.test.ts` encontrados via `find apps -name "*.test.ts"`. Inclui: auth, CRM, omnichannel, tickets, LGPD, campanhas, Redmine, Twilio.

**IA sem metering:**
> `apps/api/src/modules/ai/ai.service.ts` — usa `openai.embeddings.create()` e `openai.chat.completions.create()` sem registro de tokens consumidos por tenant.

---

## Alertas Jurídicos e Contábeis

> Estes alertas são observações técnicas derivadas da análise do repositório. **Não constituem aconselhamento jurídico.** O fundador deve consultar advogado societário e contador especializado em startups antes de qualquer negociação de investimento.

1. **Pessoa jurídica:** nenhum CNPJ ou contrato social foi identificado no repositório. Qualquer investimento sério exige que o ativo (código, domínio, marca) esteja formalmente em nome de uma PJ.

2. **Cessão de propriedade intelectual:** todo o código está atribuído ao autor PF (`dhonleno`) no histórico Git. É necessário instrumento formal de cessão de PI à PJ antes da assinatura de qualquer instrumento de investimento.

3. **Código gerado por IA:** a velocidade de desenvolvimento (9+ commits/dia, 125k+ linhas em 58 dias) sugere uso intensivo de ferramentas de IA generativa. A titularidade de código gerado por IA é matéria juridicamente em evolução no Brasil; o fundador deve documentar o processo e consultar advogado especializado.

4. **Registro de marca:** a marca "ZiraDesk" não foi confirmada como registrada no INPI. Sem registro, qualquer terceiro pode protocolar pedido conflitante.

5. **Vesting:** em qualquer negociação com sócio investidor, é altamente recomendável estabelecer cláusula de vesting para o fundador (tipicamente 4 anos, cliff de 1 ano), protegendo o investidor caso o fundador deixe o projeto prematuramente.

6. **LGPD e termos:** o produto implementa fluxos LGPD, mas não foram confirmados termos de uso, política de privacidade e DPA (Data Processing Agreement) publicados — exigência legal para operação comercial.

7. **Due diligence tributária:** a estrutura tributária ideal (Simples, Lucro Presumido, MEI) impacta a margem líquida e deve ser definida antes de escalar receitas.

---

*Relatório produzido por análise automatizada do repositório em 23/06/2026. Nenhum código foi alterado. Nenhuma credencial ou secret foi exposto. O relatório é de uso interno e não deve ser compartilhado com terceiros sem remoção das referências a caminhos de arquivos internos.*
