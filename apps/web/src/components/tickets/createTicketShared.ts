import type { CreateTicketPayload, TicketPriority } from '../../services/api';

const STORAGE_KEY = 'zd_ticket_create_preferences_v1';
export type TicketCreateStatus = 'open' | 'in_progress' | 'waiting';
const ALLOWED_STATUSES: TicketCreateStatus[] = ['open', 'in_progress', 'waiting'];

export interface TicketCreatePreferences {
  priority: TicketPriority;
  status: TicketCreateStatus;
  type_id: string;
  assigned_to: string;
}

export interface TicketCreateDraft {
  title: string;
  description?: string | undefined;
  priority: TicketPriority;
  status: TicketCreateStatus;
  category?: string | undefined;
  type_id?: string | undefined;
  assigned_to?: string | null | undefined;
  department_id?: string | null | undefined;
  contact_id?: string | undefined;
  organization_id?: string | undefined;
  conversation_id?: string | undefined;
  source_conversation_id?: string | undefined;
  due_date?: string | undefined;
  tags?: string[] | undefined;
  require_due_date_for_urgent_override?: boolean | undefined;
  require_category_for_waiting_override?: boolean | undefined;
}

export interface TicketCreateValidationResult {
  isValid: boolean;
  errors: string[];
}

export interface TicketConditionalRequirements {
  dueDateRequired: boolean;
  categoryRequired: boolean;
  hints: string[];
}

export interface TicketConditionalRuleConfig {
  requireDueDateForUrgent: boolean;
  requireCategoryForWaiting: boolean;
}

const DEFAULT_PREFS: TicketCreatePreferences = {
  priority: 'medium',
  status: 'open',
  type_id: '',
  assigned_to: '',
};

function resolveConditionalConfig(config?: Partial<TicketConditionalRuleConfig>): TicketConditionalRuleConfig {
  return {
    requireDueDateForUrgent: config?.requireDueDateForUrgent ?? true,
    requireCategoryForWaiting: config?.requireCategoryForWaiting ?? true,
  };
}

export function getTicketConditionalRequirements(
  draft: Pick<TicketCreateDraft, 'priority' | 'status'>,
  config?: Partial<TicketConditionalRuleConfig>,
): TicketConditionalRequirements {
  const resolved = resolveConditionalConfig(config);
  const dueDateRequired = resolved.requireDueDateForUrgent && draft.priority === 'urgent';
  const categoryRequired = resolved.requireCategoryForWaiting && draft.status === 'waiting';
  const hints: string[] = [];

  if (dueDateRequired) {
    hints.push('Tickets urgentes precisam de prazo definido');
  }
  if (categoryRequired) {
    hints.push('Status "Aguardando" exige categoria para contextualizar o motivo');
  }

  return { dueDateRequired, categoryRequired, hints };
}

export function readTicketCreatePreferences(): TicketCreatePreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<TicketCreatePreferences>;
    const status = parsed.status && ALLOWED_STATUSES.includes(parsed.status) ? parsed.status : DEFAULT_PREFS.status;
    const priority = parsed.priority ?? DEFAULT_PREFS.priority;
    return {
      priority,
      status,
      type_id: parsed.type_id ?? '',
      assigned_to: parsed.assigned_to ?? '',
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveTicketCreatePreferences(next: TicketCreatePreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // noop
  }
}

export function validateTicketCreateDraft(draft: TicketCreateDraft): TicketCreateValidationResult {
  const errors: string[] = [];
  const requirements = getTicketConditionalRequirements(draft, {
    requireDueDateForUrgent: draft.require_due_date_for_urgent_override ?? true,
    requireCategoryForWaiting: draft.require_category_for_waiting_override ?? true,
  });
  const title = draft.title.trim();
  if (title.length < 3) {
    errors.push('Título precisa ter no mínimo 3 caracteres');
  }

  if (!draft.contact_id && !draft.organization_id) {
    errors.push('Selecione ao menos um contato ou uma organização');
  }

  if (draft.due_date) {
    const selected = new Date(`${draft.due_date}T00:00:00`);
    if (Number.isNaN(selected.getTime())) {
      errors.push('Prazo inválido');
    } else {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (selected < today) {
        errors.push('Prazo não pode ser anterior à data atual');
      }
    }
  }

  if (requirements.dueDateRequired && !draft.due_date) {
    errors.push('Prazo é obrigatório para tickets urgentes');
  }

  if (requirements.categoryRequired && !draft.category?.trim()) {
    errors.push('Categoria é obrigatória quando o status é "Aguardando"');
  }

  if (!ALLOWED_STATUSES.includes(draft.status)) {
    errors.push('Status inválido para criação');
  }

  return { isValid: errors.length === 0, errors };
}

export function buildCreateTicketPayload(draft: TicketCreateDraft): CreateTicketPayload {
  const payload: CreateTicketPayload = {
    title: draft.title.trim(),
    priority: draft.priority,
    status: draft.status,
  };

  const description = draft.description?.trim();
  if (description) payload.description = description;

  const category = draft.category?.trim();
  if (category) payload.category = category;

  if (draft.type_id) payload.type_id = draft.type_id;
  if (draft.contact_id) payload.contact_id = draft.contact_id;
  if (draft.organization_id) payload.organization_id = draft.organization_id;
  if (draft.conversation_id) payload.conversation_id = draft.conversation_id;
  if (draft.source_conversation_id) payload.source_conversation_id = draft.source_conversation_id;

  const assignedTo = draft.assigned_to ?? '';
  if (assignedTo) payload.assigned_to = assignedTo;

  const departmentId = draft.department_id ?? '';
  if (departmentId) payload.department_id = departmentId;

  if (draft.due_date) payload.due_date = new Date(draft.due_date).toISOString();

  const tags = (draft.tags ?? []).map((item) => item.trim()).filter(Boolean);
  if (tags.length > 0) payload.tags = tags;

  return payload;
}
