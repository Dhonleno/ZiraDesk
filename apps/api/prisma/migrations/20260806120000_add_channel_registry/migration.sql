-- CreateTable
-- Unicidade global de phone_number_id entre tenants. O modelo schema-per-tenant
-- nao permite UNIQUE cross-schema, e o valor vive cifrado (AES-CBC com IV
-- aleatorio) dentro de "<schema>".channels.credentials — invisivel para qualquer
-- constraint SQL. Esta tabela em public e a unica forma de tornar a unicidade dura.
CREATE TABLE IF NOT EXISTS "channel_registry" (
    "phone_number_id" TEXT NOT NULL,
    "tenant_schema" TEXT NOT NULL,
    "channel_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "channel_registry_pkey" PRIMARY KEY ("phone_number_id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_channel_registry_tenant_schema" ON "channel_registry"("tenant_schema");

-- AddForeignKey
-- ON DELETE CASCADE e obrigatorio, nao conveniencia: sem ele, remover um tenant
-- (DROP SCHEMA + DELETE da linha) deixa a reivindicacao orfa e o numero fica
-- reservado para sempre a um tenant que nao existe mais — nenhum outro tenant
-- consegue reconecta-lo. O soft delete (status='cancelled') mantem a linha em
-- public.tenants, entao a reserva do tenant cancelado e preservada de proposito.
ALTER TABLE "channel_registry"
    ADD CONSTRAINT "channel_registry_tenant_schema_fkey"
    FOREIGN KEY ("tenant_schema") REFERENCES "tenants"("schema_name")
    ON DELETE CASCADE ON UPDATE CASCADE;
