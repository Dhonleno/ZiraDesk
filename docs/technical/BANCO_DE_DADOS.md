# Banco de Dados — ZiraDesk

## Estratégia: Schema-per-tenant

Cada tenant recebe um schema isolado no PostgreSQL.
O schema `public` contém apenas dados globais do sistema.

## Schema PUBLIC

### plans
| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | UUID | Chave primaria |
| name | VARCHAR(50) | Nome do plano |
| slug | VARCHAR(50) | Identificador unico |
| price_month | DECIMAL | Preco mensal |
| price_year | DECIMAL | Preco anual |
| max_users | INTEGER | Limite de usuarios |
| max_contacts | INTEGER | Limite de contatos |
| features | JSONB | Features habilitadas no plano |
| is_active | BOOLEAN | Se o plano esta disponivel |
| created_at | TIMESTAMPTZ | Data de criacao |

### tenants
| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | UUID | Chave primaria |
| name | VARCHAR(100) | Nome da empresa |
| slug | VARCHAR(50) | Subdominio |
| schema_name | VARCHAR(63) | Nome do schema isolado |
| plan_id | UUID FK | Plano contratado |
| status | VARCHAR(20) | active, suspended, cancelled |
| trial_ends_at | TIMESTAMPTZ | Fim do periodo trial |
| settings | JSONB | Configuracoes do tenant |
| created_at | TIMESTAMPTZ | Data de criacao |

### subscriptions
| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | UUID | Chave primaria |
| tenant_id | UUID FK | Tenant associado |
| plan_id | UUID FK | Plano associado |
| status | VARCHAR(20) | active, past_due, cancelled |
| current_period_start | TIMESTAMPTZ | Inicio do periodo atual |
| current_period_end | TIMESTAMPTZ | Fim do periodo atual |
| payment_gateway | VARCHAR(30) | stripe, pagarme |
| gateway_sub_id | VARCHAR(100) | ID na plataforma de pagamento |
| created_at | TIMESTAMPTZ | Data de criacao |

### super_admins
| Campo | Tipo | Descricao |
|-------|------|-----------|
| id | UUID | Chave primaria |
| name | VARCHAR(100) | Nome |
| email | VARCHAR(255) | E-mail unico |
| password_hash | VARCHAR(255) | Senha com bcrypt custo 12 |
| created_at | TIMESTAMPTZ | Data de criacao |
