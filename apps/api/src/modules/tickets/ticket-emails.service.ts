import { logger } from '../../config/logger.js';
import { sendEmail } from '../../services/email.service.js';

export interface TicketEmailContext {
  tenantId: string;
  tenantSchema: string;
  tenantName: string;
  contactEmail: string;
  contactName: string;
  ticketNumber: number;
  ticketTitle: string;
  ticketPriority: string;
  ticketUrl: string;
}

function priorityLabel(priority: string): string {
  const map: Record<string, string> = {
    low: 'Baixa',
    medium: 'Média',
    high: 'Alta',
    urgent: 'Urgente',
  };
  return map[priority] ?? priority;
}

function ticketNumberFormatted(n: number): string {
  return `#${String(n).padStart(5, '0')}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMultiline(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br />');
}

export function wrapTicketEmail(params: {
  headerTitle: string;
  bodyHtml: string;
  footerText: string;
}): string {
  const headerTitle = escapeHtml(params.headerTitle);
  const footerText = escapeHtml(params.footerText);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${headerTitle}</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" style="max-width:560px;background:#ffffff;border-radius:10px;box-shadow:0 2px 8px rgba(0,0,0,0.08);overflow:hidden;">
          <tr>
            <td style="background:#1c7a6e;padding:28px 32px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;">
                ${headerTitle}
              </h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;color:#444444;font-size:15px;line-height:1.6;">
              ${params.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:20px 32px;color:#9ca3af;font-size:12px;">
              ${footerText}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function baseValues(ctx: TicketEmailContext) {
  const num = ticketNumberFormatted(ctx.ticketNumber);
  return {
    num,
    contactName: escapeHtml(ctx.contactName),
    tenantName: escapeHtml(ctx.tenantName),
    ticketTitle: escapeHtml(ctx.ticketTitle),
    ticketPriority: escapeHtml(priorityLabel(ctx.ticketPriority)),
    ticketUrl: escapeHtml(ctx.ticketUrl),
  };
}

function buildTicketOpenedEmail(ctx: TicketEmailContext): { subject: string; html: string } {
  const values = baseValues(ctx);
  const subject = `${values.num} — Ticket recebido: ${ctx.ticketTitle}`;

  const bodyHtml = `
    <p>Olá, <strong>${values.contactName}</strong>!</p>
    <p>Recebemos sua solicitação e ela foi registrada em nosso sistema.</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
      <tr>
        <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;width:140px;color:#374151;">Protocolo</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;color:#111827;font-family:monospace;">${values.num}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;color:#374151;">Assunto</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;color:#111827;">${values.ticketTitle}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;background:#f9fafb;border:1px solid #e5e7eb;font-weight:600;color:#374151;">Prioridade</td>
        <td style="padding:8px 12px;border:1px solid #e5e7eb;color:#111827;">${values.ticketPriority}</td>
      </tr>
    </table>
    <p>Nossa equipe analisará sua solicitação em breve. Você pode acompanhar o andamento pelo portal.</p>
    <p style="text-align:center;margin:28px 0;">
      <a href="${values.ticketUrl}" style="background:#1c7a6e;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
        Acompanhar ticket
      </a>
    </p>
  `;

  const html = wrapTicketEmail({
    headerTitle: 'Ticket recebido',
    bodyHtml,
    footerText: `Este email foi enviado pela ${ctx.tenantName} via ZiraDesk. Protocolo ${values.num}.`,
  });

  return { subject, html };
}

function buildTicketCommentEmail(ctx: TicketEmailContext & { commentText: string }): { subject: string; html: string } {
  const values = baseValues(ctx);
  const subject = `${values.num} — Nova atualização no seu ticket`;

  const bodyHtml = `
    <p>Olá, <strong>${values.contactName}</strong>!</p>
    <p>Há uma nova atualização no seu ticket <strong>${values.num} — ${values.ticketTitle}</strong>:</p>
    <blockquote style="margin:20px 0;padding:16px 20px;background:#f9fafb;border-left:4px solid #1c7a6e;border-radius:4px;color:#374151;font-size:14px;line-height:1.6;">
      ${formatMultiline(ctx.commentText)}
    </blockquote>
    <p style="text-align:center;margin:28px 0;">
      <a href="${values.ticketUrl}" style="background:#1c7a6e;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
        Ver ticket completo
      </a>
    </p>
  `;

  const html = wrapTicketEmail({
    headerTitle: 'Atualização no seu ticket',
    bodyHtml,
    footerText: `Este email foi enviado pela ${ctx.tenantName} via ZiraDesk. Protocolo ${values.num}.`,
  });

  return { subject, html };
}

function buildTicketResolvedEmail(ctx: TicketEmailContext & { resolutionNotes: string }): { subject: string; html: string } {
  const values = baseValues(ctx);
  const subject = `${values.num} — Seu ticket foi resolvido`;

  const bodyHtml = `
    <p>Olá, <strong>${values.contactName}</strong>!</p>
    <p>Temos uma boa notícia: seu ticket <strong>${values.num} — ${values.ticketTitle}</strong>
       foi marcado como <strong>resolvido</strong>.</p>
    <div style="margin:20px 0;padding:16px 20px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;">
      <p style="margin:0 0 8px;font-weight:600;color:#166534;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;">Solução aplicada</p>
      <p style="margin:0;color:#374151;font-size:14px;line-height:1.6;">
        ${formatMultiline(ctx.resolutionNotes)}
      </p>
    </div>
    <p>Se o problema persistir ou você tiver dúvidas, pode reabrir o ticket pelo portal.</p>
    <p style="text-align:center;margin:28px 0;">
      <a href="${values.ticketUrl}" style="background:#1c7a6e;color:#ffffff;padding:12px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:14px;">
        Ver ticket
      </a>
    </p>
  `;

  const html = wrapTicketEmail({
    headerTitle: 'Ticket resolvido',
    bodyHtml,
    footerText: `Este email foi enviado pela ${ctx.tenantName} via ZiraDesk. Protocolo ${values.num}.`,
  });

  return { subject, html };
}

export async function sendTicketOpenedEmail(ctx: TicketEmailContext): Promise<void> {
  if (!ctx.contactEmail) return;

  try {
    const { subject, html } = buildTicketOpenedEmail(ctx);
    await sendEmail({
      tenantId: ctx.tenantId,
      tenantSchema: ctx.tenantSchema,
      to: ctx.contactEmail,
      subject,
      html,
      from: { name: ctx.tenantName },
    });
  } catch (err) {
    logger.error({ err }, '[TicketEmail] Failed to send opened email');
  }
}

export async function sendTicketCommentEmail(
  ctx: TicketEmailContext & { commentText: string },
): Promise<void> {
  if (!ctx.contactEmail) return;

  try {
    const { subject, html } = buildTicketCommentEmail(ctx);
    await sendEmail({
      tenantId: ctx.tenantId,
      tenantSchema: ctx.tenantSchema,
      to: ctx.contactEmail,
      subject,
      html,
      from: { name: ctx.tenantName },
    });
  } catch (err) {
    logger.error({ err }, '[TicketEmail] Failed to send comment email');
  }
}

export async function sendTicketResolvedEmail(
  ctx: TicketEmailContext & { resolutionNotes: string },
): Promise<void> {
  if (!ctx.contactEmail) return;

  try {
    const { subject, html } = buildTicketResolvedEmail(ctx);
    await sendEmail({
      tenantId: ctx.tenantId,
      tenantSchema: ctx.tenantSchema,
      to: ctx.contactEmail,
      subject,
      html,
      from: { name: ctx.tenantName },
    });
  } catch (err) {
    logger.error({ err }, '[TicketEmail] Failed to send resolved email');
  }
}

export async function sendTicketCsatEmail(ctx: {
  tenantId: string;
  tenantSchema: string;
  tenantName: string;
  contactEmail: string;
  contactName: string;
  ticketNumber: number;
  ticketTitle: string;
  csatBaseUrl: string;
}): Promise<void> {
  if (!ctx.contactEmail) return;

  const num = ticketNumberFormatted(ctx.ticketNumber);
  const subject = `${num} — Como foi o seu atendimento?`;
  const labels: Record<number, string> = {
    1: '😞 Péssimo',
    2: '😕 Ruim',
    3: '😐 Regular',
    4: '😊 Bom',
    5: '🤩 Excelente',
  };

  const starButtons = [1, 2, 3, 4, 5].map((rating) => {
    const url = escapeHtml(`${ctx.csatBaseUrl}?csat=${rating}`);
    const color = rating >= 4 ? '#1c7a6e' : rating === 3 ? '#d97706' : '#dc2626';
    return `<a href="${url}" style="display:inline-block;margin:4px;padding:10px 16px;background:${color};color:#ffffff;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">
      ${labels[rating]}
    </a>`;
  }).join('\n');

  const bodyHtml = `
    <p>Olá, <strong>${escapeHtml(ctx.contactName)}</strong>!</p>
    <p>Seu ticket <strong>${num} — ${escapeHtml(ctx.ticketTitle)}</strong>
       foi resolvido. Gostaríamos de saber como foi sua experiência.</p>
    <p><strong>Como você avalia o atendimento?</strong></p>
    <div style="text-align:center;margin:24px 0;">
      ${starButtons}
    </div>
    <p style="font-size:13px;color:#9ca3af;text-align:center;">
      Clique em uma das opções acima para registrar sua avaliação.
    </p>
  `;

  const html = wrapTicketEmail({
    headerTitle: 'Como foi o atendimento?',
    bodyHtml,
    footerText: `Este email foi enviado pela ${ctx.tenantName} via ZiraDesk. Protocolo ${num}.`,
  });

  try {
    await sendEmail({
      tenantId: ctx.tenantId,
      tenantSchema: ctx.tenantSchema,
      to: ctx.contactEmail,
      subject,
      html,
      from: { name: ctx.tenantName },
    });
  } catch (err) {
    logger.error({ err }, '[TicketEmail] Failed to send CSAT email');
  }
}
