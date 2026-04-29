import type { FastifyInstance } from 'fastify';
import { settingsRoutes } from './settings/settings.routes.js';
import { usersRoutes } from './users/users.routes.js';
import { channelsRoutes } from './channels/channels.routes.js';
import { quickRepliesRoutes } from './quick-replies/quick-replies.routes.js';
import { statsRoutes } from './stats/stats.routes.js';
import { onboardingRoutes } from './onboarding/onboarding.routes.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(settingsRoutes, { prefix: '/settings' });
  await app.register(usersRoutes, { prefix: '/users' });
  await app.register(channelsRoutes, { prefix: '/channels' });
  await app.register(quickRepliesRoutes, { prefix: '/quick-replies' });
  await app.register(statsRoutes, { prefix: '/stats' });
  await app.register(onboardingRoutes);
}
