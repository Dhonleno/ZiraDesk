export interface Ticket {
  id: string;
  contact_id?: string;
  contact_name?: string;
  organization_id?: string;
  organization_name?: string;
  conversation_id?: string;
  type_id?: string;
  type_name?: string;
  type_icon?: string;
  type_color?: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  category?: string;
  assigned_to?: string;
  assigned_name?: string;
  resolved_at?: string;
  due_date?: string;
  tags: string[];
  custom_fields: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
