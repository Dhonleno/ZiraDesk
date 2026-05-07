import type { FastifyInstance } from 'fastify';
import { omnichannelRoutes as conversationsModule } from './conversations/index.js';
import { omnichannelMediaRoutes as mediaModule } from './media/index.js';
import { omnichannelAvailabilityRoutes } from './availability.routes.js';
import { omnichannelPauseRoutes } from './pause.routes.js';
import { omnichannelMonitorRoutes } from './monitor.routes.js';
import { omnichannelMetricsRoutes } from './metrics/metrics.routes.js';
import { conversationTagsOmnichannelRoutes } from '../admin/conversation-tags/conversation-tags.routes.js';
import { omnichannelCloseConfigRoutes } from './close-config.routes.js';

export async function omnichannelModuleRoutes(app: FastifyInstance): Promise<void> {
  await app.register(omnichannelAvailabilityRoutes);
  await app.register(omnichannelPauseRoutes);
  await app.register(omnichannelMonitorRoutes);
  await app.register(omnichannelCloseConfigRoutes);
  await app.register(omnichannelMetricsRoutes);
  await app.register(conversationsModule);
  await app.register(conversationTagsOmnichannelRoutes, { prefix: '/conversations' });
  await app.register(mediaModule);
}
