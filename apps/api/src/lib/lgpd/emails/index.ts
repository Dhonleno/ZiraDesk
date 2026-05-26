type Lang = 'pt-BR' | 'en-US' | 'es';

interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

interface RequestReceivedParams {
  tenantName: string;
  requestType: string;
  requestedAt: Date;
  slaDeadline: Date;
  lang?: Lang | undefined;
}

interface RequestProcessedParams {
  tenantName: string;
  requestType: string;
  processedAt: Date;
  notes?: string | undefined;
  lang?: Lang | undefined;
}

interface TenantNewRequestParams {
  requestId: string;
  subjectLabel: string;
  requestType: string;
  requestedAt: Date;
  slaDeadline: Date;
  dashboardUrl: string;
  lang?: Lang | undefined;
}

interface SlaWarningParams {
  requestId: string;
  subjectLabel: string;
  requestType: string;
  daysLeft: number;
  slaDeadline: Date;
  dashboardUrl: string;
  lang?: Lang | undefined;
}

interface SlaBreachedParams {
  tenantName: string;
  pendingCount: number;
  dashboardUrl: string;
  lang?: Lang | undefined;
}

interface RequestRejectedParams {
  tenantName: string;
  requestType: string;
  rejectedAt: Date;
  reason: string;
  lang?: Lang | undefined;
}

// ─── i18n strings ─────────────────────────────────────────────────────────────

const i18n = {
  requestTypes: {
    'pt-BR': {
      access: 'Acesso aos dados',
      consent_update: 'Atualização de consentimento',
      anonymization: 'Anonimização',
      rectification: 'Retificação de dados',
      external_anonymization: 'Anonimização externa',
      user_anonymization: 'Anonimização de usuário',
    },
    'en-US': {
      access: 'Data access',
      consent_update: 'Consent update',
      anonymization: 'Anonymization',
      rectification: 'Data rectification',
      external_anonymization: 'External anonymization',
      user_anonymization: 'User anonymization',
    },
    es: {
      access: 'Acceso a datos',
      consent_update: 'Actualización de consentimiento',
      anonymization: 'Anonimización',
      rectification: 'Rectificación de datos',
      external_anonymization: 'Anonimización externa',
      user_anonymization: 'Anonimización de usuario',
    },
  },
  received: {
    'pt-BR': {
      subject: 'Recebemos sua solicitação LGPD',
      heading: 'Sua solicitação foi recebida',
      body: 'Recebemos sua solicitação de <strong>{{requestType}}</strong> em {{requestedAt}}.',
      sla: 'Temos até <strong>{{slaDeadline}}</strong> para atender seu pedido (prazo legal de 15 dias).',
      closing: 'Entraremos em contato assim que seu pedido for processado.',
      footer: 'Esta mensagem foi enviada automaticamente. Não responda a este e-mail.',
    },
    'en-US': {
      subject: 'We received your LGPD request',
      heading: 'Your request has been received',
      body: 'We received your <strong>{{requestType}}</strong> request on {{requestedAt}}.',
      sla: 'We have until <strong>{{slaDeadline}}</strong> to fulfil your request (15-day legal deadline).',
      closing: 'We will contact you once your request has been processed.',
      footer: 'This message was sent automatically. Do not reply to this email.',
    },
    es: {
      subject: 'Hemos recibido tu solicitud LGPD',
      heading: 'Tu solicitud ha sido recibida',
      body: 'Recibimos tu solicitud de <strong>{{requestType}}</strong> el {{requestedAt}}.',
      sla: 'Tenemos hasta el <strong>{{slaDeadline}}</strong> para atender tu solicitud (plazo legal de 15 días).',
      closing: 'Te contactaremos una vez que tu solicitud sea procesada.',
      footer: 'Este mensaje fue enviado automáticamente. No responda a este correo.',
    },
  },
  processed: {
    'pt-BR': {
      subject: 'Sua solicitação LGPD foi atendida',
      heading: 'Solicitação processada',
      body: 'Sua solicitação de <strong>{{requestType}}</strong> foi concluída em {{processedAt}}.',
      notes: 'Observações: {{notes}}',
      closing: 'Se tiver dúvidas, entre em contato com nossa equipe.',
      footer: 'Esta mensagem foi enviada automaticamente. Não responda a este e-mail.',
    },
    'en-US': {
      subject: 'Your LGPD request has been processed',
      heading: 'Request processed',
      body: 'Your <strong>{{requestType}}</strong> request was completed on {{processedAt}}.',
      notes: 'Notes: {{notes}}',
      closing: 'If you have any questions, please contact our team.',
      footer: 'This message was sent automatically. Do not reply to this email.',
    },
    es: {
      subject: 'Tu solicitud LGPD ha sido procesada',
      heading: 'Solicitud procesada',
      body: 'Tu solicitud de <strong>{{requestType}}</strong> fue completada el {{processedAt}}.',
      notes: 'Observaciones: {{notes}}',
      closing: 'Si tienes preguntas, comunícate con nuestro equipo.',
      footer: 'Este mensaje fue enviado automáticamente. No responda a este correo.',
    },
  },
  tenantNew: {
    'pt-BR': {
      subject: 'Nova solicitação LGPD recebida',
      heading: 'Nova solicitação LGPD',
      body: 'Uma nova solicitação de <strong>{{requestType}}</strong> foi recebida de <strong>{{subjectLabel}}</strong>.',
      sla: 'Prazo legal para atendimento: <strong>{{slaDeadline}}</strong> (15 dias).',
      cta: 'Ver solicitação',
      footer: 'Gerencie suas solicitações LGPD no painel administrativo.',
    },
    'en-US': {
      subject: 'New LGPD request received',
      heading: 'New LGPD request',
      body: 'A new <strong>{{requestType}}</strong> request was received from <strong>{{subjectLabel}}</strong>.',
      sla: 'Legal response deadline: <strong>{{slaDeadline}}</strong> (15 days).',
      cta: 'View request',
      footer: 'Manage your LGPD requests in the admin panel.',
    },
    es: {
      subject: 'Nueva solicitud LGPD recibida',
      heading: 'Nueva solicitud LGPD',
      body: 'Se recibió una nueva solicitud de <strong>{{requestType}}</strong> de <strong>{{subjectLabel}}</strong>.',
      sla: 'Plazo legal de respuesta: <strong>{{slaDeadline}}</strong> (15 días).',
      cta: 'Ver solicitud',
      footer: 'Gestiona tus solicitudes LGPD en el panel de administración.',
    },
  },
  warning: {
    'pt-BR': {
      subject: (d: number) => `⚠️ Solicitação LGPD vence em ${d} dia${d > 1 ? 's' : ''}`,
      heading: 'Prazo LGPD se aproximando',
      body: (d: number) =>
        `A solicitação de <strong>{{requestType}}</strong> de <strong>{{subjectLabel}}</strong> vence em <strong>${d} dia${d > 1 ? 's' : ''}</strong>.`,
      deadline: 'Data limite: <strong>{{slaDeadline}}</strong>',
      cta: 'Processar agora',
      footer: 'Não atender no prazo pode gerar penalidades conforme a LGPD.',
    },
    'en-US': {
      subject: (d: number) => `⚠️ LGPD request expires in ${d} day${d > 1 ? 's' : ''}`,
      heading: 'LGPD deadline approaching',
      body: (d: number) =>
        `The <strong>{{requestType}}</strong> request from <strong>{{subjectLabel}}</strong> expires in <strong>${d} day${d > 1 ? 's' : ''}</strong>.`,
      deadline: 'Deadline: <strong>{{slaDeadline}}</strong>',
      cta: 'Process now',
      footer: 'Failure to respond within the deadline may result in penalties under LGPD.',
    },
    es: {
      subject: (d: number) => `⚠️ Solicitud LGPD vence en ${d} día${d > 1 ? 's' : ''}`,
      heading: 'Plazo LGPD se acerca',
      body: (d: number) =>
        `La solicitud de <strong>{{requestType}}</strong> de <strong>{{subjectLabel}}</strong> vence en <strong>${d} día${d > 1 ? 's' : ''}</strong>.`,
      deadline: 'Fecha límite: <strong>{{slaDeadline}}</strong>',
      cta: 'Procesar ahora',
      footer: 'No responder en el plazo puede generar sanciones conforme a la LGPD.',
    },
  },
  breached: {
    'pt-BR': {
      subject: '🚨 SLA LGPD estourado',
      heading: 'SLA LGPD estourado — ação imediata necessária',
      body: '<strong>{{tenantName}}</strong> possui <strong>{{pendingCount}} solicitação(ões) LGPD</strong> com prazo legal expirado.',
      cta: 'Ver solicitações',
      footer: 'Regularize imediatamente para evitar penalidades conforme a LGPD.',
    },
    'en-US': {
      subject: '🚨 LGPD SLA breached',
      heading: 'LGPD SLA breached — immediate action required',
      body: '<strong>{{tenantName}}</strong> has <strong>{{pendingCount}} LGPD request(s)</strong> past the legal deadline.',
      cta: 'View requests',
      footer: 'Resolve immediately to avoid penalties under LGPD.',
    },
    es: {
      subject: '🚨 SLA LGPD superado',
      heading: 'SLA LGPD superado — acción inmediata requerida',
      body: '<strong>{{tenantName}}</strong> tiene <strong>{{pendingCount}} solicitud(es) LGPD</strong> con plazo legal vencido.',
      cta: 'Ver solicitudes',
      footer: 'Regulariza inmediatamente para evitar sanciones conforme a la LGPD.',
    },
  },
  rejected: {
    'pt-BR': {
      subject: 'Sua solicitação LGPD foi rejeitada',
      heading: 'Solicitação rejeitada',
      body: 'Sua solicitação de <strong>{{requestType}}</strong> foi analisada e <strong>rejeitada</strong> em {{rejectedAt}}.',
      reasonLabel: 'Motivo informado:',
      closing: 'Se precisar, você pode abrir uma nova solicitação com informações complementares.',
      footer: 'Esta mensagem foi enviada automaticamente. Não responda a este e-mail.',
    },
    'en-US': {
      subject: 'Your LGPD request has been rejected',
      heading: 'Request rejected',
      body: 'Your <strong>{{requestType}}</strong> request was reviewed and <strong>rejected</strong> on {{rejectedAt}}.',
      reasonLabel: 'Reason provided:',
      closing: 'If needed, you may submit a new request with additional information.',
      footer: 'This message was sent automatically. Do not reply to this email.',
    },
    es: {
      subject: 'Tu solicitud LGPD fue rechazada',
      heading: 'Solicitud rechazada',
      body: 'Tu solicitud de <strong>{{requestType}}</strong> fue revisada y <strong>rechazada</strong> el {{rejectedAt}}.',
      reasonLabel: 'Motivo indicado:',
      closing: 'Si lo necesitas, puedes abrir una nueva solicitud con información adicional.',
      footer: 'Este mensaje fue enviado automáticamente. No responda a este correo.',
    },
  },
} as const;

// ─── Layout helper ─────────────────────────────────────────────────────────────

function wrap(heading: string, bodyHtml: string, footerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="pt">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 24px 0; }
  .card { max-width: 560px; margin: 0 auto; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .header { background: #1c7a6e; padding: 28px 32px; }
  .header h1 { margin: 0; color: #fff; font-size: 20px; font-weight: 600; }
  .body { padding: 28px 32px; color: #374151; font-size: 15px; line-height: 1.6; }
  .body p { margin: 0 0 16px; }
  .cta { display: inline-block; margin: 8px 0 24px; background: #1c7a6e; color: #fff; text-decoration: none; padding: 11px 22px; border-radius: 6px; font-weight: 600; font-size: 14px; }
  .footer { padding: 16px 32px; background: #f9fafb; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 12px; }
  strong { color: #111827; }
</style>
</head>
<body>
<div class="card">
  <div class="header"><h1>${heading}</h1></div>
  <div class="body">${bodyHtml}</div>
  <div class="footer">${footerHtml}</div>
</div>
</body>
</html>`;
}

function fmt(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function resolveType(key: string, lang: Lang): string {
  const map = i18n.requestTypes[lang] as Record<string, string>;
  return map[key] ?? key;
}

// ─── Public render functions ────────────────────────────────────────────────

export function renderRequestReceived(p: RequestReceivedParams): EmailContent {
  const lang = p.lang ?? 'pt-BR';
  const s = i18n.received[lang];
  const type = resolveType(p.requestType, lang);

  const bodyHtml = `
    <p>${s.body.replace('{{requestType}}', type).replace('{{requestedAt}}', fmt(p.requestedAt))}</p>
    <p>${s.sla.replace('{{slaDeadline}}', fmt(p.slaDeadline))}</p>
    <p>${s.closing}</p>`;

  return {
    subject: s.subject,
    html: wrap(s.heading, bodyHtml, s.footer),
    text: `${s.heading}\n\n${type} — ${fmt(p.requestedAt)}\nPrazo: ${fmt(p.slaDeadline)}\n\n${s.closing}`,
  };
}

export function renderRequestProcessed(p: RequestProcessedParams): EmailContent {
  const lang = p.lang ?? 'pt-BR';
  const s = i18n.processed[lang];
  const type = resolveType(p.requestType, lang);

  const notesLine = p.notes ? `<p>${s.notes.replace('{{notes}}', p.notes)}</p>` : '';
  const bodyHtml = `
    <p>${s.body.replace('{{requestType}}', type).replace('{{processedAt}}', fmt(p.processedAt))}</p>
    ${notesLine}
    <p>${s.closing}</p>`;

  return {
    subject: s.subject,
    html: wrap(s.heading, bodyHtml, s.footer),
    text: `${s.heading}\n\n${type} — ${fmt(p.processedAt)}\n${p.notes ? `Obs: ${p.notes}\n` : ''}${s.closing}`,
  };
}

export function renderTenantNewRequest(p: TenantNewRequestParams): EmailContent {
  const lang = p.lang ?? 'pt-BR';
  const s = i18n.tenantNew[lang];
  const type = resolveType(p.requestType, lang);

  const bodyHtml = `
    <p>${s.body.replace('{{requestType}}', type).replace('{{subjectLabel}}', p.subjectLabel)}</p>
    <p>${s.sla.replace('{{slaDeadline}}', fmt(p.slaDeadline))}</p>
    <a class="cta" href="${p.dashboardUrl}">${s.cta}</a>`;

  return {
    subject: s.subject,
    html: wrap(s.heading, bodyHtml, s.footer),
    text: `${s.heading}\n\n${type} de ${p.subjectLabel}\nPrazo: ${fmt(p.slaDeadline)}\n${p.dashboardUrl}`,
  };
}

export function renderSlaWarning(p: SlaWarningParams): EmailContent {
  const lang = p.lang ?? 'pt-BR';
  const s = i18n.warning[lang];
  const type = resolveType(p.requestType, lang);

  const bodyHtml = `
    <p>${s.body(p.daysLeft).replace('{{requestType}}', type).replace('{{subjectLabel}}', p.subjectLabel)}</p>
    <p>${s.deadline.replace('{{slaDeadline}}', fmt(p.slaDeadline))}</p>
    <a class="cta" href="${p.dashboardUrl}">${s.cta}</a>`;

  return {
    subject: s.subject(p.daysLeft),
    html: wrap(s.heading, bodyHtml, s.footer),
    text: `${s.heading}\n\n${type} de ${p.subjectLabel}\nVence: ${fmt(p.slaDeadline)}\n${p.dashboardUrl}`,
  };
}

export function renderSlaBreached(p: SlaBreachedParams): EmailContent {
  const lang = p.lang ?? 'pt-BR';
  const s = i18n.breached[lang];

  const bodyHtml = `
    <p>${s.body.replace('{{tenantName}}', p.tenantName).replace('{{pendingCount}}', String(p.pendingCount))}</p>
    <a class="cta" href="${p.dashboardUrl}">${s.cta}</a>`;

  return {
    subject: s.subject,
    html: wrap(s.heading, bodyHtml, s.footer),
    text: `${s.heading}\n\n${p.tenantName}: ${p.pendingCount} solicitação(ões) atrasada(s)\n${p.dashboardUrl}`,
  };
}

export function renderRequestRejected(p: RequestRejectedParams): EmailContent {
  const lang = p.lang ?? 'pt-BR';
  const s = i18n.rejected[lang];
  const type = resolveType(p.requestType, lang);
  const escapedReason = p.reason
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const bodyHtml = `
    <p>${s.body.replace('{{requestType}}', type).replace('{{rejectedAt}}', fmt(p.rejectedAt))}</p>
    <p><strong>${s.reasonLabel}</strong> ${escapedReason}</p>
    <p>${s.closing}</p>`;

  return {
    subject: s.subject,
    html: wrap(s.heading, bodyHtml, s.footer),
    text: `${s.heading}\n\n${type} — ${fmt(p.rejectedAt)}\n${s.reasonLabel} ${p.reason}\n\n${s.closing}`,
  };
}
