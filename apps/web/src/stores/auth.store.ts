import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
  mustChangePassword: boolean;
  tenantId?: string;
  avatar_url?: string | null;
  language?: string;
}

type AuthPayloadUser = Omit<AuthUser, 'mustChangePassword'> & { mustChangePassword?: boolean };

interface AuthState {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  hasLoadedProfile: boolean;
}

interface AuthActions {
  setAuth: (payload: { user?: AuthPayloadUser; token: string }) => void;
  setUser: (userData: Partial<AuthUser>) => void;
  logout: () => void;
}

type AuthStore = AuthState & AuthActions;

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      hasLoadedProfile: false,

      setAuth: ({ user, token }) =>
        set((state) => ({
          user: user
            ? { ...user, mustChangePassword: user.mustChangePassword ?? false }
            : state.user,
          token,
          isAuthenticated: true,
          hasLoadedProfile: user ? false : state.hasLoadedProfile,
        })),

      setUser: (userData) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...userData } : null,
          hasLoadedProfile: state.hasLoadedProfile || Object.prototype.hasOwnProperty.call(userData, 'mustChangePassword'),
        })),

      logout: () =>
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          hasLoadedProfile: false,
        }),
    }),
    {
      name: 'ziradesk-auth',
      storage: createJSONStorage(() => sessionStorage),
      // Não persiste o token em localStorage por segurança; sessionStorage é limpa ao fechar a aba
      partialize: (state) => ({
        user: state.user,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
        hasLoadedProfile: state.hasLoadedProfile,
      }),
    },
  ),
);
