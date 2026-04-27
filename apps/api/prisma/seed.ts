import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Rodando seed...');

  // ── Planos ─────────────────────────────────────────────────────────────────
  const plans = [
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

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { slug: plan.slug },
      update: {},
      create: plan,
    });
    console.log(`  ✅ Plano "${plan.name}" ok`);
  }

  // ── Super Admin ────────────────────────────────────────────────────────────
  const adminEmail = 'admin@ziradesk.com.br';
  const existing = await prisma.superAdmin.findUnique({ where: { email: adminEmail } });

  if (!existing) {
    const passwordHash = await bcrypt.hash('ZiraDesk@2025', 12);
    await prisma.superAdmin.create({
      data: { name: 'Super Admin', email: adminEmail, passwordHash },
    });
    console.log(`  ✅ Super Admin criado: ${adminEmail} / ZiraDesk@2025`);
  } else {
    console.log(`  ℹ️  Super Admin já existe (${adminEmail})`);
  }

  console.log('🎉 Seed concluído!');
}

main()
  .catch((err) => {
    console.error('❌ Seed falhou:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
