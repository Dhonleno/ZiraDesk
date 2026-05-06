import { forwardRef, type InputHTMLAttributes } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | undefined;
  hint?: string | undefined;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className = '', id, style, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium" style={{ color: 'var(--txt-2)' }}>
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={[
            'h-10 w-full rounded-lg px-3 text-sm transition-colors outline-none',
            className,
          ].join(' ')}
          style={{
            background: 'var(--bg-3)',
            border: error
              ? '1px solid rgba(248,113,113,.5)'
              : '1px solid var(--line-2)',
            color: 'var(--txt)',
            ...style,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = error ? 'var(--red)' : 'var(--teal)';
            e.currentTarget.style.boxShadow = error
              ? '0 0 0 3px rgba(248,113,113,.15)'
              : '0 0 0 3px var(--teal-dim)';
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = error
              ? 'rgba(248,113,113,.5)'
              : 'var(--line-2)';
            e.currentTarget.style.boxShadow = 'none';
            props.onBlur?.(e);
          }}
          placeholder={props.placeholder}
          {...props}
        />
        {hint && !error && (
          <p className="text-xs" style={{ color: 'var(--txt-3)' }}>
            {hint}
          </p>
        )}
        {error && (
          <p className="text-xs" style={{ color: 'var(--red)' }}>
            {error}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = 'Input';
