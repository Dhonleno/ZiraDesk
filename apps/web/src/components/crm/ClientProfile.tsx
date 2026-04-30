import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { contactsApi } from '../../services/api';
import type { CrmContact } from '../../services/api';

const AVATAR_GRADS = [
  '#667eea,#764ba2', '#f093fb,#f5576c', '#4facfe,#00f2fe', '#43e97b,#38f9d7',
  '#fa709a,#fee140', '#a18cd1,#fbc2eb', '#f7971e,#ffd200', '#5ee7df,#b490ca',
  '#84fab0,#8fd3f4', '#fad0c4,#ffd1ff', '#ee9ca7,#ffdde1', '#fbc2eb,#a6c1ee',
];

function gradFor(id: string): string {
  const h = id.split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) & 0xffff, 0);
  return `linear-gradient(135deg,${AVATAR_GRADS[h % AVATAR_GRADS.length]})`;
}

function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => (w[0] ?? '').toUpperCase()).join('');
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR');
}

function Field({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  const empty = !value;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--txt-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{
        fontSize: mono ? 11 : 12,
        color: empty ? 'var(--txt-3)' : 'var(--txt)',
        fontFamily: mono ? 'var(--mono)' : 'var(--font)',
        fontStyle: empty ? 'italic' : 'normal',
      } as React.CSSProperties}>
        {value || 'Não informado'}
      </span>
    </div>
  );
}

interface Props {
  clientId: string | null;
  onEdit: (client: CrmContact) => void;
}

type Tab = 'dados' | 'notas';

export function ClientProfile({ clientId, onEdit }: Props) {
  const [tab, setTab] = useState<Tab>('dados');

  const { data: contact, isLoading } = useQuery({
    queryKey: ['crm-contact', clientId],
    queryFn: () => contactsApi.get(clientId!),
    enabled: !!clientId,
  });

  if (!clientId) {
    return (
      <div style={{ background: 'var(--bg-2)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '40px 20px', color: 'var(--txt-3)', textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, background: 'var(--bg-3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.4" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </div>
        <div style={{ fontSize: 13, color: 'var(--txt-2)', fontWeight: 500 }}>Nenhum contato selecionado</div>
        <div style={{ fontSize: 11, maxWidth: 220, lineHeight: 1.5 }}>Clique em um contato da lista para ver os detalhes</div>
      </div>
    );
  }

  if (isLoading || !contact) {
    return (
      <div style={{ background: 'var(--bg-2)', borderLeft: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 13, color: 'var(--txt-3)' }}>Carregando...</div>
      </div>
    );
  }

  const grad = gradFor(contact.id);
  const ini = initials(contact.name);
  const roleDesc = [contact.role, contact.organization_name].filter(Boolean).join(' · ');

  const TABS: Array<{ key: Tab; label: string }> = [
    { key: 'dados', label: 'Dados' },
    { key: 'notas', label: 'Notas' },
  ];

  return (
    <div style={{ background: 'var(--bg-2)', borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Top action bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
        <button
          onClick={() => onEdit(contact)}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--r)', background: 'var(--bg-3)', border: '1px solid var(--line)', color: 'var(--txt-2)', fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font)' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2 9.5L3.2 8 8.5 2.7l1.8 1.8-5.3 5.3L2 11V9.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          Editar
        </button>
        <button
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--r)', background: 'var(--teal)', border: '1px solid var(--teal)', color: 'var(--on-teal)', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
            <path d="M2 8.5V3.5a1 1 0 011-1h6a1 1 0 011 1V7a1 1 0 01-1 1H5l-3 2v-1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
          Iniciar conversa
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', scrollbarWidth: 'thin', scrollbarColor: 'var(--bg-5) transparent' }}>

        {/* Hero */}
        <div style={{ padding: '20px 20px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', borderBottom: '1px solid var(--line)', position: 'relative' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 72, background: 'radial-gradient(ellipse at top, rgba(102,126,234,.15), transparent 70%)', pointerEvents: 'none' }} />
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: grad, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 600, color: '#fff', border: '3px solid var(--bg-2)', position: 'relative', zIndex: 1, boxShadow: '0 8px 24px rgba(102,126,234,.3)' }}>
            {ini}
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.3px', color: 'var(--txt)' }}>{contact.name}</div>
            {roleDesc && <div style={{ fontSize: 12, color: 'var(--txt-3)', marginTop: 2 }}>{roleDesc}</div>}
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'center', marginTop: 2 }}>
            {contact.is_primary && (
              <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: 'var(--teal-dim)', color: 'var(--teal)', border: '1px solid rgba(0,201,167,.25)' }}>
                Primário
              </span>
            )}
            {contact.tags.slice(0, 4).map((tag) => (
              <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', fontSize: 10, padding: '2px 8px', borderRadius: 'var(--r-pill)', background: 'var(--bg-4)', color: 'var(--txt-2)', border: '1px solid var(--line)' }}>
                {tag}
              </span>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{ flex: 1, padding: '9px 4px', fontSize: 12, fontWeight: 500, cursor: 'pointer', color: tab === t.key ? 'var(--teal)' : 'var(--txt-3)', background: 'transparent', border: 'none', borderBottom: tab === t.key ? '2px solid var(--teal)' : '2px solid transparent', marginBottom: -1, transition: 'all .15s', fontFamily: 'var(--font)' } as React.CSSProperties}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab: Dados */}
        {tab === 'dados' && (
          <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 18 }}>

            <section>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', marginBottom: 10 }}>Contato</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                <Field label="E-mail"    value={contact.email} />
                <Field label="Telefone"  value={contact.phone} mono />
                <Field label="WhatsApp"  value={contact.whatsapp} mono />
                <Field label="Documento" value={contact.document} mono />
              </div>
            </section>

            <section>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', marginBottom: 10 }}>Profissional</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px' }}>
                <Field label="Cargo"        value={contact.role} />
                <Field label="Departamento" value={contact.department} />
                <Field label="Organização"  value={contact.organization_name} />
                <Field label="Desde"        value={fmtDate(contact.created_at)} />
              </div>
            </section>

            {contact.notes && (
              <section>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--txt-3)', marginBottom: 10 }}>Notas</div>
                <div style={{ fontSize: 12, color: 'var(--txt-2)', lineHeight: 1.6 }}>{contact.notes}</div>
              </section>
            )}

          </div>
        )}

        {/* Tab: Notas */}
        {tab === 'notas' && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--txt-3)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
              <rect x="6" y="4" width="20" height="24" rx="2" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10 10h12M10 15h12M10 20h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            <div style={{ fontSize: 13, color: 'var(--txt-2)', fontWeight: 500 }}>Nenhuma nota registrada</div>
          </div>
        )}

      </div>
    </div>
  );
}

