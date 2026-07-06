import { useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { legalApi } from '../../services/api';
import { Modal } from '../ui/Modal';

interface LegalDpoLinkProps {
  className?: string;
  label?: string;
  prefix?: ReactNode;
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a className="legal-dpo-value" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function ContactValue({ href, value }: { href: string | undefined; value: string | null }) {
  if (!value) {
    return <span className="legal-dpo-value muted">-</span>;
  }

  if (!href) {
    return <span className="legal-dpo-value">{value}</span>;
  }

  return (
    <a className="legal-dpo-value" href={href}>
      {value}
    </a>
  );
}

export function LegalDpoLink({ className, label, prefix }: LegalDpoLinkProps) {
  const { t } = useTranslation(['legal', 'common']);
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['legal', 'dpo'],
    queryFn: legalApi.getDpo,
    enabled: true,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const hasDpoInfo = Boolean(data?.name || data?.email || data?.phone || data?.privacyPolicyUrl || data?.termsUrl);

  if (isError || isLoading || !hasDpoInfo) {
    return null;
  }

  return (
    <>
      {prefix}
      <button
        type="button"
        className={className ? `legal-footer-link ${className}` : 'legal-footer-link'}
        onClick={() => setOpen(true)}
      >
        {label ?? t('dpo.title', { ns: 'legal' })}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('dpo.title', { ns: 'legal' })} maxWidth="sm">
        {isLoading ? <p className="legal-dpo-loading">{t('loading', { ns: 'common' })}</p> : null}
        {isError ? <p className="legal-dpo-loading">{t('error', { ns: 'common' })}</p> : null}
        {!isLoading && !isError && data ? (
          <div className="legal-dpo-modal">
            <div className="legal-dpo-name">{data.name ?? '-'}</div>

            <div className="legal-dpo-section">
              <span className="legal-dpo-section-title">{t('dpo.contact', { ns: 'legal' })}</span>
              <div className="legal-dpo-grid">
                <div className="legal-dpo-row">
                  <span className="legal-dpo-label">{t('dpo.email', { ns: 'legal' })}</span>
                  <ContactValue href={data.email ? `mailto:${data.email}` : undefined} value={data.email} />
                </div>
                <div className="legal-dpo-row">
                  <span className="legal-dpo-label">{t('dpo.phone', { ns: 'legal' })}</span>
                  <ContactValue href={data.phone ? `tel:${data.phone}` : undefined} value={data.phone} />
                </div>
              </div>
            </div>

            {data.privacyPolicyUrl || data.termsUrl ? (
              <div className="legal-dpo-section">
                <span className="legal-dpo-section-title">LGPD</span>
                <div className="legal-dpo-links">
                  {data.privacyPolicyUrl ? (
                    <ExternalLink href={data.privacyPolicyUrl}>{t('privacyPolicy', { ns: 'legal' })}</ExternalLink>
                  ) : null}
                  {data.termsUrl ? (
                    <ExternalLink href={data.termsUrl}>{t('termsOfService', { ns: 'legal' })}</ExternalLink>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
