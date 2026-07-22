import { wrapTicketEmail } from '../ticket-emails.service.js';

type Lang = 'pt-BR' | 'en-US' | 'es';

interface TicketSlaWarningParams {
  ticketNumber: string;
  ticketTitle: string;
  minutesUntilBreach: number;
  ticketUrl: string;
  lang: Lang;
}

interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

// ─── i18n strings ─────────────────────────────────────────────────────────────

const i18n = {
  'pt-BR': {
    subject: (num: string, title: string, minutes: number) =>
      `Alerta de SLA: ${num} — ${title} vence em ${minutes} min`,
    headerTitle: 'Alerta de SLA',
    intro: 'O prazo do seguinte ticket está próximo de vencer:',
    labelProtocol: 'Protocolo',
    labelSubject: 'Assunto',
    warningLine: (minutes: number) =>
      `Faltam aproximadamente <strong>${minutes} minutos</strong> para o vencimento do SLA.`,
    cta: 'Ver ticket',
    footer: (num: string) => `Este alerta foi gerado automaticamente. Protocolo ${num}.`,
  },
  'en-US': {
    subject: (num: string, title: string, minutes: number) =>
      `SLA Warning: ${num} — ${title} due in ${minutes} min`,
    headerTitle: 'SLA Warning',
    intro: 'The deadline for the following ticket is approaching:',
    labelProtocol: 'Protocol',
    labelSubject: 'Subject',
    warningLine: (minutes: number) =>
      `Approximately <strong>${minutes} minutes</strong> remain before the SLA deadline.`,
    cta: 'View ticket',
    footer: (num: string) => `This alert was generated automatically. Protocol ${num}.`,
  },
  es: {
    subject: (num: string, title: string, minutes: number) =>
      `Alerta de SLA: ${num} — ${title} vence en ${minutes} min`,
    headerTitle: 'Alerta de SLA',
    intro: 'El plazo del siguiente ticket está por vencer:',
    labelProtocol: 'Protocolo',
    labelSubject: 'Asunto',
    warningLine: (minutes: number) =>
      `Quedan aproximadamente <strong>${minutes} minutos</strong> para el vencimiento del SLA.`,
    cta: 'Ver ticket',
    footer: (num: string) => `Esta alerta fue generada automáticamente. Protocolo ${num}.`,
  },
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Public render function ─────────────────────────────────────────────────

export function renderTicketSlaWarning(params: TicketSlaWarningParams): EmailContent {
  const s = i18n[params.lang] ?? i18n['pt-BR'];
  const minutes = params.minutesUntilBreach;
  const ticketNumber = escapeHtml(params.ticketNumber);
  const ticketTitle = escapeHtml(params.ticketTitle);

  const bodyHtml = `
    <p>${s.intro}</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
      <tr>
        <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:120px;">${s.labelProtocol}</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;font-family:monospace;">${ticketNumber}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;">${s.labelSubject}</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;">${ticketTitle}</td>
      </tr>
    </table>
    <p>${s.warningLine(minutes)}</p>
    <p style="text-align:center;margin:28px 0;">
      <a href="${escapeHtml(params.ticketUrl)}" style="background:#1c7a6e;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
        ${s.cta}
      </a>
    </p>`;

  const html = wrapTicketEmail({
    headerTitle: s.headerTitle,
    bodyHtml,
    footerText: s.footer(params.ticketNumber),
  });

  const plainWarningLine = s.warningLine(minutes).replace(/<[^>]+>/g, '');
  const text = `${s.headerTitle}\n\n${params.ticketNumber} — ${params.ticketTitle}\n${plainWarningLine}\n${params.ticketUrl}`;

  return {
    subject: s.subject(params.ticketNumber, params.ticketTitle, minutes),
    html,
    text,
  };
}
