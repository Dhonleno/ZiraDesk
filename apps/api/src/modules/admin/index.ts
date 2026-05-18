import type { FastifyInstance } from 'fastify';
import { settingsRoutes } from './settings/settings.routes.js';
import { usersRoutes } from './users/users.routes.js';
import { channelsRoutes } from './channels/channels.routes.js';
import { quickRepliesRoutes } from './quick-replies/quick-replies.routes.js';
import { statsRoutes } from './stats/stats.routes.js';
import { onboardingRoutes } from './onboarding/onboarding.routes.js';
import { businessHoursRoutes } from './business-hours/business-hours.routes.js';
import { botRoutes } from './bot/bot.routes.js';
import { adminAutoAssignRoutes } from './auto-assign/index.js';
import { adminPauseReasonsRoutes } from './pause-reasons/index.js';
import { adminSkillsRoutes } from './skills/index.js';
import { conversationTagsAdminRoutes } from './conversation-tags/conversation-tags.routes.js';
import { adminTicketTypesRoutes } from './ticket-types/index.js';
import { closeConfigRoutes } from './close-config/close-config.routes.js';
import { aiAdminRoutes } from './ai/ai-admin.routes.js';
import { webhooksRoutes } from './webhooks/webhooks.routes.js';
import { redmineAdminRoutes } from './redmine/redmine.routes.js';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(settingsRoutes, { prefix: '/settings' });
  await app.register(usersRoutes, { prefix: '/users' });
  await app.register(channelsRoutes, { prefix: '/channels' });
  await app.register(businessHoursRoutes, { prefix: '/business-hours' });
  await app.register(botRoutes, { prefix: '/bot' });
  await app.register(adminAutoAssignRoutes);
  await app.register(adminSkillsRoutes);
  await app.register(adminPauseReasonsRoutes);
  await app.register(adminTicketTypesRoutes);
  await app.register(closeConfigRoutes, { prefix: '/close-config' });
  await app.register(conversationTagsAdminRoutes, { prefix: '/conversation-tags' });
  await app.register(quickRepliesRoutes, { prefix: '/quick-replies' });
  await app.register(statsRoutes, { prefix: '/stats' });
  await app.register(onboardingRoutes);
  await app.register(aiAdminRoutes, { prefix: '/ai' });
  await app.register(webhooksRoutes, { prefix: '/webhooks' });
  await app.register(redmineAdminRoutes, { prefix: '/integrations/redmine' });
}
