import { prisma } from '../../../config/database.js';
import type { CreatePlanInput, UpdatePlanInput } from './plans.schema.js';

export class NotFoundError extends Error {
  constructor(resource: string) {
    super(`${resource} não encontrado`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export async function listPlans() {
  return prisma.plan.findMany({
    orderBy: { priceMonth: 'asc' },
  });
}

export async function getPlan(id: string) {
  const plan = await prisma.plan.findUnique({ where: { id } });
  if (!plan) throw new NotFoundError('Plano');
  return plan;
}

export async function createPlan(data: CreatePlanInput) {
  const existing = await prisma.plan.findUnique({ where: { slug: data.slug } });
  if (existing) throw new ConflictError('Slug já está em uso');

  return prisma.plan.create({
    data: {
      name: data.name,
      slug: data.slug,
      priceMonth: data.priceMonth,
      priceYear: data.priceYear ?? data.priceMonth * 10,
      maxUsers: data.maxUsers,
      maxContacts: data.maxContacts,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      features: data.features as any,
      isActive: data.isActive,
    },
  });
}

export async function updatePlan(id: string, data: UpdatePlanInput) {
  await getPlan(id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return prisma.plan.update({ where: { id }, data: data as any });
}

// Soft delete — mantém histórico de tenants que usaram o plano
export async function deletePlan(id: string) {
  await getPlan(id);
  return prisma.plan.update({
    where: { id },
    data: { isActive: false },
  });
}
