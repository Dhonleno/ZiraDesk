import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

interface DatePickerProps {
  /** YYYY-MM-DD, ou '' quando vazio. */
  value: string;
  /** Recebe YYYY-MM-DD, ou '' ao limpar. */
  onChange: (date: string) => void;
  disabled?: boolean;
  placeholder?: string;
  minDate?: string;
  maxDate?: string;
  className?: string;
  id?: string;
  ariaLabel?: string;
}

const POPOVER_HEIGHT = 340;
const POPOVER_MIN_WIDTH = 260;
const VIEWPORT_MARGIN = 8;

/* ── Helpers de data (sem lib externa) ───────────────────────────────────── */

function toYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function isValidYMD(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/* ── Componente ──────────────────────────────────────────────────────────── */

export function DatePicker({
  value,
  onChange,
  disabled = false,
  placeholder,
  minDate,
  maxDate,
  className,
  id,
  ariaLabel,
}: DatePickerProps) {
  const { t, i18n } = useTranslation('common');
  const locale = i18n.language;

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null);

  const [viewYear, setViewYear] = useState<number>(() => (
    isValidYMD(value) ? Number(value.slice(0, 4)) : new Date().getFullYear()
  ));
  const [viewMonth, setViewMonth] = useState<number>(() => (
    isValidYMD(value) ? Number(value.slice(5, 7)) - 1 : new Date().getMonth()
  ));

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const todayYMD = toYMD(new Date());

  // Datas puras (YYYY-MM-DD) formatadas em UTC: evita o deslocamento de um dia
  // que `new Date('2026-07-26').toLocaleDateString()` produz em fusos negativos.
  const formatDisplayDate = useCallback((val: string): string => {
    if (!isValidYMD(val)) return '';
    const [y, m, d] = val.split('-').map(Number);
    const utc = new Date(Date.UTC(y!, m! - 1, d!));
    return utc.toLocaleDateString(locale, {
      timeZone: 'UTC',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  }, [locale]);

  // Nomes de mês e iniciais de dia vêm do Intl no idioma ativo — evita manter
  // 19 chaves de tradução only para o calendário.
  const monthLabel = useMemo(() => {
    const label = new Date(Date.UTC(viewYear, viewMonth, 1)).toLocaleDateString(locale, {
      timeZone: 'UTC',
      month: 'long',
      year: 'numeric',
    });
    return label.charAt(0).toUpperCase() + label.slice(1);
  }, [locale, viewMonth, viewYear]);

  const dayHeaders = useMemo(() => {
    // 2024-01-07 é um domingo: base para a semana começando no domingo.
    return Array.from({ length: 7 }, (_, index) => (
      new Date(Date.UTC(2024, 0, 7 + index)).toLocaleDateString(locale, {
        timeZone: 'UTC',
        weekday: 'narrow',
      })
    ));
  }, [locale]);

  const calendarDays = useMemo<Array<number | null>>(() => {
    const leading = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: Array<number | null> = Array.from({ length: leading }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
    return cells;
  }, [viewMonth, viewYear]);

  const shortcuts = useMemo(() => [
    { key: 'today', label: t('today'), getValue: () => toYMD(new Date()) },
    { key: 'tomorrow', label: t('tomorrow'), getValue: () => toYMD(addDays(new Date(), 1)) },
    { key: 'nextWeek', label: t('nextWeek'), getValue: () => toYMD(addDays(new Date(), 7)) },
    { key: 'nextMonth', label: t('nextMonth'), getValue: () => toYMD(addMonths(new Date(), 1)) },
  ], [t]);

  // Reflete mudanças externas de value no mês exibido.
  useEffect(() => {
    if (!isValidYMD(value)) return;
    setViewYear(Number(value.slice(0, 4)));
    setViewMonth(Number(value.slice(5, 7)) - 1);
  }, [value]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const width = Math.max(rect.width, POPOVER_MIN_WIDTH);
    const height = popoverRef.current?.offsetHeight ?? POPOVER_HEIGHT;
    const openUpward = window.innerHeight - rect.bottom < height && rect.top > height;

    setPosition({
      top: openUpward
        ? Math.max(VIEWPORT_MARGIN, rect.top - height - 4)
        : rect.bottom + 4,
      left: Math.min(
        Math.max(VIEWPORT_MARGIN, rect.left),
        Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
      ),
      width,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;

    updatePosition();
    window.addEventListener('resize', updatePosition);
    // capture: também acompanha scroll de containers internos (sidebar, modal).
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  // Fecha ao clicar fora. O popover é renderizado em portal, então precisa
  // checar trigger e conteúdo separadamente — mesmo padrão do menu de ações
  // do TicketDetail.
  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const isDayDisabled = (day: number): boolean => {
    const ymd = toYMD(new Date(viewYear, viewMonth, day));
    if (minDate && ymd < minDate) return true;
    if (maxDate && ymd > maxDate) return true;
    return false;
  };

  const handleSelect = (day: number) => {
    if (isDayDisabled(day)) return;
    onChange(toYMD(new Date(viewYear, viewMonth, day)));
    setOpen(false);
  };

  const goToMonth = (delta: number) => {
    const next = addMonths(new Date(viewYear, viewMonth, 1), delta);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  const displayValue = formatDisplayDate(value);
  const resolvedPlaceholder = placeholder ?? t('selectDate');

  return (
    <>
      <button
        {...(id ? { id } : {})}
        {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
        ref={triggerRef}
        type="button"
        className={`datepicker-trigger${className ? ` ${className}` : ''}`}
        data-empty={displayValue ? 'false' : 'true'}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => { if (!disabled) setOpen((current) => !current); }}
      >
        <span>{displayValue || resolvedPlaceholder}</span>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
          <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M1.5 5.5h11M4.5 1.5v2M9.5 1.5v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>

      {open && position ? createPortal(
        <div
          ref={popoverRef}
          className="datepicker-popover"
          role="dialog"
          aria-label={resolvedPlaceholder}
          style={{ position: 'fixed', top: position.top, left: position.left, width: position.width }}
        >
          <div className="datepicker-shortcuts">
            {shortcuts.map((shortcut) => (
              <button
                key={shortcut.key}
                type="button"
                className="datepicker-shortcut"
                onClick={() => {
                  onChange(shortcut.getValue());
                  setOpen(false);
                }}
              >
                {shortcut.label}
              </button>
            ))}
          </div>

          <div className="datepicker-header">
            <button type="button" onClick={() => goToMonth(-1)} aria-label={t('previous')}>‹</button>
            <span>{monthLabel}</span>
            <button type="button" onClick={() => goToMonth(1)} aria-label={t('next')}>›</button>
          </div>

          <div className="datepicker-grid">
            {dayHeaders.map((label, index) => (
              <span key={`header-${index}`} className="datepicker-day-header">{label}</span>
            ))}

            {calendarDays.map((day, index) => {
              if (day === null) {
                return <span key={`empty-${index}`} className="datepicker-day empty" />;
              }

              const ymd = toYMD(new Date(viewYear, viewMonth, day));
              const dayDisabled = isDayDisabled(day);

              return (
                <button
                  key={ymd}
                  type="button"
                  className={[
                    'datepicker-day',
                    ymd === value ? 'selected' : '',
                    ymd === todayYMD ? 'today' : '',
                    dayDisabled ? 'disabled' : '',
                  ].filter(Boolean).join(' ')}
                  disabled={dayDisabled}
                  aria-current={ymd === todayYMD ? 'date' : undefined}
                  onClick={() => handleSelect(day)}
                >
                  {day}
                </button>
              );
            })}
          </div>

          <div className="datepicker-footer">
            <button
              type="button"
              className="datepicker-clear"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              {t('clear')}
            </button>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
