import type { ReactNode } from 'react';

type BadgeVariant = 'success' | 'info' | 'warning' | 'error' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  success: 'bg-[rgba(62,207,142,.15)] text-[#3ECF8E] border-[rgba(62,207,142,.2)]',
  info:    'bg-[rgba(96,165,250,.15)]  text-[#60A5FA] border-[rgba(96,165,250,.2)]',
  warning: 'bg-[rgba(245,158,11,.15)]  text-[#F59E0B] border-[rgba(245,158,11,.2)]',
  error:   'bg-[rgba(248,113,113,.15)] text-[#F87171] border-[rgba(248,113,113,.2)]',
  neutral: 'bg-[rgba(156,163,175,.15)] text-[#9CA3AF] border-[rgba(156,163,175,.2)]',
};

export function Badge({ variant = 'neutral', children, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        variantClasses[variant],
        className,
      ].join(' ')}
    >
      {children}
    </span>
  );
}
