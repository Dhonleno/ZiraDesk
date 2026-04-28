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
import { ConversationsPage } from './pages/tenant/ConversationsPage';
import { CrmClientsPage } from './pages/crm/Clients';
import { TicketsPage } from './pages/tickets/Tickets';
import { Dashboard as AdminDashboard } from './pages/admin/Dashboard';
import { Users as AdminUsers } from './pages/admin/Users';
import { Channels as AdminChannels } from './pages/admin/Channels';
import { Settings as AdminSettings } from './pages/admin/Settings';
import { Toaster } from './components/ui/Toaster';

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
      <BrowserRouter>
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
                  <SuperAdminLayout />
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
                <TenantLayout />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/conversations" replace />} />
            <Route path="conversations" element={<ConversationsPage />} />
            <Route path="crm/clients" element={<CrmClientsPage />} />
            <Route path="tickets" element={<TicketsPage />} />
            <Route path="tickets/:id" element={<TicketsPage />} />
            <Route path="admin" element={<Navigate to="/admin/dashboard" replace />} />
            <Route path="admin/dashboard" element={<AdminDashboard />} />
            <Route path="admin/users" element={<AdminUsers />} />
            <Route path="admin/channels" element={<AdminChannels />} />
            <Route path="admin/settings" element={<AdminSettings />} />
          </Route>
        </Routes>
      </BrowserRouter>
      <Toaster />
    </QueryClientProvider>
  );
}
