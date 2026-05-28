import { describe, expect, it } from 'vitest';
import {
  resolveActiveOutboundTemplateAvailability,
  validateTemplateVariablesForOutbound,
} from './active-outbound.routes.js';

describe('resolveActiveOutboundTemplateAvailability', () => {
  it('marca template aprovado e sincronizado como enviável', () => {
    expect(resolveActiveOutboundTemplateAvailability({
      status: 'approved',
      meta_template_id: 'meta-template-1',
    })).toEqual({
      is_sendable: true,
      unavailable_reason: null,
    });
  });

  it('marca template sem vínculo com a Meta como não sincronizado', () => {
    expect(resolveActiveOutboundTemplateAvailability({
      status: 'approved',
      meta_template_id: null,
    })).toEqual({
      is_sendable: false,
      unavailable_reason: 'not_synced',
    });
  });

  it('marca template não aprovado como indisponível', () => {
    expect(resolveActiveOutboundTemplateAvailability({
      status: 'pending',
      meta_template_id: 'meta-template-1',
    })).toEqual({
      is_sendable: false,
      unavailable_reason: 'not_approved',
    });
  });
});

describe('validateTemplateVariablesForOutbound', () => {
  it('retorna erro específico quando variável do corpo não é preenchida', () => {
    const result = validateTemplateVariablesForOutbound({
      body: 'Olá {{1}}, seu protocolo é {{2}}.',
      header: null,
      headerFormat: null,
      buttons: [],
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: 'Maria' },
          { type: 'text', text: '' },
        ],
      }],
    });

    expect(result).toEqual({
      code: 'template.validation.missingBodyVar',
      message: 'Variável {{2}} do corpo não preenchida',
    });
  });

  it('retorna erro quando a quantidade de variáveis do corpo diverge', () => {
    const result = validateTemplateVariablesForOutbound({
      body: 'Olá {{1}}.',
      header: null,
      headerFormat: null,
      buttons: [],
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: 'Maria' },
          { type: 'text', text: 'extra' },
        ],
      }],
    });

    expect(result).toEqual({
      code: 'template.validation.varCountMismatch',
      message: 'Número de variáveis não corresponde ao template',
    });
  });

  it('exige texto quando cabeçalho TEXT tem variável', () => {
    const result = validateTemplateVariablesForOutbound({
      body: 'Mensagem sem variável.',
      header: 'Pedido {{1}}',
      headerFormat: 'TEXT',
      buttons: [],
      components: [],
    });

    expect(result).toEqual({
      code: 'template.validation.missingHeaderVar',
      message: 'Variável {{1}} do cabeçalho não preenchida',
    });
  });

  it('exige mídia quando cabeçalho é IMAGE/VIDEO/DOCUMENT', () => {
    const result = validateTemplateVariablesForOutbound({
      body: 'Mensagem sem variável.',
      header: null,
      headerFormat: 'IMAGE',
      buttons: [],
      components: [],
    });

    expect(result).toEqual({
      code: 'template.validation.missingHeaderMedia',
      message: 'Template requer mídia no cabeçalho',
    });
  });

  it('exige parâmetro para botão dinâmico', () => {
    const result = validateTemplateVariablesForOutbound({
      body: 'Mensagem sem variável.',
      header: null,
      headerFormat: null,
      buttons: [{ type: 'URL', text: 'Ver pedido', url: 'https://app.test/pedidos/{{1}}' }],
      components: [],
    });

    expect(result).toEqual({
      code: 'template.validation.missingButtonParam',
      message: 'Parâmetro dinâmico do botão {{1}} não preenchido',
    });
  });

  it('aceita template preenchido completamente', () => {
    const result = validateTemplateVariablesForOutbound({
      body: 'Olá {{1}}, protocolo {{2}}.',
      header: 'Pedido {{1}}',
      headerFormat: 'TEXT',
      buttons: [{ type: 'URL', text: 'Ver pedido', url: 'https://app.test/pedidos/{{1}}' }],
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Maria' },
            { type: 'text', text: '123' },
          ],
        },
        {
          type: 'header',
          parameters: [{ type: 'text', text: '123' }],
        },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: '123' }],
        },
      ],
    });

    expect(result).toBeNull();
  });

  it('valida botão URL dinâmico usando o índice original do template', () => {
    const result = validateTemplateVariablesForOutbound({
      body: 'Mensagem sem variável.',
      header: null,
      headerFormat: null,
      buttons: [
        { type: 'QUICK_REPLY', text: 'Agora não' },
        { type: 'URL', text: 'Ver pedido', url: 'https://app.test/pedidos/{{1}}' },
      ],
      components: [
        {
          type: 'button',
          sub_type: 'url',
          index: '1',
          parameters: [{ type: 'text', text: '123' }],
        },
      ],
    });

    expect(result).toBeNull();
  });
});
