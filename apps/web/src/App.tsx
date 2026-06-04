import { type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './stores/auth.store';
import { Login } from './pages/auth/Login';
import { ForgotPassword } from './pages/auth/ForgotPassword';
import { TenantLayout } from './layouts/TenantLayout';
import { SuperAdminLayout } from './layouts/SuperAdminLayout';
import { AuthLayout } from './layouts/AuthLayout';
import { PortalLayout } from './layouts/PortalLayout';
import { Dashboard } from './pages/super-admin/Dashboard';
import { Tenants } from './pages/super-admin/Tenants';
import { TenantDetail } from './pages/super-admin/TenantDetail';
import { Plans } from './pages/super-admin/Plans';
import { ConversationsPage } from './pages/omnichannel/Conversations';
import { MetricsPage } from './pages/omnichannel/Metrics';
import { HistoryPage } from './pages/omnichannel/History';
import { PerformancePage } from './pages/omnichannel/Performance';
import { QueuePage } from './pages/omnichannel/Queue';
import { OrganizationsPage } from './pages/crm/Organizations';
import { ContactsPage } from './pages/crm/Contacts';
import { TicketsPage } from './pages/tickets/Tickets';
import CreateTicket from './pages/tickets/CreateTicket';
import { TicketDetailPage } from './pages/tickets/TicketDetail';
import { Users as AdminUsers } from './pages/admin/Users';
import { Roles as AdminRoles } from './pages/admin/Roles';
import { Channels as AdminChannels } from './pages/admin/Channels';
import { QuickReplies as AdminQuickReplies } from './pages/admin/QuickReplies';
import { Settings as AdminSettings } from './pages/admin/Settings';
import { AttendanceRules as AdminAttendanceRules } from './pages/admin/AttendanceRules';
import { BusinessHours as AdminBusinessHours } from './pages/admin/BusinessHours';
import { BotMenu as AdminBotMenu } from './pages/admin/BotMenu';
import { AutoAssign as AdminAutoAssign } from './pages/admin/AutoAssign';
import { PauseReasons as AdminPauseReasons } from './pages/admin/PauseReasons';
import { Skills as AdminSkills } from './pages/admin/Skills';
import { ConversationTags as AdminConversationTags } from './pages/admin/ConversationTags';
import { TicketTypes as AdminTicketTypes } from './pages/admin/TicketTypes';
import { CloseConfig as AdminCloseConfig } from './pages/admin/CloseConfig';
import { AIAgentPage as AdminAIAgent } from './pages/admin/AIAgent';
import { Webhooks as AdminWebhooks } from './pages/admin/Webhooks';
import { Integrations as AdminIntegrations } from './pages/admin/Integrations';
import { Templates as AdminTemplates } from './pages/admin/Templates';
import { Lgpd as AdminLgpd } from './pages/admin/Lgpd';
import { QueueConfig as AdminQueueConfig } from './pages/admin/QueueConfig';
import { AdminLayout } from './layouts/AdminLayout';
import { Toaster } from './components/ui/Toaster';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { Upgrade } from './pages/settings/Upgrade';
import { ProfilePage } from './pages/profile/Profile';
import { Privacy as ProfilePrivacy } from './pages/profile/Privacy';
import { NotFound } from './pages/NotFound';
import { PortalGuard } from './components/portal/PortalGuard';
import { PortalLogin } from './pages/portal/PortalLogin';
import { PortalDashboard } from './pages/portal/PortalDashboard';
import { PortalTickets } from './pages/portal/PortalTickets';
import { PortalTicketDetail } from './pages/portal/PortalTicketDetail';
import { PortalCreateTicket } from './pages/portal/PortalCreateTicket';
import { PortalLgpd } from './pages/portal/PortalLgpd';
import { TVDashboard } from './pages/tv/TVDashboard';
import { CampaignsPage } from './pages/omnichannel/Campaigns';
import { CampaignDetail } from './pages/omnichannel/CampaignDetail';
import { ProtectedRoute } from './router/ProtectedRoute';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function RequireAuth({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function RequireSuperAdmin({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'super_admin') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireTenantUser({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'super_admin') return <Navigate to="/super-admin" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <Routes>
          <Route path="/portal" element={<PortalLayout />}>
            <Route index element={<PortalLogin />} />
            <Route path="dashboard" element={<PortalGuard><PortalDashboard /></PortalGuard>} />
            <Route path="tickets" element={<PortalGuard><PortalTickets /></PortalGuard>} />
            <Route path="tickets/:id" element={<PortalGuard><PortalTicketDetail /></PortalGuard>} />
            <Route path="tickets/new" element={<PortalGuard><PortalCreateTicket /></PortalGuard>} />
            <Route path="privacy" element={<PortalGuard><PortalLgpd /></PortalGuard>} />
          </Route>

          {/* Rotas públicas de autenticação */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
          </Route>

          <Route path="/tv" element={<Navigate to="/monitor" replace />} />

          {/* Área do super admin */}
          <Route
            path="/super-admin"
            element={
              <RequireAuth>
                <RequireSuperAdmin>
                  <ErrorBoundary>
                    <SuperAdminLayout />
                  </ErrorBoundary>
                </RequireSuperAdmin>
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="tenants" element={<Tenants />} />
            <Route path="tenants/:id" element={<TenantDetail />} />
            <Route path="plans" element={<Plans />} />
          </Route>

          {/* Área do tenant */}
          <Route
            path="/*"
            element={
              <RequireAuth>
                <RequireTenantUser>
                  <ErrorBoundary>
                    <TenantLayout />
                  </ErrorBoundary>
                </RequireTenantUser>
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/omnichannel/conversations" replace />} />
            <Route path="monitor" element={<TVDashboard />} />
            <Route path="omnichannel" element={<Navigate to="/omnichannel/conversations" replace />} />
            <Route path="omnichannel/conversations" element={<ConversationsPage />} />
            <Route path="omnichannel/queue" element={<QueuePage />} />
            <Route path="omnichannel/campaigns" element={<CampaignsPage />} />
            <Route path="omnichannel/campaigns/:id" element={<CampaignDetail />} />
            <Route path="omnichannel/monitor" element={<Navigate to="/monitor" replace />} />
            <Route
              path="omnichannel/metrics"
              element={(
                <ProtectedRoute permission="metrics:view" redirectTo="/omnichannel/conversations">
                  <MetricsPage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="omnichannel/history"
              element={(
                <ProtectedRoute permission="metrics:view" redirectTo="/omnichannel/conversations">
                  <HistoryPage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="omnichannel/performance"
              element={(
                <ProtectedRoute permission="metrics:view" redirectTo="/omnichannel/conversations">
                  <PerformancePage />
                </ProtectedRoute>
              )}
            />
            <Route path="crm" element={<Navigate to="/crm/organizations" replace />} />
            <Route path="crm/organizations" element={<OrganizationsPage />} />
            <Route path="crm/organizations/:id" element={<OrganizationsPage />} />
            <Route
              path="crm/contacts"
              element={(
                <ProtectedRoute permission="contacts:view">
                  <ContactsPage />
                </ProtectedRoute>
              )}
            />
            <Route
              path="crm/contacts/:id"
              element={(
                <ProtectedRoute permission="contacts:view">
                  <ContactsPage />
                </ProtectedRoute>
              )}
            />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="tickets/new" element={<CreateTicket />} />
            <Route path="tickets/:id" element={<TicketDetailPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="profile/privacy" element={<ProfilePrivacy />} />
            <Route
              path="admin"
              element={(
                <ProtectedRoute permission="settings:manage">
                  <AdminLayout />
                </ProtectedRoute>
              )}
            >
              <Route index element={<Navigate to="users" replace />} />
              <Route path="users" element={<AdminUsers />} />
              <Route
                path="roles"
                element={(
                  <ProtectedRoute permission="users:manage">
                    <AdminRoles />
                  </ProtectedRoute>
                )}
              />
              <Route path="channels" element={<AdminChannels />} />
              <Route path="business-hours" element={<AdminBusinessHours />} />
              <Route
                path="attendance-rules"
                element={(
                  <ProtectedRoute permission="settings:manage">
                    <AdminAttendanceRules />
                  </ProtectedRoute>
                )}
              />
              <Route path="bot" element={<AdminBotMenu />} />
              <Route path="auto-assign" element={<AdminAutoAssign />} />
              <Route path="pause-reasons" element={<AdminPauseReasons />} />
              <Route path="skills" element={<AdminSkills />} />
              <Route path="quick-replies" element={<AdminQuickReplies />} />
              <Route path="templates" element={<AdminTemplates />} />
              <Route path="ticket-types" element={<AdminTicketTypes />} />
              <Route path="conversation-tags" element={<AdminConversationTags />} />
              <Route path="close-config" element={<AdminCloseConfig />} />
              <Route path="ai-agent" element={<AdminAIAgent />} />
              <Route path="integrations" element={<AdminIntegrations />} />
              <Route path="webhooks" element={<AdminWebhooks />} />
              <Route
                path="lgpd"
                element={(
                  <ProtectedRoute permission="lgpd:manage">
                    <AdminLgpd />
                  </ProtectedRoute>
                )}
              />
              <Route path="queue-config" element={<AdminQueueConfig />} />
              <Route path="settings" element={<AdminSettings />} />
            </Route>
            <Route path="settings/upgrade" element={<Upgrade />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}
