import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  adminApi,
  type BusinessHourDay,
  type BusinessHoursHoliday,
  type UpdateBusinessHoursPayload,
} from '../../services/api';
import { PageShell } from '../../components/layout/PageShell';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../stores/toast.store';

interface HolidayDraft {
  date: string;
  name: string;
  behavior: 'closed' | 'custom_hours';
  openTime: string;
  closeTime: string;
}

interface ShiftRowProps {
  day: BusinessHourDay;
  label: string;
  onToggleActive: (dayOfWeek: number, value: boolean) => void;
  onChangeShift: (dayOfWeek: number, shiftIndex: number, field: 'openTime' | 'closeTime', value: string) => void;
  onAddShift: (dayOfWeek: number) => void;
  onRemoveShift: (dayOfWeek: number, shiftIndex: number) => void;
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

function buildDefaultDays(): BusinessHourDay[] {
  return Array.from({ length: 7 }, (_, dayOfWeek) => ({
    id: `day-${dayOfWeek}`,
    dayOfWeek,
    isActive: true,
    shifts: [{ id: `shift-${dayOfWeek}-0`, openTime: '08:00', closeTime: '18:00' }],
  }));
}

function normalizeDays(days?: BusinessHourDay[]): BusinessHourDay[] {
  const fallback = buildDefaultDays();
  if (!days?.length) return fallback;

  const byDay = new Map(days.map((day) => [day.dayOfWeek, day]));
  return fallback.map((defaultDay) => {
    const current = byDay.get(defaultDay.dayOfWeek);
    if (!current) return defaultDay;
    return {
      ...current,
      shifts: current.shifts.length ? current.shifts : defaultDay.shifts,
    };
  });
}

function ShiftRow({
  day,
  label,
  onToggleActive,
  onChangeShift,
  onAddShift,
  onRemoveShift,
}: ShiftRowProps) {
  const { t } = useTranslation('admin');

  return (
    <div style={{ borderBottom: '1px solid var(--line)', padding: '12px 16px', display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={day.isActive}
            onChange={(event) => onToggleActive(day.dayOfWeek, event.target.checked)}
          />
          <span style={{ color: 'var(--txt)', fontSize: 13, fontWeight: 500 }}>{label}</span>
        </label>

        <Button
          type="button"
          variant="ghost"
          onClick={() => onAddShift(day.dayOfWeek)}
          disabled={!day.isActive}
        >
          Adicionar turno
        </Button>
      </div>

      {!day.isActive ? (
        <span style={{ fontSize: 12, color: 'var(--txt-3)', fontStyle: 'italic' }}>
          {t('tenantAdmin.businessHours.closed')}
        </span>
      ) : (
        <div style={{ display: 'grid', gap: 8 }}>
          {day.shifts.map((shift, shiftIndex) => (
            <div key={shift.id || `${day.dayOfWeek}-${shiftIndex}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="time"
                value={shift.openTime}
                onChange={(event) => onChangeShift(day.dayOfWeek, shiftIndex, 'openTime', event.target.value)}
                style={timeInputStyle}
              />
              <span style={{ color: 'var(--txt-2)', fontSize: 12 }}>{t('tenantAdmin.businessHours.until')}</span>
              <input
                type="time"
                value={shift.closeTime}
                onChange={(event) => onChangeShift(day.dayOfWeek, shiftIndex, 'closeTime', event.target.value)}
                style={timeInputStyle}
              />
              <Button
                type="button"
                variant="ghost"
                onClick={() => onRemoveShift(day.dayOfWeek, shiftIndex)}
                disabled={day.shifts.length <= 1}
              >
                Remover
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HolidayRow({
  holiday,
  onRemove,
}: {
  holiday: BusinessHoursHoliday;
  onRemove: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        border: '1px solid var(--line)',
        borderRadius: 'var(--r)',
        padding: '10px 12px',
      }}
    >
      <div style={{ display: 'grid', gap: 2 }}>
        <div style={{ color: 'var(--txt)', fontSize: 13, fontWeight: 600 }}>
          {holiday.date} · {holiday.name}
        </div>
        <div style={{ color: 'var(--txt-2)', fontSize: 12 }}>
          {holiday.behavior === 'closed'
            ? 'Fechado'
            : `Horário especial: ${holiday.openTime ?? '--:--'} às ${holiday.closeTime ?? '--:--'}`}
          {holiday.isNational ? ` · Nacional (${holiday.country ?? '--'})` : ' · Personalizado'}
        </div>
      </div>
      {!holiday.isNational && (
        <Button type="button" variant="ghost" onClick={() => onRemove(holiday.id)}>
          Remover
        </Button>
      )}
    </div>
  );
}

export function BusinessHours() {
  const { t } = useTranslation('admin');
  const toast = useToast();
  const queryClient = useQueryClient();

  const [days, setDays] = useState<BusinessHourDay[]>(buildDefaultDays());
  const [is24x7, setIs24x7] = useState(false);
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [awayMessageEnabled, setAwayMessageEnabled] = useState(true);
  const [awayMessage, setAwayMessage] = useState(
    'Olá, no momento estamos fora do horário de atendimento. Retornaremos em breve.',
  );
  const [holidayDraft, setHolidayDraft] = useState<HolidayDraft>({
    date: '',
    name: '',
    behavior: 'closed',
    openTime: '08:00',
    closeTime: '18:00',
  });

  const { data: businessHoursData, isLoading } = useQuery({
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
    if (!businessHoursData) return;
    setIs24x7(businessHoursData.config.is24x7);
    setDays(normalizeDays(businessHoursData.days));
  }, [businessHoursData]);

  useEffect(() => {
    if (!settings) return;
    setTimezone(settings.timezone ?? 'America/Sao_Paulo');
    setAwayMessageEnabled(settings.away_message_enabled ?? true);
    setAwayMessage(
      settings.away_message ??
        'Olá, no momento estamos fora do horário de atendimento. Retornaremos em breve.',
    );
  }, [settings]);

  const saveScheduleMutation = useMutation({
    mutationFn: (payload: UpdateBusinessHoursPayload) => adminApi.businessHours.update(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'business-hours'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'business-hours-status'] });
      toast.success(t('tenantAdmin.businessHours.saved'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const saveSettingsMutation = useMutation({
    mutationFn: () =>
      adminApi.businessHours.updateSettings({
        timezone,
        away_message: awayMessage,
        away_message_enabled: awayMessageEnabled,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] });
      toast.success(t('tenantAdmin.businessHours.saved'));
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const importHolidaysMutation = useMutation({
    mutationFn: (country: 'BR' | 'US' | 'PT' | 'AR') => adminApi.businessHours.importNationalHolidays(country),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'business-hours'] });
      toast.success(`Feriados importados: ${data.imported}`);
    },
    onError: () => toast.error(t('tenantAdmin.common.errorSave')),
  });

  const onToggleActive = (dayOfWeek: number, value: boolean) => {
    setDays((current) => current.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, isActive: value } : day)));
  };

  const onAddShift = (dayOfWeek: number) => {
    setDays((current) =>
      current.map((day) =>
        day.dayOfWeek === dayOfWeek
          ? {
              ...day,
              shifts: [...day.shifts, { id: crypto.randomUUID(), openTime: '08:00', closeTime: '18:00' }],
            }
          : day,
      ),
    );
  };

  const onRemoveShift = (dayOfWeek: number, shiftIndex: number) => {
    setDays((current) =>
      current.map((day) => {
        if (day.dayOfWeek !== dayOfWeek) return day;
        if (day.shifts.length <= 1) return day;
        return { ...day, shifts: day.shifts.filter((_, index) => index !== shiftIndex) };
      }),
    );
  };

  const onChangeShift = (
    dayOfWeek: number,
    shiftIndex: number,
    field: 'openTime' | 'closeTime',
    value: string,
  ) => {
    setDays((current) =>
      current.map((day) => {
        if (day.dayOfWeek !== dayOfWeek) return day;
        return {
          ...day,
          shifts: day.shifts.map((shift, index) =>
            index === shiftIndex ? { ...shift, [field]: value } : shift,
          ),
        };
      }),
    );
  };

  const saveSchedule = () => {
    saveScheduleMutation.mutate({
      is24x7,
      days: days.map((day) => ({
        dayOfWeek: day.dayOfWeek,
        isActive: day.isActive,
        shifts: day.shifts.map((shift) => ({ openTime: shift.openTime, closeTime: shift.closeTime })),
      })),
    });
  };

  const addHoliday = () => {
    if (!holidayDraft.date || !holidayDraft.name.trim()) {
      toast.error('Preencha data e nome do feriado.');
      return;
    }
    if (holidayDraft.behavior === 'custom_hours' && (!holidayDraft.openTime || !holidayDraft.closeTime)) {
      toast.error('Informe horário de abertura e fechamento para horário especial.');
      return;
    }

    const holidayPayload: {
      date: string;
      name: string;
      behavior: 'closed' | 'custom_hours';
      openTime?: string;
      closeTime?: string;
    } = {
      date: holidayDraft.date,
      name: holidayDraft.name.trim(),
      behavior: holidayDraft.behavior,
    };
    if (holidayDraft.behavior === 'custom_hours') {
      holidayPayload.openTime = holidayDraft.openTime;
      holidayPayload.closeTime = holidayDraft.closeTime;
    }

    saveScheduleMutation.mutate({
      holidays: {
        add: [holidayPayload],
      },
    });
    setHolidayDraft((current) => ({ ...current, date: '', name: '' }));
  };

  const removeHoliday = (holidayId: string) => {
    saveScheduleMutation.mutate({ holidays: { remove: [holidayId] } });
  };

  const orderedDays = useMemo(() => [...days].sort((a, b) => a.dayOfWeek - b.dayOfWeek), [days]);
  const holidays = useMemo(
    () => [...(businessHoursData?.holidays ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    [businessHoursData?.holidays],
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
    <PageShell>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ color: 'var(--txt)', fontSize: 22, fontWeight: 600, letterSpacing: '-0.4px', margin: 0 }}>
          {t('tenantAdmin.businessHours.title')}
        </h1>
        <p style={{ color: 'var(--txt-2)', fontSize: 12, margin: '6px 0 0' }}>
          {t('tenantAdmin.businessHours.subtitle')}
        </p>
      </div>

      <div
        style={{
          background: 'var(--bg-2)',
          border: '1px solid var(--line-2)',
          borderRadius: 'var(--r-lg)',
          padding: 20,
        }}
      >
        <div style={{ display: 'grid', gap: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--txt)', fontSize: 13 }}>
            <button
              type="button"
              role="switch"
              aria-checked={is24x7}
              aria-label="Atendimento 24x7 (global)"
              onClick={() => setIs24x7((current) => !current)}
              style={{
                border: 'none',
                background: 'transparent',
                padding: 0,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  width: 36,
                  height: 20,
                  borderRadius: 999,
                  border: '1px solid var(--line)',
                  background: is24x7 ? 'var(--teal)' : 'var(--bg-4)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: 2,
                  transition: 'all .15s ease',
                }}
              >
                <span
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: '#fff',
                    transform: `translateX(${is24x7 ? 16 : 0}px)`,
                    transition: 'transform .15s ease',
                  }}
                />
              </span>
            </button>
            Atendimento 24x7 (global)
          </div>

          <label style={{ display: 'grid', gap: 8 }}>
            <span style={{ color: 'var(--txt-2)', fontSize: 13, fontWeight: 600 }}>
              {t('tenantAdmin.businessHours.timezone')}
            </span>
            <select
              aria-label={t('tenantAdmin.businessHours.timezone')}
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              style={selectStyle}
            >
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
                      height: 62,
                      borderBottom: index === 6 ? 'none' : '1px solid var(--line)',
                      background: 'var(--bg-3)',
                      opacity: 0.45,
                    }}
                  />
                ))
              : orderedDays.map((day) => (
                  <ShiftRow
                    key={day.id}
                    day={day}
                    label={t(`tenantAdmin.businessHours.days.${day.dayOfWeek}`)}
                    onToggleActive={onToggleActive}
                    onAddShift={onAddShift}
                    onRemoveShift={onRemoveShift}
                    onChangeShift={onChangeShift}
                  />
                ))}
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ color: 'var(--txt)', fontSize: 15, fontWeight: 700, margin: 0 }}>
              Feriados
            </h2>

            <div style={{ display: 'grid', gap: 10 }}>
              {holidays.map((holiday) => (
                <HolidayRow key={holiday.id} holiday={holiday} onRemove={removeHoliday} />
              ))}
              {!holidays.length && (
                <div style={{ color: 'var(--txt-3)', fontSize: 12 }}>Nenhum feriado configurado.</div>
              )}
            </div>

            <div style={{ display: 'grid', gap: 10, border: '1px solid var(--line)', borderRadius: 'var(--r)', padding: 12 }}>
              <div style={{ color: 'var(--txt-2)', fontSize: 12, fontWeight: 600 }}>Adicionar feriado</div>
              <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr 160px 130px 130px auto', gap: 8 }}>
                <input
                  type="date"
                  value={holidayDraft.date}
                  onChange={(event) => setHolidayDraft((current) => ({ ...current, date: event.target.value }))}
                  className="zd-input"
                />
                <input
                  type="text"
                  value={holidayDraft.name}
                  placeholder="Nome do feriado"
                  onChange={(event) => setHolidayDraft((current) => ({ ...current, name: event.target.value }))}
                  className="zd-input"
                />
                <select
                  value={holidayDraft.behavior}
                  onChange={(event) =>
                    setHolidayDraft((current) => ({
                      ...current,
                      behavior: event.target.value as HolidayDraft['behavior'],
                    }))
                  }
                  style={{ ...selectStyle, height: 36 }}
                >
                  <option value="closed">Fechado</option>
                  <option value="custom_hours">Horário especial</option>
                </select>
                <input
                  type="time"
                  value={holidayDraft.openTime}
                  disabled={holidayDraft.behavior !== 'custom_hours'}
                  onChange={(event) => setHolidayDraft((current) => ({ ...current, openTime: event.target.value }))}
                  style={timeInputStyle}
                />
                <input
                  type="time"
                  value={holidayDraft.closeTime}
                  disabled={holidayDraft.behavior !== 'custom_hours'}
                  onChange={(event) => setHolidayDraft((current) => ({ ...current, closeTime: event.target.value }))}
                  style={timeInputStyle}
                />
                <Button type="button" onClick={addHoliday} loading={saveScheduleMutation.isPending}>
                  Adicionar
                </Button>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <Button
                type="button"
                variant="ghost"
                onClick={() => importHolidaysMutation.mutate('BR')}
                loading={importHolidaysMutation.isPending}
              >
                Importar feriados nacionais (BR)
              </Button>
              <Button type="button" onClick={saveSchedule} loading={saveScheduleMutation.isPending}>
                {saveScheduleMutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.businessHours.save')}
              </Button>
            </div>
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
                  aria-label={t('tenantAdmin.businessHours.awayMessageLabel')}
                  onChange={(event) => setAwayMessageEnabled(event.target.checked)}
                />
                {t('tenantAdmin.businessHours.awayMessageLabel')}
              </label>
            </div>

            <textarea
              value={awayMessage}
              onChange={(event) => setAwayMessage(event.target.value)}
              placeholder={t('tenantAdmin.businessHours.awayMessagePlaceholder')}
              aria-label={t('tenantAdmin.businessHours.awayMessage')}
              className="zd-textarea"
              rows={4}
              style={{
                resize: 'vertical',
                minHeight: 104,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="button" onClick={() => saveSettingsMutation.mutate()} loading={saveSettingsMutation.isPending}>
                {saveSettingsMutation.isPending ? t('tenantAdmin.common.saving') : t('tenantAdmin.businessHours.save')}
              </Button>
            </div>
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
              {statusLabel ? ` - ${statusLabel}` : ''}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
