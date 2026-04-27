import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
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
    features: { crm: true, tickets: true, omnichannel: false },
    isActive: true,
  },
  {
    name: 'Pro',
    slug: 'pro',
    priceMonth: 197,
    priceYear: 1970,
    maxUsers: 10,
    maxContacts: 5000,
    features: { crm: true, tickets: true, omnichannel: true, whatsapp: true },
    isActive: true,
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    priceMonth: 497,
    priceYear: 4970,
    maxUsers: -1,
    maxContacts: -1,
    features: { crm: true, tickets: true, omnichannel: true, whatsapp: true, instagram: true, api: true },
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

async function main() {
  console.log('\n━━━ ZiraDesk Seed ━━━\n');

  console.log('Planos:');
  await seedPlans();

  console.log('\nSuper Admin:');
  await seedSuperAdmin();

  console.log('\nTenant Demo:');
  await seedDemoTenant();

  console.log('\n━━━ Seed concluído ━━━\n');
}

main()
  .catch((err) => {
    console.error('\n✗ Seed falhou:', err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
