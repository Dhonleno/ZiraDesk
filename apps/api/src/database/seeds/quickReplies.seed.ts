import type { PrismaClient } from '@prisma/client';

type QuickReplySeed = {
  title: string;
  shortcut: string;
  content: string;
  category: 'greeting' | 'service' | 'commercial' | 'closing' | 'support' | 'other';
};

export const DEFAULT_QUICK_REPLIES: ReadonlyArray<QuickReplySeed> = [
  { title: 'Saudação inicial', shortcut: 'oi', content: 'Olá! Tudo bem? Como posso te ajudar hoje?', category: 'greeting' },
  { title: 'Bom dia', shortcut: 'bomdia', content: 'Bom dia! Seja bem-vindo(a). Como posso ajudar?', category: 'greeting' },
  { title: 'Boa tarde', shortcut: 'boatarde', content: 'Boa tarde! Me conta como posso te apoiar agora.', category: 'greeting' },
  { title: 'Boa noite', shortcut: 'boanoite', content: 'Boa noite! Estou por aqui para te ajudar no que precisar.', category: 'greeting' },
  { title: 'Confirmar entendimento', shortcut: 'entendi', content: 'Perfeito, entendi sua solicitação. Vou seguir com a análise agora.', category: 'service' },
  { title: 'Pedir alguns minutos', shortcut: 'aguarde', content: 'Estou verificando essa informação para você. Me dê alguns minutinhos, por favor.', category: 'service' },
  { title: 'Solicitar dados', shortcut: 'dados', content: 'Para seguir com sua solicitação, preciso de alguns dados. Pode me informar, por favor?', category: 'service' },
  { title: 'Prazo de retorno', shortcut: 'prazo', content: 'Vou te retornar com uma atualização em até {{tempo}}.', category: 'service' },
  { title: 'Reforçar acompanhamento', shortcut: 'acompanhamento', content: 'Seguimos acompanhando o seu caso por aqui e te atualizo assim que tiver novidade.', category: 'service' },
  { title: 'Enviar proposta', shortcut: 'proposta', content: 'Perfeito! Vou preparar a proposta e te envio em seguida.', category: 'commercial' },
  { title: 'Agendar ligação', shortcut: 'ligacao', content: 'Claro! Me diga o melhor horário para agendarmos uma ligação.', category: 'commercial' },
  { title: 'Link de pagamento', shortcut: 'pagamento', content: 'Segue o link de pagamento para darmos continuidade: {{link}}', category: 'commercial' },
  { title: 'Condição comercial', shortcut: 'condicao', content: 'Consigo te enviar uma condição personalizada conforme o seu cenário.', category: 'commercial' },
  { title: 'Reenviar boleto', shortcut: 'boleto', content: 'Sem problemas! Vou reenviar o boleto para você agora mesmo.', category: 'commercial' },
  { title: 'Reset de senha', shortcut: 'resetsenha', content: 'Para resetar sua senha, acesse “Esqueci minha senha” na tela de login e siga o passo a passo.', category: 'support' },
  { title: 'Limpar cache', shortcut: 'cache', content: 'Pode testar limpar o cache do navegador e abrir novamente? Isso costuma resolver esse comportamento.', category: 'support' },
  { title: 'Reiniciar integração', shortcut: 'reintegrar', content: 'Vamos reiniciar a integração para normalizar o funcionamento. Te aviso assim que concluir.', category: 'support' },
  { title: 'Aguardar retorno', shortcut: 'retorno', content: 'Sem problemas. Vou aguardar seu retorno por aqui.', category: 'closing' },
  { title: 'Encerramento cordial', shortcut: 'tchau', content: 'Fico à disposição. Qualquer coisa, é só me chamar.', category: 'closing' },
  { title: 'Encerramento resolvido', shortcut: 'resolvido', content: 'Que bom que conseguimos resolver. Se precisar de algo mais, estamos à disposição!', category: 'closing' },
];

function validateSchemaName(schema: string): string {
  if (!/^[a-z0-9_]+$/.test(schema)) {
    throw new Error('Schema inválido para seed de quick replies');
  }

  return schema;
}

export async function seedQuickReplies(prisma: PrismaClient, schema: string): Promise<void> {
  const safeSchema = validateSchemaName(schema);

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${safeSchema}", public`);

    await tx.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS quick_replies (
        id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        title       VARCHAR(120) NOT NULL,
        shortcut    VARCHAR(50)  NOT NULL UNIQUE,
        content     TEXT         NOT NULL,
        category    VARCHAR(30)  NOT NULL DEFAULT 'other',
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);

    for (const reply of DEFAULT_QUICK_REPLIES) {
      await tx.$executeRawUnsafe(
        `INSERT INTO quick_replies (title, shortcut, content, category)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (shortcut) DO UPDATE
           SET title = EXCLUDED.title,
               content = EXCLUDED.content,
               category = EXCLUDED.category,
               updated_at = NOW()`,
        reply.title,
        reply.shortcut,
        reply.content,
        reply.category,
      );
    }
  });
}

