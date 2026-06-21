import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { profileApi, type MyProfile } from '../../services/api';
import { PageShell } from '../../components/layout/PageShell';
import { useAuthStore } from '../../stores/auth.store';
import { useToast } from '../../stores/toast.store';
import { playNotificationSound, type SoundVariant } from '../../utils/notificationSound';
import './Profile.css';

type ProfileTabKey = 'profile' | 'password' | 'notifications';
type ProfileUpdatePayload = Parameters<typeof profileApi.update>[0];

const PROFILE_TABS: Array<{ key: ProfileTabKey; label: string }> = [
  { key: 'profile', label: 'Perfil' },
  { key: 'password', label: 'Senha' },
  { key: 'notifications', label: 'Notificações' },
];

function normalizeTab(value: string | null): ProfileTabKey {
  if (value === 'password' || value === 'notifications') return value;
  return 'profile';
}

interface FormFieldProps {
  label: string;
  required?: boolean;
  hint?: string;
  fullWidth?: boolean;
  children: React.ReactNode;
}

function FormField({ label, required, hint, fullWidth, children }: FormFieldProps) {
  return (
    <label className={`profile-field ${fullWidth ? 'field-full-width' : ''}`}>
      <span className="profile-field-label">
        {label}
        {required ? <strong>*</strong> : null}
      </span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

interface ProfileTabProps {
  profile: MyProfile;
  isSaving: boolean;
  onSave: (payload: ProfileUpdatePayload) => Promise<void>;
}

function ProfileTab({ profile, isSaving, onSave }: ProfileTabProps) {
  const [form, setForm] = useState({
    name: profile.name ?? '',
    phone: profile.phone ?? '',
    bio: profile.bio ?? '',
    language: (profile.language === 'en-US' || profile.language === 'es' ? profile.language : 'pt-BR') as
      | 'pt-BR'
      | 'en-US'
      | 'es',
  });

  useEffect(() => {
      setForm({
        name: profile.name ?? '',
        phone: profile.phone ?? '',
        bio: profile.bio ?? '',
        language: (profile.language === 'en-US' || profile.language === 'es' ? profile.language : 'pt-BR'),
      });
  }, [profile]);

  return (
    <section className="profile-tab">
      <h2>Informações pessoais</h2>

      <div className="form-grid">
        <FormField label="Nome completo" required>
          <input
            className="profile-input"
            value={form.name}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            placeholder="Seu nome"
            maxLength={100}
          />
        </FormField>

        <FormField label="E-mail" hint="O e-mail não pode ser alterado">
          <input className="profile-input input-disabled" value={profile.email ?? ''} disabled />
        </FormField>

        <FormField label="Telefone">
          <input
            className="profile-input"
            value={form.phone}
            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
            placeholder="+55 11 99999-9999"
            maxLength={30}
          />
        </FormField>

        <FormField label="Idioma preferido">
          <select
            className="profile-input"
            value={form.language}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                language: e.target.value as 'pt-BR' | 'en-US' | 'es',
              }))
            }
          >
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en-US">English (US)</option>
            <option value="es">Español</option>
          </select>
        </FormField>

        <FormField label="Bio" fullWidth>
          <textarea
            className="profile-textarea"
            value={form.bio}
            onChange={(e) => setForm((prev) => ({ ...prev, bio: e.target.value }))}
            placeholder="Conte um pouco sobre você..."
            rows={3}
            maxLength={500}
          />
        </FormField>
      </div>

      <div className="tab-footer">
        <button
          className="profile-btn-primary"
          onClick={() => void onSave(form)}
          disabled={isSaving}
        >
          {isSaving ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </div>
    </section>
  );
}

interface PasswordTabProps {
  isSaving: boolean;
  onSave: (payload: { current_password: string; new_password: string }) => Promise<boolean>;
}

function PasswordTab({ isSaving, onSave }: PasswordTabProps) {
  const toast = useToast();
  const [form, setForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [showPasswords, setShowPasswords] = useState(false);

  const strength = useMemo(() => {
    const password = form.new_password;
    let score = 0;
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^A-Za-z0-9]/.test(password)) score += 1;
    return score;
  }, [form.new_password]);

  const labels = ['', 'Muito fraca', 'Fraca', 'Regular', 'Forte', 'Muito forte'] as const;
  const colors = ['', 'var(--red)', 'var(--red)', 'var(--amber)', 'var(--green)', 'var(--green)'] as const;

  const handleSubmit = async () => {
    if (!form.current_password) {
      toast.error('Informe a senha atual');
      return;
    }

    if (form.new_password !== form.confirm_password) {
      toast.error('As senhas não coincidem');
      return;
    }

    if (form.new_password.length < 8) {
      toast.error('A nova senha deve ter pelo menos 8 caracteres');
      return;
    }

    const ok = await onSave({
      current_password: form.current_password,
      new_password: form.new_password,
    });

    if (ok) {
      setForm({
        current_password: '',
        new_password: '',
        confirm_password: '',
      });
      setShowPasswords(false);
    }
  };

  return (
    <section className="profile-tab">
      <h2>Alterar senha</h2>

      <div className="form-grid">
        <FormField label="Senha atual" fullWidth>
          <input
            className="profile-input"
            type={showPasswords ? 'text' : 'password'}
            value={form.current_password}
            onChange={(e) => setForm((prev) => ({ ...prev, current_password: e.target.value }))}
            placeholder="••••••••"
          />
        </FormField>

        <FormField label="Nova senha">
          <input
            className="profile-input"
            type={showPasswords ? 'text' : 'password'}
            value={form.new_password}
            onChange={(e) => setForm((prev) => ({ ...prev, new_password: e.target.value }))}
            placeholder="Mínimo 8 caracteres"
          />
        </FormField>

        <FormField label="Confirmar nova senha">
          <input
            className="profile-input"
            type={showPasswords ? 'text' : 'password'}
            value={form.confirm_password}
            onChange={(e) => setForm((prev) => ({ ...prev, confirm_password: e.target.value }))}
            placeholder="Repita a nova senha"
          />
        </FormField>
      </div>

      {form.new_password ? (
        <div className="password-strength">
          <div className="strength-bars">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="strength-bar"
                style={{ background: i <= strength ? colors[strength] : 'var(--bg-4)' }}
              />
            ))}
          </div>
          <span style={{ color: colors[strength], fontSize: 12 }}>{labels[strength]}</span>
        </div>
      ) : null}

      <label className="show-password-toggle">
        <input
          type="checkbox"
          checked={showPasswords}
          onChange={(e) => setShowPasswords(e.target.checked)}
        />
        Mostrar senhas
      </label>

      <div className="tab-footer">
        <button className="profile-btn-primary" onClick={() => void handleSubmit()} disabled={isSaving}>
          {isSaving ? 'Salvando...' : 'Alterar senha'}
        </button>
      </div>
    </section>
  );
}

interface NotificationsTabProps {
  profile: MyProfile;
  isSaving: boolean;
  onSave: (payload: ProfileUpdatePayload) => Promise<void>;
}

function NotificationsTab({ profile, isSaving, onSave }: NotificationsTabProps) {
  const [form, setForm] = useState({
    notification_sound: profile.notification_sound ?? true,
    notification_desktop: profile.notification_desktop ?? true,
    notification_sound_variant: (profile.notification_sound_variant ?? 'default') as SoundVariant,
  });

  useEffect(() => {
    setForm({
      notification_sound: profile.notification_sound ?? true,
      notification_desktop: profile.notification_desktop ?? true,
      notification_sound_variant: (profile.notification_sound_variant ?? 'default') as SoundVariant,
    });
  }, [profile]);

  const handleDesktopToggle = (nextValue: boolean) => {
    if (!nextValue) {
      setForm((prev) => ({ ...prev, notification_desktop: false }));
      return;
    }

    if (!('Notification' in window)) {
      setForm((prev) => ({ ...prev, notification_desktop: false }));
      return;
    }

    if (Notification.permission === 'granted') {
      setForm((prev) => ({ ...prev, notification_desktop: true }));
      return;
    }

    void Notification.requestPermission().then((permission) => {
      setForm((prev) => ({ ...prev, notification_desktop: permission === 'granted' }));
    });
  };

  return (
    <section className="profile-tab">
      <h2>Preferências de notificação</h2>

      <div className="notification-settings">
        <div className="toggle-row">
          <div className="toggle-copy">
            <strong>Som de notificação</strong>
            <span>Reproduzir som ao receber nova mensagem ou atendimento</span>
          </div>
          <input
            type="checkbox"
            checked={form.notification_sound}
            onChange={(e) => setForm((prev) => ({ ...prev, notification_sound: e.target.checked }))}
          />
        </div>

        <div className="toggle-row">
          <div className="toggle-copy">
            <strong>Variante de som</strong>
            <span>Estilo do som de notificação</span>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <select
              value={form.notification_sound_variant}
              disabled={!form.notification_sound}
              onChange={(e) => setForm((prev) => ({ ...prev, notification_sound_variant: e.target.value as SoundVariant }))}
            >
              <option value="default">Padrão</option>
              <option value="soft">Suave</option>
              <option value="sharp">Agudo</option>
            </select>
            <button
              type="button"
              onClick={() => playNotificationSound('assignment', form.notification_sound_variant)}
              disabled={!form.notification_sound}
            >
              Testar
            </button>
          </div>
        </div>

        <div className="toggle-row">
          <div className="toggle-copy">
            <strong>Notificações do desktop</strong>
            <span>Mostrar notificações do sistema operacional</span>
          </div>
          <input
            type="checkbox"
            checked={form.notification_desktop}
            onChange={(e) => handleDesktopToggle(e.target.checked)}
          />
        </div>
      </div>

      <div className="tab-footer">
        <button
          className="profile-btn-primary"
          onClick={() => void onSave(form)}
          disabled={isSaving}
        >
          {isSaving ? 'Salvando...' : 'Salvar preferências'}
        </button>
      </div>
    </section>
  );
}

export function ProfilePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = normalizeTab(searchParams.get('tab'));
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user, setUser } = useAuthStore();

  const { data: profile, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-profile'],
    queryFn: profileApi.get,
  });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'ZiraDesk — Meu perfil';
    return () => {
      document.title = previousTitle;
    };
  }, []);

  const profileMutation = useMutation({
    mutationFn: (payload: Parameters<typeof profileApi.update>[0]) => profileApi.update(payload),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      setUser({
        name: updated.name,
        avatar_url: updated.avatar_url,
      });
      toast.success('Perfil atualizado!');
    },
    onError: () => {
      toast.error('Erro ao salvar perfil');
    },
  });

  const passwordMutation = useMutation({
    mutationFn: (payload: { current_password: string; new_password: string }) => profileApi.updatePassword(payload),
    onSuccess: () => {
      toast.success('Senha alterada com sucesso!');
    },
    onError: (err: { response?: { data?: { error?: { message?: string } } } }) => {
      toast.error(err.response?.data?.error?.message ?? 'Erro ao alterar senha');
    },
  });

  const avatarMutation = useMutation({
    mutationFn: (file: File) => profileApi.uploadAvatar(file),
    onSuccess: ({ avatar_url }) => {
      void queryClient.invalidateQueries({ queryKey: ['my-profile'] });
      setUser({ avatar_url });
      toast.success('Foto atualizada!');
    },
    onError: () => {
      toast.error('Erro ao fazer upload da foto');
    },
  });

  const currentName = profile?.name ?? user?.name ?? 'Usuário';
  const currentEmail = profile?.email ?? user?.email ?? '—';
  const currentRole = profile?.role ?? user?.role ?? '—';
  const currentAvatar = profile?.avatar_url ?? user?.avatar_url ?? null;
  const currentInitial = currentName.charAt(0).toUpperCase();

  const handleAvatarUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 2MB');
      event.target.value = '';
      return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Formato inválido. Use JPG, PNG ou WEBP');
      event.target.value = '';
      return;
    }

    avatarMutation.mutate(file);
    event.target.value = '';
  };

  if (isLoading) {
    return (
      <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
        <div className="profile-page">
          <div className="profile-content profile-state-wrap">
            <span className="profile-state-text">Carregando perfil...</span>
          </div>
        </div>
      </PageShell>
    );
  }

  if (isError || !profile) {
    return (
      <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
        <div className="profile-page">
          <div className="profile-content">
            <div className="zd-empty-state" style={{ minHeight: 240 }}>
              <div className="zd-empty-icon" aria-hidden>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M10 6.5v4.2M10 14h.01M3.5 15.5h13L10 3.5l-6.5 12z"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
              <strong>Não foi possível carregar seu perfil</strong>
              <span>Tente novamente para continuar editando suas informações.</span>
              <button className="tb-btn" onClick={() => void refetch()}>
                Tentar novamente
              </button>
            </div>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell padding={0} contentStyle={{ overflow: 'hidden' }}>
      <div className="profile-page">
        <div className="profile-header">
          <h1>Meu perfil</h1>
          <p>Gerencie suas informações pessoais e preferências</p>
        </div>

        <div className="profile-layout">
          <aside className="profile-sidebar">
            <div className="avatar-section">
              <div className="avatar-wrapper">
                {currentAvatar ? (
                  <img src={currentAvatar} alt={currentName} className="profile-avatar-img" />
                ) : (
                  <div className="profile-avatar-placeholder">{currentInitial}</div>
                )}

                <button
                  className="avatar-edit-btn"
                  onClick={() => fileInputRef.current?.click()}
                  title="Alterar foto"
                  aria-label="Alterar foto de perfil"
                  disabled={avatarMutation.isPending}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                    <path
                      d="M9.5 2L12 4.5 5 11.5H2.5V9L9.5 2z"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleAvatarUpload}
                  style={{ display: 'none' }}
                />
              </div>

              <div className="profile-user-info">
                <span className="profile-user-name">{currentName}</span>
                <span className="profile-user-role">{currentRole}</span>
                <span className="profile-user-email">{currentEmail}</span>
              </div>
            </div>

            <nav className="profile-nav">
              {PROFILE_TABS.map((tab) => (
                <button
                  type="button"
                  key={tab.key}
                  className={`profile-nav-item ${activeTab === tab.key ? 'active' : ''}`}
                  onClick={() => setSearchParams({ tab: tab.key })}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </aside>

          <div className="profile-content">
            {activeTab === 'profile' ? (
              <ProfileTab
                profile={profile}
                isSaving={profileMutation.isPending}
                onSave={async (payload) => {
                  await profileMutation.mutateAsync(payload);
                }}
              />
            ) : null}

            {activeTab === 'password' ? (
              <PasswordTab
                isSaving={passwordMutation.isPending}
                onSave={async (payload) => {
                  try {
                    await passwordMutation.mutateAsync(payload);
                    return true;
                  } catch {
                    return false;
                  }
                }}
              />
            ) : null}

            {activeTab === 'notifications' ? (
              <NotificationsTab
                profile={profile}
                isSaving={profileMutation.isPending}
                onSave={async (payload) => {
                  await profileMutation.mutateAsync(payload);
                }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
