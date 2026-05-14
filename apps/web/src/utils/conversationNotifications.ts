export interface NotificationConversationLike {
  status?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function isConversationBotControlled(conversation: NotificationConversationLike | null | undefined): boolean {
  if (!conversation) return false;
  if (conversation.status === 'bot') return true;
  return conversation.metadata?.['ai_agent_active'] === true;
}
