import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ErrorObject } from 'ajv';
import bundledSchemaJson from './data-export-schema.json' with { type: 'json' };

export const LGPD_EXPORT_SCHEMA_VERSION = '1.2.0';

function loadSchemaFromDocs(): Record<string, unknown> | null {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  const repoRoot = path.resolve(currentDir, '../../../../../');
  const docsSchemaPath = path.join(repoRoot, 'docs', 'lgpd', 'data-export-schema.json');

  if (!existsSync(docsSchemaPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(docsSchemaPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const LGPD_EXPORT_SCHEMA = loadSchemaFromDocs() ?? bundledSchemaJson;

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});
const addFormatsPlugin = addFormats as unknown as (instance: Ajv2020) => void;
addFormatsPlugin(ajv);

const validateSchema = ajv.compile(LGPD_EXPORT_SCHEMA);

export function validateExportPayload(payload: unknown): {
  valid: boolean;
  errors: string[];
} {
  const valid = validateSchema(payload);
  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors = (validateSchema.errors ?? []).map((error: ErrorObject) => {
    const pathText = error.instancePath || '/';
    return `${pathText} ${error.message ?? 'invalid'}`.trim();
  });

  return { valid: false, errors };
}
