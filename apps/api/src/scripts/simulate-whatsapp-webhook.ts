import { createHmac } from 'crypto';

interface ScriptOptions {
  url: string;
  from: string;
  text: string;
  contactName: string;
  phoneNumberId: string;
}

function readArg(name: string): string | undefined {
  const idx = process.argv.findIndex((value) => value === `--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function buildOptions(): ScriptOptions {
  const url = readArg('url') ?? 'http://127.0.0.1:3333/api/webhooks/whatsapp';
  const from = readArg('from') ?? '5511999999999';
  const text = readArg('text') ?? 'Teste webhook local';
  const contactName = readArg('name') ?? 'Teste Local';
  const phoneNumberId = readArg('phone-number-id') ?? process.env['WHATSAPP_PHONE_NUMBER_ID'] ?? '';

  if (!phoneNumberId) {
    throw new Error('WHATSAPP_PHONE_NUMBER_ID ausente. Defina no .env ou passe --phone-number-id.');
  }

  return { url, from, text, contactName, phoneNumberId };
}

async function run() {
  const appSecret = process.env['META_APP_SECRET'];
  if (!appSecret) {
    throw new Error('META_APP_SECRET ausente. Carregue o .env da API antes de executar.');
  }

  const options = buildOptions();
  const messageId = `wamid.localtest.${Date.now()}`;
  const timestamp = String(Math.floor(Date.now() / 1000));

  const payload = {
    object: 'whatsapp_business_account',
    entry: [
      {
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: options.phoneNumberId },
              contacts: [{ profile: { name: options.contactName } }],
              messages: [
                {
                  from: options.from,
                  id: messageId,
                  timestamp,
                  type: 'text',
                  text: { body: options.text },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;

  const response = await fetch(options.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signature,
    },
    body: rawBody,
  });

  const bodyText = await response.text();

  console.log(`POST ${options.url}`);
  console.log(`status=${response.status}`);
  console.log(`message_id=${messageId}`);
  console.log(`phone_number_id=${options.phoneNumberId}`);
  console.log(`from=${options.from}`);
  console.log(`response=${bodyText}`);
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Erro ao simular webhook: ${message}`);
  process.exitCode = 1;
});
