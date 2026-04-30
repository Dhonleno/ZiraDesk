import type { FastifyInstance } from 'fastify';
import { organizationsRoutes } from './organizations/organizations.routes.js';
import { contactsRoutes } from './contacts/contacts.routes.js';

export async function crmRoutes(app: FastifyInstance): Promise<void> {
  await app.register(organizationsRoutes, { prefix: '/organizations' });
  await app.register(contactsRoutes, { prefix: '/contacts' });
}
