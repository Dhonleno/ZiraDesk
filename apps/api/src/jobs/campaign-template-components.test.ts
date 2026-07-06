import { describe, expect, it } from 'vitest';
import { buildTemplateComponentsForCampaign } from './campaign-template-components.js';

describe('buildTemplateComponentsForCampaign', () => {
  it('monta HEADER IMAGE e BODY com variáveis da campanha', () => {
    const components = buildTemplateComponentsForCampaign(
      { body: 'Olá {{1}}', header_type: 'IMAGE' },
      {
        template_variables: { 1: '{{contact.name}}' },
        template_header_media_url: 'https://cdn.example.com/header.jpg',
      },
      { name: 'Beatriz', phone: '5511999990000', email: 'bia@example.com' },
    );

    expect(components).toEqual([
      {
        type: 'header',
        parameters: [
          {
            type: 'image',
            image: { link: 'https://cdn.example.com/header.jpg' },
          },
        ],
      },
      {
        type: 'body',
        parameters: [{ type: 'text', text: 'Beatriz' }],
      },
    ]);
  });

  it('não monta HEADER quando o template não tem mídia', () => {
    const components = buildTemplateComponentsForCampaign(
      { body: 'Olá {{1}}', header_type: 'NONE' },
      {
        template_variables: { 1: '{{contact.phone}}' },
        template_header_media_url: 'https://cdn.example.com/ignored.jpg',
      },
      { name: 'Contato', phone: '5511888880000' },
    );

    expect(components).toEqual([
      {
        type: 'body',
        parameters: [{ type: 'text', text: '5511888880000' }],
      },
    ]);
  });
});
