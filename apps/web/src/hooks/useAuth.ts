import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuthStore } from '../stores/auth.store';
import type { LoginInput } from '@ziradesk/shared';
import { disconnectSocket } from '../services/socket';
import { requestBrowserNotificationPermission } from './useNotification';

interface LoginResponseData {
  accessToken: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: string;
    mustChangePassword?: boolean;
    tenantId?: string;
    avatar_url?: string | null;
  };
}

export function useAuth() {
  const { user, token, isAuthenticated, setAuth, setUser, logout } = useAuthStore();
  const navigate = useNavigate();

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginInput) => {
      const { data } = await api.post<LoginResponseData>('/auth/login', credentials);
      return data;
    },
    onSuccess: (data) => {
      setAuth({
        user: {
          ...data.user,
          mustChangePassword: data.user.mustChangePassword ?? false,
        },
        token: data.accessToken,
      });
      void requestBrowserNotificationPermission();
      navigate(data.user.role === 'super_admin' ? '/super-admin' : '/');
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      disconnectSocket();
      await api.post('/auth/logout');
    },
    onSettled: () => {
      logout();
      navigate('/login');
    },
  });

  return {
    user,
    token,
    isAuthenticated,
    setUser,
    login: loginMutation.mutate,
    loginAsync: loginMutation.mutateAsync,
    isLoggingIn: loginMutation.isPending,
    loginError: loginMutation.error,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}
