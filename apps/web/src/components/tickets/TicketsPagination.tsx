import { useTranslation } from 'react-i18next';

interface Props {
  page: number;
  total: number;
  perPage: number;
  onPage: (page: number) => void;
}

export function TicketsPagination({ page, total, perPage, onPage }: Props) {
  const { t } = useTranslation('common');
  const totalPages = Math.ceil(total / perPage);
  if (totalPages <= 1) return null;

  return (
    <div className="tickets-pagination">
      <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        {t('previous')}
      </button>
      <span>{page} / {totalPages}</span>
      <button type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        {t('next')}
      </button>
    </div>
  );
}
