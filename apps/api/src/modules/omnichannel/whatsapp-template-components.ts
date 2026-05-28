export type HeaderMediaType = 'image' | 'video' | 'document';

export interface HeaderMediaInput {
  type: HeaderMediaType;
  url: string;
}

export interface ButtonParametersInput {
  index: number;
  subType: string;
  parameters: string[];
}

interface BuildTemplateComponentsInput {
  templateComponents?: Record<string, unknown>[] | null | undefined;
  bodyParameters?: string[] | null | undefined;
  headerText?: string | null | undefined;
  headerMedia?: HeaderMediaInput | null | undefined;
  buttonParameters?: ButtonParametersInput[] | null | undefined;
}

const PRIVATE_IPV4_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
];

function normalizeComponentType(component: Record<string, unknown>): string {
  return typeof component.type === 'string' ? component.type.trim().toLowerCase() : '';
}

function normalizeTemplateComponents(components: unknown): Record<string, unknown>[] {
  if (!Array.isArray(components)) return [];
  return components.filter(
    (component): component is Record<string, unknown> => Boolean(component) && typeof component === 'object',
  );
}

function hasStructuredInput(input: BuildTemplateComponentsInput): boolean {
  return (
    input.bodyParameters !== undefined
    || input.headerText !== undefined
    || input.headerMedia !== undefined
    || input.buttonParameters !== undefined
  );
}

function textParameter(text: string): Record<string, unknown> {
  return {
    type: 'text',
    text: text.trim(),
  };
}

function buttonParameter(subType: string, value: string): Record<string, unknown> {
  const normalizedSubType = subType.trim().toLowerCase();
  if (normalizedSubType === 'quick_reply') {
    return {
      type: 'payload',
      payload: value.trim(),
    };
  }

  return textParameter(value);
}

export function isPublicHttpUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
  if (hostname === '::1' || hostname === '[::1]') return false;
  if (PRIVATE_IPV4_RANGES.some((regex) => regex.test(hostname))) return false;

  return true;
}

export function buildTemplateComponentsFromInput(input: BuildTemplateComponentsInput): Record<string, unknown>[] {
  const baseComponents = normalizeTemplateComponents(input.templateComponents);
  if (!hasStructuredInput(input)) return baseComponents;

  const replacedTypes = new Set<string>();
  if (input.bodyParameters !== undefined) replacedTypes.add('body');
  if (input.headerText !== undefined || input.headerMedia !== undefined) replacedTypes.add('header');
  if (input.buttonParameters !== undefined) replacedTypes.add('button');

  const components = baseComponents.filter((component) => !replacedTypes.has(normalizeComponentType(component)));

  if (input.headerMedia) {
    const mediaType = input.headerMedia.type;
    components.push({
      type: 'header',
      parameters: [{
        type: mediaType,
        [mediaType]: {
          link: input.headerMedia.url.trim(),
        },
      }],
    });
  } else if (typeof input.headerText === 'string' && input.headerText.trim()) {
    components.push({
      type: 'header',
      parameters: [textParameter(input.headerText)],
    });
  }

  if (Array.isArray(input.bodyParameters) && input.bodyParameters.length > 0) {
    components.push({
      type: 'body',
      parameters: input.bodyParameters.map(textParameter),
    });
  }

  if (Array.isArray(input.buttonParameters)) {
    for (const button of input.buttonParameters) {
      const subType = button.subType.trim().toLowerCase();
      components.push({
        type: 'button',
        sub_type: subType,
        index: button.index,
        parameters: button.parameters.map((parameter) => buttonParameter(subType, parameter)),
      });
    }
  }

  return components;
}

export function findInvalidTemplateMediaUrl(components: Record<string, unknown>[]): string | null {
  for (const component of components) {
    if (normalizeComponentType(component) !== 'header') continue;
    if (!Array.isArray(component.parameters)) continue;

    const parameters = component.parameters.filter(
      (parameter): parameter is Record<string, unknown> => Boolean(parameter) && typeof parameter === 'object',
    );

    for (const parameter of parameters) {
      const type = typeof parameter.type === 'string' ? parameter.type.trim().toLowerCase() : '';
      if (type !== 'image' && type !== 'video' && type !== 'document') continue;

      const media = parameter[type];
      if (!media || typeof media !== 'object') return '';

      const link = (media as Record<string, unknown>).link;
      if (typeof link !== 'string' || !isPublicHttpUrl(link.trim())) {
        return typeof link === 'string' ? link : '';
      }
    }
  }

  return null;
}
