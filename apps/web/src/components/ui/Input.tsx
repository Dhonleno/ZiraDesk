import { forwardRef, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | undefined;
  hint?: string | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = '', id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-txt-2">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={[
            'h-10 w-full rounded-lg border bg-bg-4 px-3 text-sm text-txt placeholder-txt-3 transition-colors',
            'focus:outline-none focus:ring-2 focus:ring-teal focus:ring-offset-1 focus:ring-offset-bg',
            error
              ? 'border-[rgba(248,113,113,.5)] focus:ring-[#F87171]'
              : 'border-line-2 hover:border-[rgba(255,255,255,.2)] focus:border-teal',
            className,
          ].join(' ')}
          {...props}
        />
        {hint && !error && <p className="text-xs text-txt-3">{hint}</p>}
        {error && <p className="text-xs text-[#F87171]">{error}</p>}
      </div>
    );
  },
);

Input.displayName = 'Input';
