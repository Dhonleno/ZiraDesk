import { type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useAuthStore } from './stores/auth.store';
import { Login } from './pages/auth/Login';
import { ForgotPassword } from './pages/auth/ForgotPassword';
import { TenantLayout } from './layouts/TenantLayout';
import { SuperAdminLayout } from './layouts/SuperAdminLayout';
import { AuthLayout } from './layouts/AuthLayout';
import { Dashboard } from './pages/super-admin/Dashboard';
import { Tenants } from './pages/super-admin/Tenants';
import { TenantDetail } from './pages/super-admin/TenantDetail';
import { Plans } from './pages/super-admin/Plans';
import { ConversationsPage } from './pages/omnichannel/Conversations';
import { MonitorPage } from './pages/omnichannel/Monitor';
import { MetricsPage } from './pages/omnichannel/Metrics';
import { OrganizationsPage } from './pages/crm/Organizations';
import { ContactsPage } from './pages/crm/Contacts';
import { TicketsPage } from './pages/tickets/Tickets';
import { Dashboard as AdminDashboard } from './pages/admin/Dashboard';
import { Users as AdminUsers } from './pages/admin/Users';
import { Channels as AdminChannels } from './pages/admin/Channels';
import { QuickReplies as AdminQuickReplies } from './pages/admin/QuickReplies';
import { Settings as AdminSettings } from './pages/admin/Settings';
import { BusinessHours as AdminBusinessHours } from './pages/admin/BusinessHours';
import { BotMenu as AdminBotMenu } from './pages/admin/BotMenu';
import { AutoAssign as AdminAutoAssign } from './pages/admin/AutoAssign';
import { PauseReasons as AdminPauseReasons } from './pages/admin/PauseReasons';
import { Skills as AdminSkills } from './pages/admin/Skills';
import { ConversationTags as AdminConversationTags } from './pages/admin/ConversationTags';
import { TicketTypes as AdminTicketTypes } from './pages/admin/TicketTypes';
import { AdminLayout } from './layouts/AdminLayout';
import { Toaster } from './components/ui/Toaster';
import { ErrorBoundary } from './components/ui/ErrorBoundary';
import { Upgrade } from './pages/settings/Upgrade';
import { ProfilePage } from './pages/profile/Profile';
import { NotFound } from './pages/NotFound';

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
          {/* Rotas públicas de autenticação */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
          </Route>

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
                <ErrorBoundary>
                  <TenantLayout />
                </ErrorBoundary>
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/omnichannel/conversations" replace />} />
            <Route path="omnichannel/conversations" element={<ConversationsPage />} />
            <Route path="omnichannel/monitor" element={<MonitorPage />} />
            <Route path="omnichannel/metrics" element={<MetricsPage />} />
            <Route path="crm" element={<Navigate to="/crm/organizations" replace />} />
            <Route path="crm/clients" element={<Navigate to="/crm/contacts" replace />} />
            <Route path="crm/clients/:id" element={<Navigate to="/crm/contacts" replace />} />
            <Route path="crm/organizations" element={<OrganizationsPage />} />
            <Route path="crm/organizations/:id" element={<OrganizationsPage />} />
            <Route path="crm/contacts" element={<ContactsPage />} />
            <Route path="crm/contacts/:id" element={<ContactsPage />} />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="tickets/:id" element={<TicketsPage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<AdminDashboard />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="channels" element={<AdminChannels />} />
              <Route path="business-hours" element={<AdminBusinessHours />} />
              <Route path="bot" element={<AdminBotMenu />} />
              <Route path="auto-assign" element={<AdminAutoAssign />} />
              <Route path="pause-reasons" element={<AdminPauseReasons />} />
              <Route path="skills" element={<AdminSkills />} />
              <Route path="quick-replies" element={<AdminQuickReplies />} />
              <Route path="ticket-types" element={<AdminTicketTypes />} />
              <Route path="conversation-tags" element={<AdminConversationTags />} />
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
