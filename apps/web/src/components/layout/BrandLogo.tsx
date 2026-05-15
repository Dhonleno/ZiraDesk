type BrandLogoVariant = 'full' | 'icon';
type BrandLogoTone = 'themed' | 'dark';

interface BrandLogoProps {
  variant?: BrandLogoVariant;
  tone?: BrandLogoTone;
  width?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
}

export function BrandLogo({
  variant = 'full',
  tone = 'themed',
  width,
  height,
  className,
  ariaLabel = 'ZiraDesk',
}: BrandLogoProps) {
  const svgWidth = width ?? (variant === 'icon' ? 28 : 120);
  const svgHeight = height ?? (variant === 'icon' ? 28 : 28);

  if (variant === 'icon') {
    return tone === 'dark' ? (
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox="0 0 64 64"
        className={className}
        role="img"
        aria-label={ariaLabel}
      >
        <rect x="0" y="0" width="64" height="64" rx="14" fill="#1E293B" />
        <rect x="0" y="0" width="64" height="64" rx="14" fill="none" stroke="#334155" strokeWidth="1.5" />
        <path
          d="M16 18 L48 18 L16 46 L48 46"
          fill="none"
          stroke="#F1F5F9"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ) : (
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox="0 0 64 64"
        className={className}
        role="img"
        aria-label={ariaLabel}
      >
        <rect x="0" y="0" width="64" height="64" rx="14" className="brand-logo-bg" />
        <rect x="0" y="0" width="64" height="64" rx="14" fill="none" className="brand-logo-stroke" strokeWidth="1.5" />
        <path
          d="M16 18 L48 18 L16 46 L48 46"
          fill="none"
          className="brand-logo-z"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return tone === 'dark' ? (
    <svg
      width={svgWidth}
      height={svgHeight}
      viewBox="0 0 160 36"
      className={className}
      role="img"
      aria-label={ariaLabel}
    >
      <rect x="0" y="0" width="36" height="36" rx="8" fill="#1E293B" />
      <rect x="0" y="0" width="36" height="36" rx="8" fill="none" stroke="#334155" strokeWidth="1" />
      <path
        d="M9 10 L27 10 L9 26 L27 26"
        fill="none"
        stroke="#F1F5F9"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text x="46" y="23" fontFamily="'IBM Plex Sans',system-ui" fontSize="16" fontWeight="700" fill="#F1F5F9" letterSpacing="-0.3">
        Zira
      </text>
      <text x="82" y="23" fontFamily="'IBM Plex Sans',system-ui" fontSize="16" fontWeight="300" fill="#94A3B8" letterSpacing="-0.3">
        Desk
      </text>
    </svg>
  ) : (
    <svg
      width={svgWidth}
      height={svgHeight}
      viewBox="0 0 160 36"
      className={className}
      role="img"
      aria-label={ariaLabel}
    >
      <rect x="0" y="0" width="36" height="36" rx="8" className="brand-logo-bg" />
      <rect x="0" y="0" width="36" height="36" rx="8" fill="none" className="brand-logo-stroke" strokeWidth="1" />
      <path
        d="M9 10 L27 10 L9 26 L27 26"
        fill="none"
        className="brand-logo-z"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text x="46" y="23" fontFamily="'IBM Plex Sans',system-ui" fontSize="16" fontWeight="700" className="brand-logo-zira" letterSpacing="-0.3">
        Zira
      </text>
      <text x="82" y="23" fontFamily="'IBM Plex Sans',system-ui" fontSize="16" fontWeight="300" className="brand-logo-desk" letterSpacing="-0.3">
        Desk
      </text>
    </svg>
  );
}
