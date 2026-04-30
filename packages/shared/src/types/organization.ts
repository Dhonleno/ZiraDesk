export interface Organization {
  id: string;
  type: 'company' | 'person';
  name: string;
  document?: string;
  email?: string;
  phone?: string;
  website?: string;
  status: 'lead' | 'prospect' | 'client' | 'inactive';
  address_street?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  segment?: string;
  lead_source?: string;
  responsible_id?: string;
  responsible?: { id: string; name: string; email: string };
  tags: string[];
  custom_fields: Record<string, unknown>;
  notes?: string;
  contacts_count?: number;
  created_at: string;
  updated_at: string;
}
