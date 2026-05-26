# Formato de Exportação LGPD do ZiraDesk

## Objetivo
Este documento define o contrato oficial de exportação de dados pessoais para portabilidade no ZiraDesk, em formato estruturado e legível por máquina.

## Schema oficial
- Arquivo canônico: `docs/lgpd/data-export-schema.json`
- URL pública do schema atual: `https://ziradesk.com.br/schemas/lgpd-export-v1.json`
- Endpoint público da API: `GET /api/legal/lgpd-export-schema`

## Estrutura de alto nível
Campos obrigatórios na versão `1.2.0`:
- `schema_version`
- `exported_at`
- `exported_by`
- `subject`
- `consent`
- `contacts`
- `conversations`
- `messages`
- `tickets`
- `audit_trail`
- `metadata`

Campos legados podem coexistir para retrocompatibilidade (`generated_at`, `request_id`, etc.).

## Identificadores

ZiraDesk usa duas estratégias de ID conforme o schema:

| Tipo | Formato | Pattern | Usado em |
|---|---|---|---|
| tenantId | cuid | `^c[a-z0-9]{24}$` | metadata.tenant_id, plan_id |
| entityId | UUID v4 | RFC 4122 | demais IDs do payload |

Esta dualidade reflete decisão arquitetural: schema public usa Prisma
(cuid nativamente); schemas tenant são provisionados via SQL raw e
usam gen_random_uuid() do Postgres.

## Política de versionamento (SemVer)
O schema segue `MAJOR.MINOR.PATCH`.

- `MAJOR`: mudanças incompatíveis (breaking changes), como remoção/renomeação de campos, mudança de tipo obrigatória ou alteração de semântica que invalide consumidores existentes.
- `MINOR`: adição retrocompatível (campos opcionais novos, novos enum values compatíveis, novas definições não obrigatórias).
- `PATCH`: correções sem quebra de contrato (descrição, exemplos, metadados, ajustes de validação não-breaking).

### Quando fazer bump major
Faça bump de `MAJOR` quando ocorrer pelo menos um dos casos:
- Campo obrigatório removido ou renomeado.
- Campo existente muda de tipo de forma incompatível.
- Regra de validação torna payloads antigos inválidos sem fallback.
- Semântica de campo muda e altera interpretação do dado por consumidores.

## Janela de compatibilidade
O backend mantém compatibilidade backward para as 2 versões anteriores do schema no processo de validação e geração de payloads.

Exemplo prático:
- Atual em `2.3.0`.
- Compatíveis: `2.2.x` e `2.1.x`.

## Como o titular (ou consumidor) valida o JSON recebido
1. Obter o schema oficial em `GET /api/legal/lgpd-export-schema`.
2. Salvar o payload exportado em arquivo (ex.: `export.json`).
3. Validar com JSON Schema Draft 2020-12 via AJV.

Exemplo (Node.js):

```bash
node -e "const fs=require('fs');const Ajv2020=require('ajv/dist/2020').default;const addFormats=require('ajv-formats').default;const schema=JSON.parse(fs.readFileSync('data-export-schema.json','utf8'));const payload=JSON.parse(fs.readFileSync('export.json','utf8'));const ajv=new Ajv2020({allErrors:true,strict:false});addFormats(ajv);const validate=ajv.compile(schema);const valid=validate(payload);console.log(valid ? 'VALID' : validate.errors);"
```

Também é possível validar visualmente em ferramentas como `jsonschemavalidator.net`, usando o schema público e o payload recebido.

## Referências regulatórias e normativas
- LGPD, art. 18, inciso V (portabilidade de dados): https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2018/lei/L13709.htm
- GDPR, art. 20 (right to data portability): https://gdpr-info.eu/art-20-gdpr/
- ISO/IEC 27701:2019 (Privacy Information Management): https://www.iso.org/standard/71670.html

## Changelog
## 1.2.0 — Reconhecimento de arquitetura dual de IDs
- Schema agora valida por campo: tenantId (cuid) para metadata.tenant_id; entityId (UUID) para demais IDs
- Versão anterior 1.1.0 estava incorreta ao forçar cuid em todos os campos
- Refletir a realidade do sistema melhora confiabilidade da portabilidade

## 1.1.0 — Correção do formato de identificadores
- Validação estrita: apenas cuid (`^c[a-z0-9]{24}$`).
- Reflete o formato real usado pelo backend desde a versão inicial.
