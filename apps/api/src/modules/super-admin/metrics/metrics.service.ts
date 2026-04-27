import { prisma } from '../../../config/database.js';

export async function getOverview() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const [total, active, trial, suspended, cancelled, totalPlans, newLast30Days, newLast7Days, plans] =
    await Promise.all([
      prisma.tenant.count(),
      prisma.tenant.count({ where: { status: 'active' } }),
      prisma.tenant.count({ where: { status: 'trial' } }),
      prisma.tenant.count({ where: { status: 'suspended' } }),
      prisma.tenant.count({ where: { status: 'cancelled' } }),
      prisma.plan.count({ where: { isActive: true } }),
      prisma.tenant.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.tenant.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.plan.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    ]);

  const tenantsByPlan = await Promise.all(
    plans.map(async (plan) => ({
      planName: plan.name,
      count: await prisma.tenant.count({ where: { planId: plan.id } }),
    })),
  );

  return {
    totalTenants: total,
    activeTenants: active,
    trialTenants: trial,
    suspendedTenants: suspended,
    cancelledTenants: cancelled,
    totalPlans,
    tenantsByPlan,
    newTenantsLast30Days: newLast30Days,
    newTenantsLast7Days: newLast7Days,
  };
}
