export interface NotificationConversationLike {
  status?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function isConversationBotControlled(conversation: NotificationConversationLike | null | undefined): boolean {
  if (!conversation) return false;
  const metadata = conversation.metadata ?? {};
  return metadata['ai_agent_active'] === true
    || metadata['ai_agent_active'] === 'true'
    || metadata['bot_stage'] === 'waiting_choice';
}
