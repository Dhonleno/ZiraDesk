import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_QUICK_REPLIES } from '../src/database/seeds/quickReplies.seed.js';
import { createTenant } from '../src/modules/super-admin/tenants/tenants.service.js';

const prisma = new PrismaClient();

// ── Planos ─────────────────────────────────────────────────────────────────────
const PLANS = [
  {
    name: 'Starter',
    slug: 'starter',
    priceMonth: 97,
    priceYear: 970,
    maxUsers: 3,
    maxContacts: 500,
    maxMessages: -1,
    features: { whatsapp: false, email: false, live_chat: false, reports: false, api_access: false, custom_domain: false, sla: false, webhooks: false },
    isActive: true,
  },
  {
    name: 'Pro',
    slug: 'pro',
    priceMonth: 197,
    priceYear: 1970,
    maxUsers: 10,
    maxContacts: 5000,
    maxMessages: -1,
    features: { whatsapp: true, email: true, live_chat: false, reports: true, api_access: false, custom_domain: false, sla: false, webhooks: true },
    isActive: true,
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    priceMonth: 497,
    priceYear: 4970,
    maxUsers: -1,
    maxContacts: -1,
    maxMessages: -1,
    features: { whatsapp: true, email: true, live_chat: true, reports: true, api_access: true, custom_domain: true, sla: true, webhooks: true },
    isActive: true,
  },
];

async function seedPlans() {
  for (const plan of PLANS) {
    await prisma.plan.upsert({
      where: { slug: plan.slug },
      update: {},
      create: plan,
    });
    console.log(`  ✓ Plano "${plan.name}"`);
  }
}

async function seedSuperAdmin() {
  const email = process.env['SEED_SUPER_ADMIN_EMAIL'] ?? 'admin@ziradesk.com';
  const password = process.env['SEED_SUPER_ADMIN_PASSWORD'] ?? 'ZiraDesk@2025';

  const existing = await prisma.superAdmin.findUnique({ where: { email } });
  if (existing) {
    console.log(`  · Super Admin já existe (${email})`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.superAdmin.create({
    data: { name: 'Super Admin', email, passwordHash },
  });
  console.log(`  ✓ Super Admin criado`);
  console.log(`    email:  ${email}`);
  console.log(`    senha:  ${password}`);
}

async function seedDemoTenant() {
  const slug = 'demo';
  const existing = await prisma.tenant.findUnique({ where: { slug } });
  if (existing) {
    console.log(`  · Tenant demo já existe (slug: ${slug})`);
    return;
  }

  const plan = await prisma.plan.findUnique({ where: { slug: 'pro' } });
  if (!plan) throw new Error('Plano "pro" não encontrado — rode o seed de planos primeiro');

  const ownerEmail = process.env['SEED_DEMO_EMAIL'] ?? 'owner@demo.ziradesk.com';
  const { tenant, tempPassword } = await createTenant({
    name: 'ZiraDesk Demo',
    slug,
    planId: plan.id,
    ownerName: 'Demo Owner',
    ownerEmail,
    trialDays: 30,
  });

  // Ativa o tenant imediatamente (trial já tem acesso, mas status active é mais limpo)
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { status: 'active' },
  });

  console.log(`  ✓ Tenant demo criado (schema: ${tenant.schemaName})`);
  console.log(`    email:  ${ownerEmail}`);
  console.log(`    senha:  ${tempPassword}`);
  console.log(`    slug:   ${slug}  ← use como "Workspace" no login em dev`);
}

async function seedDemoConversations() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'demo' } });
  if (!tenant) {
    console.log('  · Tenant demo não encontrado, pulando');
    return;
  }

  const s = tenant.schemaName;

  // Idempotência
  const [{ count }] = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS count FROM "${s}".conversations`,
  );
  if (parseInt(count) > 0) {
    console.log(`  · Conversas mock já existem (${count})`);
    return;
  }

  // ── Canais ──────────────────────────────────────────────────────────────────
  await prisma.$executeRawUnsafe(`
    INSERT INTO "${s}".channels (id, type, name, status) VALUES
      ('a0000001-0000-0000-0000-000000000001', 'whatsapp',  'WhatsApp Comercial', 'active'),
      ('a0000001-0000-0000-0000-000000000002', 'email',     'Suporte por E-mail', 'active'),
      ('a0000001-0000-0000-0000-000000000003', 'live_chat', 'Chat do Site',       'active')
  `);
  console.log('  ✓ Canais');

  // ── Agente extra ─────────────────────────────────────────────────────────────
  const agentPw = await bcrypt.hash('Agent@2025', 10);
  await prisma.$executeRawUnsafe(`
    INSERT INTO "${s}".users (id, name, email, password_hash, role)
    VALUES ('b0000001-0000-0000-0000-000000000001', 'Carlos Souza', 'carlos@demo.ziradesk.com', '${agentPw}', 'agent')
    ON CONFLICT (email) DO NOTHING
  `);

  // Pega o owner (primeiro user)
  const [owner] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT id FROM "${s}".users WHERE role = 'owner' LIMIT 1`,
  );
  const ownerId = owner?.id ?? null;
  const agentId = 'b0000001-0000-0000-0000-000000000001';
  console.log('  ✓ Agente extra');

  // ── Contatos ─────────────────────────────────────────────────────────────────
  await prisma.$executeRawUnsafe(`
    INSERT INTO "${s}".contacts (id, name, email, phone, whatsapp) VALUES
      ('c0000001-0000-0000-0000-000000000001', 'Ana Paula Lima',   'ana.lima@empresa.com.br',     '+55 11 98765-4321', '+55 11 98765-4321'),
      ('c0000001-0000-0000-0000-000000000002', 'João Mendes',      'joao.mendes@outlook.com',     '+55 21 99887-6543', '+55 21 99887-6543'),
      ('c0000001-0000-0000-0000-000000000003', 'Fernanda Costa',   'fernanda@techcorp.io',        '+55 31 97654-3210', '+55 31 97654-3210'),
      ('c0000001-0000-0000-0000-000000000004', 'Roberto Alves',    'roberto.alves@gmail.com',     '+55 11 91234-5678', '+55 11 91234-5678'),
      ('c0000001-0000-0000-0000-000000000005', 'Mariana Santos',   'mariana.s@hotmail.com',       '+55 85 98888-1234', '+55 85 98888-1234'),
      ('c0000001-0000-0000-0000-000000000006', 'Pedro Oliveira',   'pedro.oliveira@empresa.net',  '+55 41 96543-2109', '+55 41 96543-2109'),
      ('c0000001-0000-0000-0000-000000000007', 'Camila Ferreira',  'camila.f@startup.com.br',     '+55 19 97777-8888', '+55 19 97777-8888'),
      ('c0000001-0000-0000-0000-000000000008', 'Lucas Rodrigues',  'lucas.rodrigues@yahoo.com',   '+55 62 98765-0000', '+55 62 98765-0000')
  `);
  console.log('  ✓ Contatos');

  // ── Conversas ─────────────────────────────────────────────────────────────────
  // Shorthand aliases
  const wpp  = 'a0000001-0000-0000-0000-000000000001';
  const mail = 'a0000001-0000-0000-0000-000000000002';
  const chat = 'a0000001-0000-0000-0000-000000000003';

  const conversations = [
    // open — sem agente
    { id: 'd0000001-0000-0000-0000-000000000001', contactId: 'c0000001-0000-0000-0000-000000000001', channelId: wpp,  channelType: 'whatsapp',  status: 'open',       assignedTo: null,    subject: 'Problema com boleto', lastMsg: 'Oi, não consigo gerar o boleto do meu plano.', ago: '2 hours' },
    { id: 'd0000001-0000-0000-0000-000000000002', contactId: 'c0000001-0000-0000-0000-000000000003', channelId: mail, channelType: 'email',     status: 'open',       assignedTo: null,    subject: 'Solicitação de proposta', lastMsg: 'Gostaria de receber uma proposta comercial para minha equipe.', ago: '5 hours' },
    { id: 'd0000001-0000-0000-0000-000000000003', contactId: 'c0000001-0000-0000-0000-000000000005', channelId: chat, channelType: 'live_chat', status: 'open',       assignedTo: null,    subject: null, lastMsg: 'Olá, tenho uma dúvida sobre o plano Enterprise.', ago: '30 minutes' },
    // open — com agente
    { id: 'd0000001-0000-0000-0000-000000000004', contactId: 'c0000001-0000-0000-0000-000000000002', channelId: wpp,  channelType: 'whatsapp',  status: 'open',   assignedTo: ownerId, subject: 'Integração WhatsApp', lastMsg: 'Pode me enviar o QR code de novo, por favor?', ago: '1 hour' },
    { id: 'd0000001-0000-0000-0000-000000000005', contactId: 'c0000001-0000-0000-0000-000000000004', channelId: mail, channelType: 'email',     status: 'open',   assignedTo: agentId, subject: 'Erro ao importar contatos', lastMsg: 'Arquivo CSV em anexo — consegue verificar?', ago: '3 hours' },
    { id: 'd0000001-0000-0000-0000-000000000006', contactId: 'c0000001-0000-0000-0000-000000000007', channelId: chat, channelType: 'live_chat', status: 'open',   assignedTo: agentId, subject: null, lastMsg: 'Vou verificar e já retorno.', ago: '45 minutes' },
    // closed
    { id: 'd0000001-0000-0000-0000-000000000007', contactId: 'c0000001-0000-0000-0000-000000000006', channelId: wpp,  channelType: 'whatsapp',  status: 'closed', assignedTo: ownerId, subject: 'Atualização de cadastro', lastMsg: 'Perfeito, obrigado pelo atendimento!', ago: '1 day' },
    { id: 'd0000001-0000-0000-0000-000000000008', contactId: 'c0000001-0000-0000-0000-000000000008', channelId: mail, channelType: 'email',     status: 'closed', assignedTo: agentId, subject: 'Cancelamento de conta', lastMsg: 'Cancelamento processado com sucesso.', ago: '2 days' },
    { id: 'd0000001-0000-0000-0000-000000000009', contactId: 'c0000001-0000-0000-0000-000000000001', channelId: chat, channelType: 'live_chat', status: 'closed', assignedTo: ownerId, subject: 'Dúvida sobre relatórios', lastMsg: 'Entendido! Muito obrigada.', ago: '3 days' },
  ];

  for (const c of conversations) {
    const assignedSql = c.assignedTo ? `'${c.assignedTo}'` : 'NULL';
    const subjectSql  = c.subject    ? `'${c.subject.replace(/'/g, "''")}'` : 'NULL';
    const resolvedSql = c.status === 'closed' ? `NOW() - INTERVAL '${c.ago}'` : 'NULL';
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${s}".conversations
        (id, contact_id, channel_id, channel_type, conversation_type, status, assigned_to, subject, last_message, last_message_at, resolved_at, created_at)
      VALUES (
        '${c.id}', '${c.contactId}', '${c.channelId}', '${c.channelType}',
        'inbound', '${c.status}', ${assignedSql}, ${subjectSql},
        '${c.lastMsg.replace(/'/g, "''")}',
        NOW() - INTERVAL '${c.ago}',
        ${resolvedSql},
        NOW() - INTERVAL '${c.ago}' - INTERVAL '10 minutes'
      )
    `);
  }
  console.log(`  ✓ ${conversations.length} conversas`);

  // ── Mensagens ─────────────────────────────────────────────────────────────────
  type Msg = { convId: string; senderType: 'client' | 'agent'; senderId: string | null; content: string; minsAgo: number };
  const messages: Msg[] = [
    // Conv 1 — problema boleto (open, sem agente)
    { convId: 'd0000001-0000-0000-0000-000000000001', senderType: 'client', senderId: null,    content: 'Oi, não consigo gerar o boleto do meu plano.', minsAgo: 125 },
    { convId: 'd0000001-0000-0000-0000-000000000001', senderType: 'client', senderId: null,    content: 'Já tentei três vezes e continua dando erro de "timeout".', minsAgo: 123 },

    // Conv 2 — proposta (open, sem agente)
    { convId: 'd0000001-0000-0000-0000-000000000002', senderType: 'client', senderId: null,    content: 'Gostaria de receber uma proposta comercial para minha equipe.', minsAgo: 305 },
    { convId: 'd0000001-0000-0000-0000-000000000002', senderType: 'client', senderId: null,    content: 'Somos 15 pessoas no time de suporte. Qual plano indicam?', minsAgo: 304 },

    // Conv 3 — enterprise (open, sem agente)
    { convId: 'd0000001-0000-0000-0000-000000000003', senderType: 'client', senderId: null,    content: 'Olá, tenho uma dúvida sobre o plano Enterprise.', minsAgo: 32 },

    // Conv 4 — WhatsApp integration (open, owner)
    { convId: 'd0000001-0000-0000-0000-000000000004', senderType: 'client', senderId: null,    content: 'Oi, preciso de ajuda para conectar o WhatsApp.', minsAgo: 75 },
    { convId: 'd0000001-0000-0000-0000-000000000004', senderType: 'agent',  senderId: ownerId, content: 'Olá! Claro, vou te ajudar. Acesse Configurações → Canais → WhatsApp e clique em "Conectar".', minsAgo: 72 },
    { convId: 'd0000001-0000-0000-0000-000000000004', senderType: 'client', senderId: null,    content: 'Fiz isso mas o QR code expirou antes de eu conseguir escanear.', minsAgo: 68 },
    { convId: 'd0000001-0000-0000-0000-000000000004', senderType: 'agent',  senderId: ownerId, content: 'Entendido! O QR expira em 60 segundos. Abra o WhatsApp no celular ANTES de clicar em conectar.', minsAgo: 65 },
    { convId: 'd0000001-0000-0000-0000-000000000004', senderType: 'client', senderId: null,    content: 'Pode me enviar o QR code de novo, por favor?', minsAgo: 60 },

    // Conv 5 — CSV import (open, agent)
    { convId: 'd0000001-0000-0000-0000-000000000005', senderType: 'client', senderId: null,    content: 'Tentei importar 500 contatos via CSV mas o sistema retornou erro na linha 47.', minsAgo: 185 },
    { convId: 'd0000001-0000-0000-0000-000000000005', senderType: 'agent',  senderId: agentId, content: 'Olá Roberto! Pode me enviar o arquivo para eu verificar o formato?', minsAgo: 180 },
    { convId: 'd0000001-0000-0000-0000-000000000005', senderType: 'client', senderId: null,    content: 'Arquivo CSV em anexo — consegue verificar?', minsAgo: 175 },

    // Conv 6 — chat (open, agent)
    { convId: 'd0000001-0000-0000-0000-000000000006', senderType: 'client', senderId: null,    content: 'Boa tarde! Meu relatório de atendimentos não está carregando.', minsAgo: 50 },
    { convId: 'd0000001-0000-0000-0000-000000000006', senderType: 'agent',  senderId: agentId, content: 'Boa tarde, Camila! Vou verificar e já retorno.', minsAgo: 45 },

    // Conv 7 — atualização cadastro (closed)
    { convId: 'd0000001-0000-0000-0000-000000000007', senderType: 'client', senderId: null,    content: 'Preciso atualizar meu e-mail de cadastro.', minsAgo: 1450 },
    { convId: 'd0000001-0000-0000-0000-000000000007', senderType: 'agent',  senderId: ownerId, content: 'Olá Pedro! Me informe o novo e-mail e vou atualizar para você.', minsAgo: 1440 },
    { convId: 'd0000001-0000-0000-0000-000000000007', senderType: 'client', senderId: null,    content: 'O novo e-mail é pedro.novo@empresa.net', minsAgo: 1435 },
    { convId: 'd0000001-0000-0000-0000-000000000007', senderType: 'agent',  senderId: ownerId, content: 'Feito! Seu cadastro foi atualizado com sucesso.', minsAgo: 1430 },
    { convId: 'd0000001-0000-0000-0000-000000000007', senderType: 'client', senderId: null,    content: 'Perfeito, obrigado pelo atendimento!', minsAgo: 1425 },

    // Conv 8 — cancelamento (closed)
    { convId: 'd0000001-0000-0000-0000-000000000008', senderType: 'client', senderId: null,    content: 'Gostaria de cancelar minha conta.', minsAgo: 2900 },
    { convId: 'd0000001-0000-0000-0000-000000000008', senderType: 'agent',  senderId: agentId, content: 'Olá Lucas! Lamentamos que queira cancelar. Pode nos dizer o motivo?', minsAgo: 2880 },
    { convId: 'd0000001-0000-0000-0000-000000000008', senderType: 'client', senderId: null,    content: 'Estamos mudando de plataforma internamente.', minsAgo: 2870 },
    { convId: 'd0000001-0000-0000-0000-000000000008', senderType: 'agent',  senderId: agentId, content: 'Entendido. Processarei o cancelamento. Obrigado por ter sido nosso cliente!', minsAgo: 2860 },
    { convId: 'd0000001-0000-0000-0000-000000000008', senderType: 'client', senderId: null,    content: 'Cancelamento processado com sucesso.', minsAgo: 2855 },

    // Conv 9 — relatórios (closed)
    { convId: 'd0000001-0000-0000-0000-000000000009', senderType: 'client', senderId: null,    content: 'Como exporto o relatório de atendimentos do mês?', minsAgo: 4325 },
    { convId: 'd0000001-0000-0000-0000-000000000009', senderType: 'agent',  senderId: ownerId, content: 'Olá Ana! Vá em Admin → Dashboard → botão "Exportar" no canto superior direito.', minsAgo: 4315 },
    { convId: 'd0000001-0000-0000-0000-000000000009', senderType: 'client', senderId: null,    content: 'Entendido! Muito obrigada.', minsAgo: 4310 },
  ];

  for (const m of messages) {
    const senderIdSql = m.senderId ? `'${m.senderId}'` : 'NULL';
    await prisma.$executeRawUnsafe(`
      INSERT INTO "${s}".messages (conversation_id, sender_type, sender_id, content, content_type, status, is_internal, created_at)
      VALUES (
        '${m.convId}', '${m.senderType}', ${senderIdSql},
        '${m.content.replace(/'/g, "''")}', 'text', 'sent', false,
        NOW() - INTERVAL '${m.minsAgo} minutes'
      )
    `);
  }
  console.log(`  ✓ ${messages.length} mensagens`);
}

async function seedDemoQuickReplies() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: 'demo' } });
  if (!tenant) {
    console.log('  · Tenant demo não encontrado para respostas rápidas, pulando');
    return;
  }

  const s = tenant.schemaName;

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "${s}".quick_replies (
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
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${s}".quick_replies (title, shortcut, content, category)
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

  console.log(`  ✓ ${DEFAULT_QUICK_REPLIES.length} respostas rápidas`);
}

async function main() {
  console.log('\n━━━ ZiraDesk Seed ━━━\n');

  console.log('Planos:');
  await seedPlans();

  console.log('\nSuper Admin:');
  await seedSuperAdmin();

  console.log('\nTenant Demo:');
  await seedDemoTenant();

  console.log('\nConversas Mock:');
  await seedDemoConversations();

  console.log('\nRespostas rápidas:');
  await seedDemoQuickReplies();

  console.log('\n━━━ Seed concluído ━━━\n');
}

main()
  .catch((err) => {
    console.error('\n✗ Seed falhou:', err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
