import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseContactImportBuffer } from './contacts-import.service.js';

function workbookBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Contatos');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('contact import parser', () => {
  it('reads a regular Excel worksheet by column', () => {
    const buffer = workbookBuffer([
      ['Nome', 'E-mail', 'Telefone', 'Organização'],
      ['Maria Silva', 'maria@example.com', '11 99999-0000', 'Empresa Exemplo'],
    ]);

    expect(parseContactImportBuffer(buffer, 'xlsx')).toEqual([
      {
        Nome: 'Maria Silva',
        'E-mail': 'maria@example.com',
        Telefone: '11 99999-0000',
        Organização: 'Empresa Exemplo',
      },
    ]);
  });

  it('expands comma-separated rows stored in a single Excel column', () => {
    const buffer = workbookBuffer([
      ['Nome,E-mail,Telefone,WhatsApp,Organização,Cargo,Departamento,Tags,Campos customizados'],
      ['BRASPLAN EMPREENDIMENTOS E PARTICIPACOES LTDA,casagrande@cgei.com.br,11 37116600,11 37116600,BRASPLAN EMPREENDIMENTOS E PARTICIPACOES LTDA,,,,'],
    ]);

    expect(parseContactImportBuffer(buffer, 'xlsx')).toEqual([
      {
        Nome: 'BRASPLAN EMPREENDIMENTOS E PARTICIPACOES LTDA',
        'E-mail': 'casagrande@cgei.com.br',
        Telefone: '11 37116600',
        WhatsApp: '11 37116600',
        Organização: 'BRASPLAN EMPREENDIMENTOS E PARTICIPACOES LTDA',
        Cargo: '',
        Departamento: '',
        Tags: '',
        'Campos customizados': '',
      },
    ]);
  });

  it('expands semicolon-separated rows and preserves quoted delimiters', () => {
    const buffer = workbookBuffer([
      ['Nome;E-mail;Telefone;Organização'],
      ['"Silva, Maria";maria@example.com;11999990000;"Empresa; Exemplo"'],
    ]);

    expect(parseContactImportBuffer(buffer, 'xlsx')).toEqual([
      {
        Nome: 'Silva, Maria',
        'E-mail': 'maria@example.com',
        Telefone: '11999990000',
        Organização: 'Empresa; Exemplo',
      },
    ]);
  });
});
