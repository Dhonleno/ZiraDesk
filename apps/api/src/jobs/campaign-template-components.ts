export interface CampaignTemplateForComponents {
  body?: string | null;
  header_type?: string | null;
}

export interface CampaignForTemplateComponents {
  template_variables?: unknown;
  template_header_media_url?: string | null;
  template_header_media_filename?: string | null;
}

export interface CampaignContactForTemplateComponents {
  name: string;
  phone: string;
  email?: string | null;
}

type MediaHeaderType = 'image' | 'video' | 'document';

function normalizeHeaderType(value: string | null | undefined): string {
  return (value ?? 'NONE').trim().toUpperCase() || 'NONE';
}

function resolveContactVariable(value: string, contact: CampaignContactForTemplateComponents): string {
  return value
    .replace(/\{\{\s*contact\.name\s*\}\}/gi, contact.name)
    .replace(/\{\{\s*contact\.phone\s*\}\}/gi, contact.phone)
    .replace(/\{\{\s*contact\.email\s*\}\}/gi, contact.email ?? '');
}

function normalizeTemplateVariables(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};

  return Object.entries(raw as Record<string, unknown>).reduce<Record<string, string>>((acc, [key, value]) => {
    if (typeof value === 'string') acc[key] = value;
    return acc;
  }, {});
}

function buildBodyComponent(
  templateVariables: Record<string, string>,
  contact: CampaignContactForTemplateComponents,
): Record<string, unknown> | null {
  const entries = Object.entries(templateVariables)
    .map(([key, value]) => ({ index: parseInt(key, 10), value }))
    .filter((item) => Number.isFinite(item.index) && item.index > 0)
    .sort((a, b) => a.index - b.index);

  if (entries.length === 0) return null;

  const parameters = entries.map((item) => ({
    type: 'text',
    text: resolveContactVariable(item.value, contact),
  }));

  return { type: 'body', parameters };
}

function buildHeaderComponent(
  template: CampaignTemplateForComponents,
  campaign: CampaignForTemplateComponents,
): Record<string, unknown> | null {
  const headerType = normalizeHeaderType(template.header_type);
  if (!['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)) return null;

  const link = campaign.template_header_media_url?.trim();
  if (!link) return null;

  const mediaType = headerType.toLowerCase() as MediaHeaderType;
  const mediaPayload: Record<string, string> = { link };
  const filename = campaign.template_header_media_filename?.trim();
  if (mediaType === 'document' && filename) {
    mediaPayload.filename = filename;
  }

  return {
    type: 'header',
    parameters: [
      {
        type: mediaType,
        [mediaType]: mediaPayload,
      },
    ],
  };
}

export function buildTemplateComponentsForCampaign(
  template: CampaignTemplateForComponents,
  campaign: CampaignForTemplateComponents,
  contact: CampaignContactForTemplateComponents,
): Array<Record<string, unknown>> {
  const components: Array<Record<string, unknown>> = [];
  const headerComponent = buildHeaderComponent(template, campaign);
  if (headerComponent) components.push(headerComponent);

  const bodyComponent = buildBodyComponent(normalizeTemplateVariables(campaign.template_variables), contact);
  if (bodyComponent) components.push(bodyComponent);

  return components;
}
