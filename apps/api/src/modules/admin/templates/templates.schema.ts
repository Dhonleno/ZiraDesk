import { z } from 'zod';

const templateNameRegex = /^[a-z0-9_]+$/;

export const templateVariableSchema = z.object({
  index: z.string().trim().min(1).max(24),
  example: z.string().trim().max(500).default(''),
});

export const templateLanguageSchema = z.enum(['pt_BR', 'en_US', 'es']);
export const templateCategorySchema = z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']);
export const templateHeaderTypeSchema = z.enum(['none', 'text', 'image', 'video', 'document']);

export const quickReplyButtonSchema = z.object({
  type: z.literal('QUICK_REPLY'),
  text: z.string().trim().min(1).max(25),
});

export const urlButtonSchema = z.object({
  type: z.literal('URL'),
  text: z.string().trim().min(1).max(25),
  url: z.string().trim().min(1).max(2000).refine(
    (url) => {
      try { new URL(url.replace(/\{\{1\}\}$/, 'example')); return true; } catch { return false; }
    },
    'URL inválida',
  ),
  example: z.array(z.string()).max(1).optional(),
});

export const phoneButtonSchema = z.object({
  type: z.literal('PHONE_NUMBER'),
  text: z.string().trim().min(1).max(25),
  phone_number: z.string().trim().regex(/^\+[1-9]\d{1,14}$/, 'Formato internacional inválido'),
});

export const templateButtonSchema = z.discriminatedUnion('type', [
  quickReplyButtonSchema,
  urlButtonSchema,
  phoneButtonSchema,
]);

export const templateButtonsArraySchema = z.array(templateButtonSchema)
  .max(10)
  .refine((b) => b.filter((x) => x.type === 'QUICK_REPLY').length <= 3, 'Máximo de 3 botões de resposta rápida')
  .refine((b) => b.filter((x) => x.type === 'URL').length <= 2, 'Máximo de 2 botões de URL')
  .refine((b) => b.filter((x) => x.type === 'PHONE_NUMBER').length <= 1, 'Máximo de 1 botão de telefone');

export const listTemplatesQuerySchema = z.object({
  channel_id: z.string().uuid().optional(),
});

export const createTemplateSchema = z.object({
  channelId: z.string().uuid(),
  technicalName: z.string().trim().min(2).max(128).regex(templateNameRegex),
  displayName: z.string().trim().min(2).max(180),
  language: templateLanguageSchema,
  category: templateCategorySchema,
  body: z.string().trim().min(1).max(1024),
  headerType: templateHeaderTypeSchema.default('none'),
  headerText: z.string().trim().max(60).optional(),
  headerHandle: z.string().trim().min(1).max(4096).optional(),
  footer: z.string().trim().max(60).optional(),
  variables: z.array(templateVariableSchema).max(30).default([]),
  buttons: templateButtonsArraySchema.default([]),
}).superRefine((data, context) => {
  if (data.headerType === 'text' && !data.headerText) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['headerText'],
      message: 'Informe o texto do cabeçalho',
    });
  }
  if (['image', 'video', 'document'].includes(data.headerType) && !data.headerHandle) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['headerHandle'],
      message: 'Envie a mídia de exemplo do cabeçalho',
    });
  }
});

export const updateTemplateSchema = z.object({
  channelId: z.string().uuid().optional(),
  technicalName: z.string().trim().min(2).max(128).regex(templateNameRegex).optional(),
  displayName: z.string().trim().min(2).max(180).optional(),
  language: templateLanguageSchema.optional(),
  category: templateCategorySchema.optional(),
  body: z.string().trim().min(1).max(1024).optional(),
  headerType: templateHeaderTypeSchema.optional(),
  headerText: z.string().trim().max(60).optional(),
  headerHandle: z.string().trim().min(1).max(4096).optional(),
  footer: z.string().trim().max(60).optional(),
  variables: z.array(templateVariableSchema).max(30).optional(),
  buttons: templateButtonsArraySchema.optional(),
});

export const syncTemplatesSchema = z.object({
  channelId: z.string().uuid(),
});

export type TemplateVariableInput = z.infer<typeof templateVariableSchema>;
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
export type SyncTemplatesInput = z.infer<typeof syncTemplatesSchema>;
export type TemplateButtonInput = z.infer<typeof templateButtonSchema>;
