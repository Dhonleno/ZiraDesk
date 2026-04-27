# Banco de Dados — ZiraDesk

## Estratégia: Schema-per-tenant

Cada tenant recebe um schema isolado no PostgreSQL.
O schema `public` contém apenas dados globais do sistema.

## Schema PUBLIC

### plans
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Chave primária |
| name | VARCHAR(50) | Nome do plano (Starter, Pro, Enterprise) |
| slug | VARCHAR(50) | Identificador único |
| price_month | DECIMAL | Preço mensal |
| price_year | DECIMAL | Preço anual |
| max_users | INTEGER | Limite de usuários |
| max_contacts | INTEGER | Limite de contatos |
| features | JSONB | Features habilitadas no plano |
| is_active | BOOLEAN | Se o plano está disponível |
| created_at | TIMESTAMPTZ | Data de criação |

### tenants
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Chave primária |
| name | VARCHAR(100) | Nome da empresa |
| slug | VARCHAR(50) | Subdomínio (empresa.ziradesk.com.br) |
| schema_name | VARCHAR(63) | Nome do schema isolado |
| plan_id | UUID FK | Plano contratado |
| status | VARCHAR(20) | active, suspended, cancelled |
| trial_ends_at | TIMESTAMPTZ | Fim do período trial |
| settings | JSONB | Configurações do tenant |
| created_at | TIMESTAMPTZ | Data de criação |

### subscriptions
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Chave primária |
| tenant_id | UUID FK | Tenant associado |
| plan_id | UUID FK | Plano associado |
| status | VARCHAR(20) | active, past_due, cancelled |
| current_period_start | TIMESTAMPTZ | Início do período atual |
| current_period_end | TIMESTAMPTZ | Fim do período atual |
| payment_gateway | VARCHAR(30) | stripe, pagarme |
| gateway_sub_id | VARCHAR(100) | ID na plataforma de pagamento |
| created_at | TIMESTAMPTZ | Data de criação |

### super_admins
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Chave primária |
| name | VARCHAR(100) | Nome |
| email | VARCHAR(255) | E-mail único |
| password_hash | VARCHAR(255) | Senha com bcrypt custo 12 |
| created_at | TIMESTAMPTZ | Data de criação |

## Schema TENANT (tenant_{slug})

### users
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Chave primária |
| name | VARCHAR(100) | Nome |
| email | VARCHAR(255) | E-mail único no tenant |
| password_hash | VARCHAR(255) | Senha com bcrypt custo 12 |
| role | VARCHAR(30) | owner, admin, agent, viewer |
| avatar_url | VARCHAR(500) | URL do avatar |
| status | VARCHAR(20) | active, inactive |
| last_seen_at | TIMESTAMPTZ | Último acesso |
| language | VARCHAR(10) | pt-BR, en-US, es |
| settings | JSONB | Preferências do usuário |
| created_at | TIMESTAMPTZ | Data de criação |

### clients
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Chave primária |
| type | VARCHAR(20) | person, company |
| name | VARCHAR(150) | Nome completo |
| email | VARCHAR(255) | E-mail |
| phone | VARCHAR(30) | Telefone |
| document | VARCHAR(20) | CPF ou CNPJ |
| status | VARCHAR(30) | lead, prospect, client, inactive |
| address_street | VARCHAR(200) | Logradouro |
| address_city | VARCHAR(100) | Cidade |
| address_state | VARCHAR(2) | Estado |
| address_zip | VARCHAR(10) | CEP |
| birth_date | DATE | Data de nascimento |
| gender | VARCHAR(20) | Gênero |
| occupation | VARCHAR(100) | Profissão |
| income | DECIMAL | Renda |
| segment | VARCHAR(100) | Segmento |
| lead_source | VARCHAR(100) | Origem do lead |
| responsible_id | UUID FK | Usuário responsável |
| tags | TEXT[] | Tags |
| custom_fields | JSONB | Campos personalizados |
| created_at | TIMESTAMPTZ | Data de criação |
| updated_at | TIMESTAMPTZ | Última atualização |

### channels
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Chave primária |
| type | VARCHAR(30) | whatsapp, instagram, email, webchat |
| name | VARCHAR(100) | Nome do canal |
| credentials | JSONB | Tokens e webhooks (AES-256) |
| status | VARCHAR(20) | active, inactive |
| settings | JSONB | Configurações específicas do canal |
| created_at | TIMESTAMPTZ | Data de criação |

### conversations
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Chave primária |
| client_id | UUID FK | Cliente |
| channel_id | UUID FK | Canal de origem |
| channel_type | VARCHAR(30) | Tipo do canal |
| external_id | VARCHAR(255) | ID no canal externo |
| status | VARCHAR(20) | open, pending, resolved, bot |
| assigned_to | UUID FK | Agente responsável |
| last_message | TEXT | Prévia da última mensagem |
| last_message_at | TIMESTAMPTZ | Data da última mensagem |
| resolved_at | TIMESTAMPTZ | Data de resolução |
| metadata | JSONB | Dados extras do canal |
| created_at | TIMESTAMPTZ | Data de criação |

### messages
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Chave primária |
| conversation_id | UUID FK | Conversa |
| sender_type | VARCHAR(20) | client, agent, bot, system |
| sender_id | UUID | ID do remetente |
| content | TEXT | Conteúdo da mensagem |
| content_type | VARCHAR(30) | text, image, audio, video, document |
| media_url | VARCHAR(500) | URL da mídia |
| status | VARCHAR(20) | sent, delivered, read, failed |
| is_internal | BOOLEAN | Nota interna (não enviada ao cliente) |
| metadata | JSONB | Dados extras |
| created_at | TIMESTAMPTZ | Data de criação |

### tickets
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Chave primária |
| client_id | UUID FK | Cliente |
| conversation_id | UUID FK | Conversa de origem |
| title | VARCHAR(255) | Título |
| description | TEXT | Descrição |
| status | VARCHAR(30) | open, in_progress, waiting, resolved, closed |
| priority | VARCHAR(20) | low, medium, high, urgent |
| category | VARCHAR(100) | Categoria |
| assigned_to | UUID FK | Agente responsável |
| due_date | TIMESTAMPTZ | Prazo |
| tags | TEXT[] | Tags |
| custom_fields | JSONB | Campos personalizados |
| created_at | TIMESTAMPTZ | Data de criação |
| updated_at | TIMESTAMPTZ | Última atualização |

### ticket_comments
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Chave primária |
| ticket_id | UUID FK | Ticket |
| user_id | UUID FK | Usuário |
| content | TEXT | Conteúdo |
| is_internal | BOOLEAN | Comentário interno |
| created_at | TIMESTAMPTZ | Data de criação |

### audit_logs
| Campo | Tipo | Descrição |
|-------|------|-----------|
| id | UUID | Chave primária |
| user_id | UUID | Usuário que executou a ação |
| action | VARCHAR(100) | Ação executada |
| entity | VARCHAR(50) | Entidade afetada |
| entity_id | UUID | ID da entidade |
| old_data | JSONB | Dados anteriores |
| new_data | JSONB | Dados novos |
| ip_address | INET | IP do usuário |
| created_at | TIMESTAMPTZ | Data de criação |
