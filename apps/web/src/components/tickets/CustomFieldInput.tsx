import { useTranslation } from 'react-i18next';
import type { CustomFieldDefinition } from '../../services/api';

interface Props {
  field: CustomFieldDefinition;
  value: unknown;
  disabled?: boolean;
  className?: string;
  onChange: (value: unknown) => void;
}

export function CustomFieldInput({ field, value, disabled = false, className, onChange }: Props) {
  const { t } = useTranslation('common');

  switch (field.field_type) {
    case 'number':
      return (
        <input
          type="number"
          className={className}
          value={value === null || value === undefined ? '' : String(value)}
          disabled={disabled}
          onChange={(event) => {
            const raw = event.target.value;
            onChange(raw === '' ? '' : Number(raw));
          }}
        />
      );

    case 'date':
      return (
        <input
          type="date"
          className={className}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'boolean':
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
      );

    case 'select':
      return (
        <select
          className={className}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{t('notDefined')}</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      );

    case 'text':
    default:
      return (
        <input
          type="text"
          className={className}
          value={value === null || value === undefined ? '' : String(value)}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}
