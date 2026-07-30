const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Valida id vindo da URL antes de virar query. Um id malformado não deve bater
 * na API só para receber 404 — e um id de outra entidade (o caso do `?id=`
 * compartilhado entre as abas do CRM) é UUID válido, então o 404 ainda precisa
 * ser tratado por quem chama.
 */
export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
