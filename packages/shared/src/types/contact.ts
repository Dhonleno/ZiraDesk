export interface Contact {
  id: string;
  organization_id?: string;
  organization?: { id: string; name: string; status: string };
  name: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  document?: string;
  role?: string;
  department?: string;
  is_primary: boolean;
  avatar_url?: string;
  tags: string[];
  custom_fields: Record<string, unknown>;
  notes?: string;
  created_at: string;
  updated_at: string;
}
