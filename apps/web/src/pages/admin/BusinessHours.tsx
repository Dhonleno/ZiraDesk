import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminApi, type BusinessHour } from '../../services/api';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../stores/toast.store';

type BusinessHourPatch = Partial<Pick<BusinessHour, 'is_active' | 'open_time' | 'close_time'>>;

interface DayRowProps {
  day: number;
  label: string;
  isActive: boolean;
  openTime: string;
  closeTime: string;
  onChange: (day: number, data: BusinessHourPatch) => void;
}

const TIMEZONES = [
  { value: 'America/Sao_Paulo', label: 'America/São_Paulo (GMT-3)' },
  { value: 'America/Manaus', label: 'America/Manaus (GMT-4)' },
  { value: 'America/Belem', label: 'America/Belém (GMT-3)' },
  { value: 'America/Fortaleza', label: 'America/Fortaleza (GMT-3)' },
  { value: 'America/Recife', label: 'America/Recife (GMT-3)' },
  { value: 'America/Noronha', label: 'America/Noronha (GMT-2)' },
  { value: 'UTC', label: 'UTC' },
];

function DayRow({ day, label, isActive, openTime, closeTime, onChange }: DayRowProps) {
  const { t } = useTranslation('admin');
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(130px, 1fr) auto',
        alignItems: 'center',
        gap: 12,
        padding: '10px 0',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--txt)', fontSize: 13 }}>
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => onChange(day, { is_active: event.target.checked })}
        />
        <span>{label}</span>
      </label>

      {isActive ? (
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--txt-2)', fontSize: 12 }}>
          <input type="time" value={openTime} onChange={(event) => onChange(day, { open_time: event.target.value })} style={timeInputStyle} />
          <span>{t('tenantAdmin.businessHours.until')}</span>
          <input type="time" value={closeTime} onChange={(event) => onChange(day, { close_time: event.target.value })} style={timeInputStyle} />
        </div>
      ) : (
        <span style={{ color: 'var(--txt-3)', fontSize: 12 }}>{t('tenantAdmin.businessHours.closed')}</span>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-3)',
  border: '1px solid var(--line-2)',
  color: 'var(--txt)',
  height: 36,
  borderRadius: 'var(--r)',
  padding: '0 10px',
  fontSize: 13,
  width: '100%',
  outline: 'none',
};

const timeInputStyle: React.CSSProperties = {
  background: 'var(--bg-3)',
  border: '1px solid var(--line-2)',
  borderRadius: 'var(--r)',
  color: 'var(--txt)',
  fontFamily: 'var(--mono)',
  fontSize: 12,
  padding: '2px 6px',
  width: 88,
  outline: 'none',
};

export function BusinessHours() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();
  const [hours, setHours] = useState<BusinessHour[]>([]);
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [awayMessageEnabled, setAwayMessageEnabled] = useState(true);
  const [awayMessage, setAwayMessage] = useState(
    'Olá! No momento estamos fora do horário de atendimento. Retornaremos em breve. 🕐',
  );
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const pendingByDay = useRef<Record<number, BusinessHourPatch>>({});

  const { data: businessHours, isLoading } = useQuery({
    queryKey: ['admin', 'business-hours'],
    queryFn: adminApi.businessHours.list,
  });
  const { data: settings } = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: adminApi.getSettings,
  });
  const { data: status } = useQuery({
    queryKey: ['admin', 'business-hours-status'],
    queryFn: adminApi.businessHours.getStatus,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (businessHours) setHours(businessHours);
  }, [businessHours]);

  useEffect(() => {
    if (!settings) return;
    setTimezone(settings.timezone ?? 'America/Sao_Paulo');
    setAwayMessageEnabled(settings.away_message_enabled ?? true);
    setAwayMessage(
      settings.away_message
      ?? 'Olá! No momento estamos fora do horário de atendimento. Retornaremos em breve. 🕐',
    );
  }, [settings]);

  const updateHourMutation = useMutation({
    mutationFn: ({ day, data }: { day: number; data: BusinessHourPatch }) =>
      adminApi.businessHours.update(day, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'business-hours'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'business-hours-status'] });
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const settingsMutation = useMutation({
    mutationFn: () =>
      adminApi.businessHours.updateSettings({
        timezone,
        away_message: awayMessage,
        away_message_enabled: awayMessageEnabled,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'business-hours-status'] });
      toast.success(t('tenantAdmin.businessHours.saved'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const handleDayChange = (day: number, patch: BusinessHourPatch) => {
    setHours((current) =>
      current.map((hour) => (hour.day_of_week === day ? { ...hour, ...patch } : hour)),
    );

    pendingByDay.current[day] = { ...pendingByDay.current[day], ...patch };
    clearTimeout(timers.current[day]);
    timers.current[day] = setTimeout(() => {
      const data = pendingByDay.current[day];
      delete pendingByDay.current[day];
      if (data) updateHourMutation.mutate({ day, data });
    }, 500);
  };

  const orderedHours = useMemo(
    () => [...hours].sort((a, b) => a.day_of_week - b.day_of_week),
    [hours],
  );

  const statusText = useMemo(() => {
    if (!status) return '';
    if (status.is_open) {
      return `${t('tenantAdmin.businessHours.status.open')} - ${t('tenantAdmin.businessHours.status.closesAt', { time: status.closes_at ?? '--:--' })}`;
    }
    if (status.next_open_day !== null && status.next_open_time) {
      return `${t('tenantAdmin.businessHours.status.closed')} - ${t('tenantAdmin.businessHours.status.opensAt', {
        day: t(`tenantAdmin.businessHours.days.${status.next_open_day}`),
        time: status.next_open_time,
      })}`;
    }
    return t('tenantAdmin.businessHours.status.closed');
  }, [status, t]);

  return (
    <div className="admin-page bh-page">
      <div className="bh-header">
        <div>
          <h1>{t('tenantAdmin.businessHours.title')}</h1>
          <p>{t('tenantAdmin.businessHours.subtitle')}</p>
        </div>
        {status ? (
          <div className={`status-badge-pill ${status.is_open ? 'open' : 'closed'}`}>
            <span className="status-dot-mini" />
            {statusText}
          </div>
        ) : null}
      </div>

      <div className="bh-grid">
        <section className="bh-card">
          <div className="bh-card-header">
            <h3>Dias e horários</h3>
            <div style={{ minWidth: 250 }}>
              <select value={timezone} onChange={(event) => setTimezone(event.target.value)} style={selectStyle}>
                {TIMEZONES.map((tz) => (
                  <option key={tz.value} value={tz.value}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isLoading ? (
            <div style={{ display: 'grid', gap: 6 }}>
              {Array.from({ length: 7 }).map((_, index) => (
                <div key={index} style={{ height: 34, borderRadius: 'var(--r)', background: 'var(--bg-3)', opacity: 0.5 }} />
              ))}
            </div>
          ) : (
            <div>
              {orderedHours.map((hour) => (
                <DayRow
                  key={hour.day_of_week}
                  day={hour.day_of_week}
                  label={t(`tenantAdmin.businessHours.days.${hour.day_of_week}`)}
                  isActive={hour.is_active}
                  openTime={hour.open_time}
                  closeTime={hour.close_time}
                  onChange={handleDayChange}
                />
              ))}
            </div>
          )}
        </section>

        <section className="bh-card">
          <h3 style={{ margin: 0, color: 'var(--txt)' }}>Mensagem de ausência</h3>
          <p style={{ margin: '6px 0 0', color: 'var(--txt-3)', fontSize: 12 }}>
            Enviada automaticamente quando o cliente contata fora do horário de atendimento.
          </p>

          <div className="settings-toggle-row" style={{ marginTop: 8 }}>
            <div className="settings-toggle-label">Enviar mensagem automática</div>
            <input
              type="checkbox"
              checked={awayMessageEnabled}
              onChange={(event) => setAwayMessageEnabled(event.target.checked)}
              style={{ width: 18, height: 18, cursor: 'pointer', accentColor: 'var(--teal)' }}
            />
          </div>

          {awayMessageEnabled ? (
            <div className="settings-field">
              <label>Mensagem</label>
              <textarea
                className="settings-textarea"
                rows={6}
                value={awayMessage}
                onChange={(event) => setAwayMessage(event.target.value)}
                placeholder={t('tenantAdmin.businessHours.awayMessagePlaceholder')}
              />
              <span className="field-hint">
                O sistema adiciona automaticamente o próximo horário de abertura.
              </span>
            </div>
          ) : null}

          <div className="message-preview">
            <div className="preview-label">Pré-visualização</div>
            <div className="whatsapp-bubble">
              {(awayMessage || 'Olá! No momento estamos fora do horário de atendimento.').trim()}
              {'\n\n'}⏰ Retornaremos segunda-feira às 08:00.
              {'\n\n'}Este atendimento será encerrado. Até logo! 👋
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
            <Button type="button" onClick={() => settingsMutation.mutate()} disabled={settingsMutation.isPending}>
              {settingsMutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.businessHours.save')}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}

