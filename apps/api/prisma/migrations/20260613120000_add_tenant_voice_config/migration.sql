CREATE TABLE IF NOT EXISTS public.tenant_voice_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             TEXT UNIQUE NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  twilio_phone_number   VARCHAR(20) UNIQUE NOT NULL,
  default_bot_menu_id   UUID,
  ivr_enabled           BOOLEAN NOT NULL DEFAULT true,
  ring_timeout_seconds  INTEGER NOT NULL DEFAULT 20,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_voice_config_phone
  ON public.tenant_voice_config(twilio_phone_number);
