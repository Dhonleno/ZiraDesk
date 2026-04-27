export type TenantStatus = 'active' | 'suspended' | 'trial' | 'cancelled';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  schemaName: string;
  planId: string;
  status: TenantStatus;
  trialEndsAt: Date | null;
  settings: Record<string, unknown>;
  createdAt: Date;
}

export interface Plan {
  id: string;
  name: string;
  slug: string;
  priceMonth: number;
  priceYear: number;
  maxUsers: number;
  maxContacts: number;
  features: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
}

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  status: 'active' | 'past_due' | 'cancelled' | 'trialing';
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  paymentGateway: string | null;
  gatewaySubId: string | null;
  createdAt: Date;
}
