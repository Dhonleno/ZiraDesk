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
  'America/Sao_Paulo',
  'America/Manaus',
  'America/Belem',
  'America/Fortaleza',
  'America/Recife',
  'America/Noronha',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Lisbon',
  'Europe/Madrid',
  'UTC',
];

function DayRow({ day, label, isActive, openTime, closeTime, onChange }: DayRowProps) {
  const { t } = useTranslation('admin');

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 16px',
        borderBottom: '1px solid var(--line)',
        gap: 16,
      }}
    >
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          minWidth: 150,
        }}
      >
        <input
          type="checkbox"
          checked={isActive}
          onChange={(event) => onChange(day, { is_active: event.target.checked })}
        />
        <span style={{ fontSize: 13, color: 'var(--txt)', fontWeight: 500 }}>{label}</span>
      </label>

      {isActive ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--txt-2)' }}>
          <input
            type="time"
            value={openTime}
            onChange={(event) => onChange(day, { open_time: event.target.value })}
            style={timeInputStyle}
          />
          <span>{t('tenantAdmin.businessHours.until')}</span>
          <input
            type="time"
            value={closeTime}
            onChange={(event) => onChange(day, { close_time: event.target.value })}
            style={timeInputStyle}
          />
        </div>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--txt-3)', fontStyle: 'italic' }}>
          {t('tenantAdmin.businessHours.closed')}
        </span>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  background: 'var(--bg-3)',
  border: '1px solid var(--line-2)',
  color: 'var(--txt)',
  height: 40,
  borderRadius: 'var(--r)',
  padding: '0 12px',
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
  fontSize: 13,
  padding: '4px 8px',
  width: 90,
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
      settings.away_message ??
        'Olá! No momento estamos fora do horário de atendimento. Retornaremos em breve. 🕐',
    );
  }, [settings]);

  const updateHourMutation = useMutation({
    mutationFn: ({ day, data }: { day: number; data: BusinessHourPatch }) =>
      adminApi.businessHours.update(day, data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'business-hours'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'business-hours-status'] });
      toast.success(t('tenantAdmin.businessHours.saved'));
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
      current.map((hour) =>
        hour.day_of_week === day
          ? { ...hour, ...patch }
          : hour,
      ),
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

  const statusLabel = useMemo(() => {
    if (!status) return null;
    if (status.is_open) {
      return t('tenantAdmin.businessHours.status.closesAt', {
        time: status.closes_at ?? '--:--',
      });
    }
    if (status.next_open_day !== null && status.next_open_time) {
      return t('tenantAdmin.businessHours.status.opensAt', {
        day: t(`tenantAdmin.businessHours.days.${status.next_open_day}`),
        time: status.next_open_time,
      });
    }
    return null;
  }, [status, t]);

  return (
    <div style={{ padding: 24, maxWidth: 820, overflow: 'auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: 'var(--txt)', fontSize: 24, fontWeight: 700, margin: 0 }}>
          {t('tenantAdmin.businessHours.title')}
        </h1>
        <p style={{ color: 'var(--txt-2)', fontSize: 14, margin: '6px 0 0' }}>
          {t('tenantAdmin.businessHours.subtitle')}
        </p>
      </div>

      <div
        style={{
          background: 'var(--bg-2)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-lg)',
          padding: 20,
        }}
      >
        <div style={{ display: 'grid', gap: 18 }}>
          <label style={{ display: 'grid', gap: 8 }}>
            <span style={{ color: 'var(--txt-2)', fontSize: 13, fontWeight: 600 }}>
              {t('tenantAdmin.businessHours.timezone')}
            </span>
            <select value={timezone} onChange={(event) => setTimezone(event.target.value)} style={selectStyle}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>

          <div style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-lg)', overflow: 'hidden' }}>
            {isLoading
              ? Array.from({ length: 7 }).map((_, index) => (
                  <div
                    key={index}
                    style={{
                      height: 46,
                      borderBottom: index === 6 ? 'none' : '1px solid var(--line)',
                      background: 'var(--bg-3)',
                      opacity: 0.45,
                    }}
                  />
                ))
              : orderedHours.map((hour, index) => (
                  <div key={hour.day_of_week} style={{ borderBottom: index === orderedHours.length - 1 ? 'none' : undefined }}>
                    <DayRow
                      day={hour.day_of_week}
                      label={t(`tenantAdmin.businessHours.days.${hour.day_of_week}`)}
                      isActive={hour.is_active}
                      openTime={hour.open_time}
                      closeTime={hour.close_time}
                      onChange={handleDayChange}
                    />
                  </div>
                ))}
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            <div>
              <h2 style={{ color: 'var(--txt)', fontSize: 15, fontWeight: 700, margin: 0 }}>
                {t('tenantAdmin.businessHours.awayMessage')}
              </h2>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginTop: 10,
                  color: 'var(--txt-2)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={awayMessageEnabled}
                  onChange={(event) => setAwayMessageEnabled(event.target.checked)}
                />
                {t('tenantAdmin.businessHours.awayMessageLabel')}
              </label>
            </div>

            <textarea
              value={awayMessage}
              onChange={(event) => setAwayMessage(event.target.value)}
              placeholder={t('tenantAdmin.businessHours.awayMessagePlaceholder')}
              rows={4}
              style={{
                resize: 'vertical',
                minHeight: 104,
                background: 'var(--bg-3)',
                border: '1px solid var(--line-2)',
                borderRadius: 'var(--r)',
                color: 'var(--txt)',
                fontSize: 13,
                lineHeight: 1.5,
                padding: 12,
                outline: 'none',
              }}
            />
          </div>

          {status && (
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                width: 'fit-content',
                padding: '10px 14px',
                borderRadius: 'var(--r)',
                fontSize: 13,
                fontWeight: 600,
                background: status.is_open ? 'var(--green-dim)' : 'var(--red-dim)',
                color: status.is_open ? 'var(--green)' : 'var(--red)',
                border: status.is_open
                  ? '1px solid rgba(62,207,142,.25)'
                  : '1px solid rgba(248,113,113,.25)',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: 'currentColor',
                }}
              />
              {t(`tenantAdmin.businessHours.status.${status.is_open ? 'open' : 'closed'}`)}
              {statusLabel ? ` — ${statusLabel}` : ''}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              type="button"
              onClick={() => settingsMutation.mutate()}
              loading={settingsMutation.isPending}
            >
              {settingsMutation.isPending
                ? t('tenantAdmin.common.saving')
                : t('tenantAdmin.businessHours.save')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
