import { describe, expect, it } from 'vitest';
import { buildTemplateComponentsFromInput } from './whatsapp-template-components.js';

describe('buildTemplateComponentsFromInput', () => {
  it('constrói componente de header IMAGE com link correto', () => {
    const components = buildTemplateComponentsFromInput({
      headerMedia: { type: 'image', url: 'https://cdn.test/foto.jpg' },
    });

    expect(components).toEqual([
      {
        type: 'header',
        parameters: [
          { type: 'image', image: { link: 'https://cdn.test/foto.jpg' } },
        ],
      },
    ]);
  });

  it('constrói componente de header VIDEO com link correto', () => {
    const components = buildTemplateComponentsFromInput({
      headerMedia: { type: 'video', url: 'https://cdn.test/video.mp4' },
    });

    expect(components).toEqual([
      {
        type: 'header',
        parameters: [
          { type: 'video', video: { link: 'https://cdn.test/video.mp4' } },
        ],
      },
    ]);
  });

  it('constrói botão URL dinâmico com parâmetro de texto', () => {
    const components = buildTemplateComponentsFromInput({
      buttonParameters: [{ index: 0, subType: 'url', parameters: ['12345'] }],
    });

    expect(components).toEqual([
      {
        type: 'button',
        sub_type: 'url',
        index: 0,
        parameters: [{ type: 'text', text: '12345' }],
      },
    ]);
  });

  it('constrói botão quick_reply com payload', () => {
    const components = buildTemplateComponentsFromInput({
      buttonParameters: [{ index: 1, subType: 'quick_reply', parameters: ['SIM'] }],
    });

    expect(components).toEqual([
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: 1,
        parameters: [{ type: 'payload', payload: 'SIM' }],
      },
    ]);
  });

  it('monta payload completo com header, body e botão', () => {
    const components = buildTemplateComponentsFromInput({
      headerMedia: { type: 'document', url: 'https://cdn.test/contrato.pdf' },
      bodyParameters: ['Maria', 'A-2024'],
      buttonParameters: [{ index: 0, subType: 'url', parameters: ['A-2024'] }],
    });

    expect(components).toEqual([
      {
        type: 'header',
        parameters: [
          { type: 'document', document: { link: 'https://cdn.test/contrato.pdf' } },
        ],
      },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Maria' },
          { type: 'text', text: 'A-2024' },
        ],
      },
      {
        type: 'button',
        sub_type: 'url',
        index: 0,
        parameters: [{ type: 'text', text: 'A-2024' }],
      },
    ]);
  });
});
