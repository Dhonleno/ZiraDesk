interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
    if (totalPages <= 7) return i + 1;
    if (page <= 4) return i + 1;
    if (page >= totalPages - 3) return totalPages - 6 + i;
    return page - 3 + i;
  });

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page === 1}
        className="rounded-lg px-2.5 py-1.5 text-sm text-txt-2 hover:bg-bg-4 hover:text-txt disabled:pointer-events-none disabled:opacity-40 transition-colors"
      >
        ←
      </button>

      {pages.map((p) => (
        <button
          key={p}
          onClick={() => onPageChange(p)}
          className={[
            'min-w-[2rem] rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors',
            p === page
              ? 'bg-teal-dim text-teal'
              : 'text-txt-2 hover:bg-bg-4 hover:text-txt',
          ].join(' ')}
        >
          {p}
        </button>
      ))}

      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page === totalPages}
        className="rounded-lg px-2.5 py-1.5 text-sm text-txt-2 hover:bg-bg-4 hover:text-txt disabled:pointer-events-none disabled:opacity-40 transition-colors"
      >
        →
      </button>
    </div>
  );
}
