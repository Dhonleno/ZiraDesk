export interface Conversation {
  id: string;
  contact_id?: string;
  contact_name?: string;
  contact_phone?: string;
  organization_id?: string;
  organization_name?: string;
  channel_id?: string;
  channel_type: string;
  channel_name?: string;
  external_id?: string;
  protocol_number?: string;
  conversation_type: string;
  status: string;
  assigned_to?: string;
  assigned_name?: string;
  subject?: string;
  last_message?: string;
  last_message_at?: string;
  resolved_at?: string;
  metadata: Record<string, unknown>;
  created_at: string;
}
