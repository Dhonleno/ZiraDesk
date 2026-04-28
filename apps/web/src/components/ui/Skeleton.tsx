import type { CSSProperties } from 'react';

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
}

export function Skeleton({ className = '', style }: SkeletonProps) {
  return (
    <div
      className={['animate-pulse rounded', className].join(' ')}
      style={{ background: 'var(--bg-4)', ...style }}
      aria-hidden="true"
    />
  );
}
