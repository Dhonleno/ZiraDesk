import {
  LGPD_EXPORT_SCHEMA,
  LGPD_EXPORT_SCHEMA_VERSION,
  validateExportPayload,
} from './validate-export.js';

export { LGPD_EXPORT_SCHEMA, LGPD_EXPORT_SCHEMA_VERSION };

export function validateLgpdExportPayload(payload: unknown): {
  valid: boolean;
  errors: string[];
} {
  return validateExportPayload(payload);
}

export function assertValidLgpdExportPayload(payload: unknown): void {
  const result = validateExportPayload(payload);
  if (!result.valid) {
    throw new Error(`Payload de exportação LGPD inválido: ${result.errors.join('; ')}`);
  }
}