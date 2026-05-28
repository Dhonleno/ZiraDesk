import type { SupportedLanguage } from '../../middleware/language.js';

type TemplateValidationKey =
  | 'template.validation.missingBodyVar'
  | 'template.validation.missingHeaderVar'
  | 'template.validation.missingHeaderMedia'
  | 'template.validation.missingHeaderText'
  | 'template.validation.invalidHeaderMediaUrl'
  | 'template.validation.missingButtonParam'
  | 'template.validation.varCountMismatch';

const messages = {
  'pt-BR': {
    'template.validation.missingBodyVar': 'Variável {{n}} do corpo não preenchida',
    'template.validation.missingHeaderVar': 'Variável {{n}} do cabeçalho não preenchida',
    'template.validation.missingHeaderMedia': 'Template requer mídia no cabeçalho',
    'template.validation.missingHeaderText': 'Texto do cabeçalho não preenchido',
    'template.validation.invalidHeaderMediaUrl': 'URL pública da mídia do cabeçalho inválida',
    'template.validation.missingButtonParam': 'Parâmetro dinâmico do botão {{n}} não preenchido',
    'template.validation.varCountMismatch': 'Número de variáveis não corresponde ao template',
  },
  'en-US': {
    'template.validation.missingBodyVar': 'Body variable {{n}} not filled',
    'template.validation.missingHeaderVar': 'Header variable {{n}} not filled',
    'template.validation.missingHeaderMedia': 'Template requires media in the header',
    'template.validation.missingHeaderText': 'Header text not filled',
    'template.validation.invalidHeaderMediaUrl': 'Invalid public URL for header media',
    'template.validation.missingButtonParam': 'Dynamic button parameter {{n}} not filled',
    'template.validation.varCountMismatch': 'Variable count does not match the template',
  },
  'es': {
    'template.validation.missingBodyVar': 'Variable {{n}} del cuerpo no completada',
    'template.validation.missingHeaderVar': 'Variable {{n}} del encabezado no completada',
    'template.validation.missingHeaderMedia': 'La plantilla requiere medios en el encabezado',
    'template.validation.missingHeaderText': 'Texto del encabezado no completado',
    'template.validation.invalidHeaderMediaUrl': 'URL pública del medio del encabezado inválida',
    'template.validation.missingButtonParam': 'Parámetro dinámico del botón {{n}} no completado',
    'template.validation.varCountMismatch': 'El número de variables no corresponde a la plantilla',
  },
} satisfies Record<SupportedLanguage, Record<TemplateValidationKey, string>>;

export function getTemplateValidationMessage(
  key: TemplateValidationKey,
  params: Record<string, string | number> = {},
  lang: SupportedLanguage = 'pt-BR',
): string {
  let message = messages[lang][key] ?? messages['pt-BR'][key] ?? key;
  for (const [k, v] of Object.entries(params)) {
    const replacement = k === 'n' ? `{{${String(v)}}}` : String(v);
    message = message.replaceAll(`{{${k}}}`, replacement);
  }
  return message;
}
