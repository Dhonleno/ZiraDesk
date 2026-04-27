import type { ReactNode } from 'react';

type BadgeVariant = 'success' | 'info' | 'warning' | 'error' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  success: 'bg-emerald-900/30 text-emerald-400 border-emerald-800/50',
  info: 'bg-blue-900/30 text-blue-400 border-blue-800/50',
  warning: 'bg-yellow-900/30 text-yellow-400 border-yellow-800/50',
  error: 'bg-red-900/30 text-red-400 border-red-800/50',
  neutral: 'bg-gray-800/50 text-gray-400 border-gray-700/50',
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
