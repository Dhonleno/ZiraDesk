import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { prisma } from '../../../config/database.js';

// ─── SQL injection guard (same pattern as campaigns.service.ts) ───────────────
function quoteIdent(identifier: string): string {
  return '"' + identifier.replace(/"/g, '""') + '"';
}

// ─── Asset resolution (ESM-safe: works in both src/ and dist/) ───────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// From src/modules/omnichannel/campaigns/ (or dist/…), 4 ups = apps/api root
const API_ROOT = path.resolve(__dirname, '../../../../');
// 5 ups = apps/, then web/
const WEB_PUBLIC = path.resolve(__dirname, '../../../../../web/public');

function getLogoPath(): string | null {
  const p = path.join(WEB_PUBLIC, 'icon-192.png');
  return fs.existsSync(p) ? p : null;
}

function getTenantLogoPath(tenantId: string): string | null {
  const p = path.join(API_ROOT, 'public', 'uploads', 'logos', `${tenantId}.png`);
  return fs.existsSync(p) ? p : null;
}

// ─── Paleta (tema claro — legível em papel) ───────────────────────────────────
const C = {
  bg:      '#FFFFFF',
  surface: '#F4F6F9',
  border:  '#E8EAED',
  text:    '#14171C',
  muted:   '#54606E',
  teal:    '#00A88C',
  green:   '#16A06B',
  blue:    '#2563EB',
  amber:   '#B7791F',
  red:     '#DC2F4E',
} as const;

// ─── Helpers de cor ───────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function fill(doc: PDFKit.PDFDocument, hex: string): void {
  doc.fillColor(hexToRgb(hex));
}

function strokeColor(doc: PDFKit.PDFDocument, hex: string): void {
  doc.strokeColor(hexToRgb(hex));
}

// ─── Layout constants ─────────────────────────────────────────────────────────
const MARGIN    = 40;
const PAGE_W    = 595.28;
const PAGE_H    = 841.89;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ─── Helpers de layout ────────────────────────────────────────────────────────
const pageNumbers = new WeakMap<PDFKit.PDFDocument, { current: number }>();

function trackPageNumbers(doc: PDFKit.PDFDocument): void {
  pageNumbers.set(doc, { current: 1 });
  doc.on('pageAdded', () => {
    const state = pageNumbers.get(doc);
    if (state) state.current++;
  });
}

function currentPageNumber(doc: PDFKit.PDFDocument): number {
  return pageNumbers.get(doc)?.current ?? 1;
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > PAGE_H - MARGIN - 60) {
    drawPageFooter(doc, currentPageNumber(doc));
    doc.addPage();
  }
}

function drawHRule(doc: PDFKit.PDFDocument, y: number): void {
  strokeColor(doc, C.border);
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).stroke();
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string): void {
  doc.moveDown(0.6);
  ensureSpace(doc, 30);
  fill(doc, C.teal);
  doc.font('Helvetica-Bold').fontSize(8).text(title.toUpperCase(), MARGIN, doc.y, {
    characterSpacing: 1,
  });
  doc.moveDown(0.4);
  drawHRule(doc, doc.y);
  doc.moveDown(0.5);
}

function labelValue(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  colW: number,
): void {
  fill(doc, C.muted);
  doc.font('Helvetica').fontSize(8).text(label, x, y, { width: colW });
  fill(doc, C.text);
  doc.font('Helvetica-Bold').fontSize(9).text(value || '—', x, y + 11, { width: colW });
}

function formatDate(value: unknown): string {
  if (!value) return '—';
  try {
    return new Date(value as string).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function fmtPct(part: number, total: number): string {
  if (!total) return '0%';
  return `${Math.round((part / total) * 100)}%`;
}

// ─── Header (logo + título + data de geração) ─────────────────────────────────
function drawHeader(
  doc: PDFKit.PDFDocument,
  campaignName: string,
  tenantName: string,
  tenantId: string,
): void {
  const logoPath = getLogoPath();
  const tenantLogoPath = getTenantLogoPath(tenantId);

  if (logoPath) {
    try { doc.image(logoPath, MARGIN, MARGIN - 5, { width: 32, height: 32 }); } catch { /* skip */ }
  }

  fill(doc, C.text);
  doc.font('Helvetica-Bold').fontSize(14).text('ZiraDesk', MARGIN + 40, MARGIN);
  fill(doc, C.muted);
  doc.font('Helvetica').fontSize(9).text(`Relatório de Campanha — ${tenantName}`, MARGIN + 40, MARGIN + 17);

  if (tenantLogoPath) {
    try {
      doc.image(tenantLogoPath, PAGE_W - MARGIN - 40, MARGIN - 5, { fit: [40, 40] });
    } catch { /* skip */ }
  }

  const now = new Date().toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  fill(doc, C.muted);
  doc.font('Helvetica').fontSize(7).text(`Gerado em ${now}`, MARGIN, MARGIN + 33, {
    width: CONTENT_W,
    align: 'right',
  });

  doc.moveDown(2.2);
  fill(doc, C.text);
  doc.font('Helvetica-Bold').fontSize(18).text(campaignName, MARGIN, doc.y);
  doc.moveDown(0.3);
  drawHRule(doc, doc.y);
  doc.moveDown(0.8);
}

// ─── Footer ──────────────────────────────────────────────────────────────────
function drawPageFooter(doc: PDFKit.PDFDocument, pageNum: number): void {
  const y = PAGE_H - 38;
  const prevX = doc.x;
  const prevY = doc.y;
  const prevBottomMargin = doc.page.margins.bottom;

  doc.page.margins.bottom = 20;
  strokeColor(doc, C.border);
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).stroke();
  fill(doc, C.muted);
  doc.font('Helvetica').fontSize(7);
  doc.text(
    'ZiraDesk — Plataforma de Atendimento Omnichannel',
    MARGIN,
    y + 6,
    { width: CONTENT_W / 2, lineBreak: false },
  );
  doc.text(
    `Página ${pageNum}`,
    MARGIN + CONTENT_W / 2,
    y + 6,
    { width: CONTENT_W / 2, align: 'right', lineBreak: false },
  );
  doc.page.margins.bottom = prevBottomMargin;
  doc.x = prevX;
  doc.y = prevY;
}

// ─── Seção 1: Informações da campanha ─────────────────────────────────────────
function drawCampaignInfo(doc: PDFKit.PDFDocument, camp: Record<string, unknown>): void {
  sectionTitle(doc, 'Informações da Campanha');

  const colW = CONTENT_W / 3 - 8;

  const row1Y = doc.y;
  labelValue(doc, 'Canal', String(camp.channel_name ?? '—'), MARGIN, row1Y, colW);
  labelValue(doc, 'Template', String(camp.template_name ?? '—'), MARGIN + colW + 8, row1Y, colW);
  labelValue(doc, 'Criado por', String(camp.created_by_name ?? '—'), MARGIN + (colW + 8) * 2, row1Y, colW);

  const row2Y = row1Y + 26;
  labelValue(doc, 'Agendado para', formatDate(camp.scheduled_at), MARGIN, row2Y, colW);
  labelValue(doc, 'Iniciado em', formatDate(camp.started_at), MARGIN + colW + 8, row2Y, colW);
  labelValue(doc, 'Concluído em', formatDate(camp.completed_at), MARGIN + (colW + 8) * 2, row2Y, colW);

  const row3Y = row2Y + 26;
  labelValue(doc, 'Limite diário', `${String(camp.daily_limit)} disparos`, MARGIN, row3Y, colW);
  labelValue(doc, 'Status', String(camp.status ?? '—').toUpperCase(), MARGIN + colW + 8, row3Y, colW);
  if (camp.notes) {
    labelValue(doc, 'Notas', String(camp.notes), MARGIN + (colW + 8) * 2, row3Y, colW);
  }

  doc.y = row3Y + 30;
}

// ─── Seção 2: Métricas gerais ─────────────────────────────────────────────────
function drawMetrics(doc: PDFKit.PDFDocument, camp: Record<string, unknown>): void {
  sectionTitle(doc, 'Métricas Gerais');
  ensureSpace(doc, 80);

  const total   = Number(camp.total_contacts ?? 0);
  const sent    = Number(camp.sent_count ?? 0);
  const deliv   = Number(camp.delivered_count ?? 0);
  const read    = Number(camp.read_count ?? 0);
  const replied = Number(camp.replied_count ?? 0);
  const failed  = Number(camp.failed_count ?? 0);

  const metrics = [
    { label: 'Total',       value: total,   color: C.text,  pctOf: null as number | null },
    { label: 'Enviados',    value: sent,    color: C.text,  pctOf: total },
    { label: 'Entregues',   value: deliv,   color: C.green, pctOf: sent },
    { label: 'Lidos',       value: read,    color: C.blue,  pctOf: sent },
    { label: 'Respondidos', value: replied, color: C.teal,  pctOf: sent },
    { label: 'Falhos',      value: failed,  color: C.red,   pctOf: total },
  ];

  const boxW  = CONTENT_W / metrics.length - 4;
  const boxH  = 56;
  const startY = doc.y;

  metrics.forEach((m, i) => {
    const x = MARGIN + i * (boxW + 4);

    fill(doc, C.surface);
    doc.roundedRect(x, startY, boxW, boxH, 4).fill();

    fill(doc, C.muted);
    doc.font('Helvetica').fontSize(7).text(m.label.toUpperCase(), x + 8, startY + 8, {
      width: boxW - 16,
      characterSpacing: 0.5,
    });

    fill(doc, m.color);
    doc.font('Helvetica-Bold').fontSize(20).text(String(m.value), x + 8, startY + 18, {
      width: boxW - 16,
    });

    if (m.pctOf !== null) {
      fill(doc, C.muted);
      doc.font('Helvetica').fontSize(8).text(fmtPct(m.value, m.pctOf), x + 8, startY + 40, {
        width: boxW - 16,
      });
    }

    // Track + progress bar (use rect fill, not stroke, to avoid fillColor/strokeColor confusion)
    const barY = startY + boxH - 5;
    fill(doc, C.border);
    doc.rect(x, barY, boxW, 3).fill();
    if (m.pctOf) {
      const ratio = m.pctOf > 0 ? m.value / m.pctOf : 0;
      if (ratio > 0) {
        fill(doc, m.color);
        doc.rect(x, barY, boxW * ratio, 3).fill();
      }
    }
  });

  doc.y = startY + boxH + 12;
}

// ─── Seção 3: Funil de entrega ────────────────────────────────────────────────
function drawFunnel(doc: PDFKit.PDFDocument, camp: Record<string, unknown>): void {
  sectionTitle(doc, 'Funil de Entrega');
  ensureSpace(doc, 90);

  const total   = Number(camp.total_contacts ?? 0);
  const sent    = Number(camp.sent_count ?? 0);
  const deliv   = Number(camp.delivered_count ?? 0);
  const read    = Number(camp.read_count ?? 0);
  const replied = Number(camp.replied_count ?? 0);

  const steps = [
    { label: 'Enviados',    value: sent,    color: C.text },
    { label: 'Entregues',   value: deliv,   color: C.green },
    { label: 'Lidos',       value: read,    color: C.blue },
    { label: 'Respondidos', value: replied, color: C.teal },
  ];

  const labelColW = 80;
  const valueColW = 60;
  const barColW   = CONTENT_W - labelColW - valueColW - 16;
  const barH      = 10;
  const rowGap    = 22;
  const startY    = doc.y;

  steps.forEach((step, i) => {
    const y = startY + i * rowGap;

    fill(doc, C.muted);
    doc.font('Helvetica').fontSize(8).text(step.label, MARGIN, y + 1, {
      width: labelColW,
      align: 'right',
    });

    const barX = MARGIN + labelColW + 8;

    // Track
    fill(doc, C.border);
    doc.roundedRect(barX, y, barColW, barH, 3).fill();

    // Fill
    const ratio = total > 0 ? step.value / total : 0;
    if (ratio > 0) {
      fill(doc, step.color);
      doc.roundedRect(barX, y, Math.max(barColW * ratio, 6), barH, 3).fill();
    }

    fill(doc, C.text);
    doc.font('Helvetica-Bold').fontSize(8).text(
      `${step.value}  ${fmtPct(step.value, total)}`,
      barX + barColW + 8,
      y + 1,
      { width: valueColW },
    );
  });

  doc.y = startY + steps.length * rowGap + 8;
}

// ─── Seção 4: Breakdown por dia ───────────────────────────────────────────────
function drawBreakdown(
  doc: PDFKit.PDFDocument,
  breakdown: Array<Record<string, unknown>>,
): void {
  if (breakdown.length === 0) return;
  sectionTitle(doc, 'Breakdown por Dia');

  const cols = ['Data', 'Enviados', 'Entregues', 'Lidos', 'Respondidos', 'Falhos'];
  const colW  = CONTENT_W / cols.length;
  const rowH  = 18;

  ensureSpace(doc, rowH + 4);

  // Header
  const headerY = doc.y;
  fill(doc, C.surface);
  doc.rect(MARGIN, headerY, CONTENT_W, rowH).fill();

  cols.forEach((col, i) => {
    fill(doc, C.muted);
    doc.font('Helvetica-Bold').fontSize(7).text(
      col.toUpperCase(),
      MARGIN + i * colW + 4,
      headerY + 5,
      { width: colW - 8, align: i === 0 ? 'left' : 'right' },
    );
  });
  doc.y = headerY + rowH;

  // Rows
  breakdown.forEach((row, idx) => {
    ensureSpace(doc, rowH);
    const rowY = doc.y;

    if (idx % 2 === 0) {
      fill(doc, '#FAFBFC');
      doc.rect(MARGIN, rowY, CONTENT_W, rowH).fill();
    }

    const values = [
      String(row.date ?? ''),
      String(row.sent ?? 0),
      String(row.delivered ?? 0),
      String(row.read ?? 0),
      String(row.replied ?? 0),
      String(row.failed ?? 0),
    ];

    values.forEach((val, i) => {
      fill(doc, i === 5 && Number(row.failed) > 0 ? C.red : (i === 0 ? C.muted : C.text));
      doc.font(i === 0 ? 'Helvetica' : 'Helvetica-Bold').fontSize(8).text(
        val,
        MARGIN + i * colW + 4,
        rowY + 4,
        { width: colW - 8, align: i === 0 ? 'left' : 'right' },
      );
    });

    doc.y = rowY + rowH;
    drawHRule(doc, doc.y);
  });

  doc.moveDown(1);
}

// ─── Seção 5: Tabela de contatos ──────────────────────────────────────────────
function drawContacts(
  doc: PDFKit.PDFDocument,
  contacts: Array<Record<string, unknown>>,
): void {
  if (contacts.length === 0) return;
  sectionTitle(doc, `Contatos (${contacts.length})`);

  const cols = [
    { label: 'Nome',     w: 140, align: 'left'  as const },
    { label: 'Telefone', w: 90,  align: 'left'  as const },
    { label: 'Status',   w: 65,  align: 'left'  as const },
    { label: 'Enviado',  w: 80,  align: 'right' as const },
    { label: 'Entregue', w: 80,  align: 'right' as const },
    { label: 'Erro',     w: 60,  align: 'left'  as const },
  ];
  const rowH = 16;

  const statusColor: Record<string, string> = {
    sent:      C.text,
    delivered: C.green,
    read:      C.blue,
    replied:   C.teal,
    failed:    C.red,
    pending:   C.muted,
    queued:    C.muted,
    opted_out: C.muted,
  };

  function truncate(text: string, maxChars: number, maxWidth?: number): string {
    let value = text.length <= maxChars ? text : text.slice(0, maxChars - 1) + '…';
    if (!maxWidth) return value;

    doc.font('Helvetica').fontSize(7);
    while (value.length > 1 && doc.widthOfString(value) > maxWidth) {
      value = value.slice(0, -2) + '…';
    }
    return value;
  }

  // Header
  ensureSpace(doc, rowH + 4);
  const headerY = doc.y;
  fill(doc, C.surface);
  doc.rect(MARGIN, headerY, CONTENT_W, rowH).fill();

  let xCursor = MARGIN;
  cols.forEach((col) => {
    fill(doc, C.muted);
    doc.font('Helvetica-Bold').fontSize(7).text(
      col.label.toUpperCase(),
      xCursor + 4,
      headerY + 4,
      { width: col.w - 8, align: col.align },
    );
    xCursor += col.w;
  });
  doc.y = headerY + rowH;

  // Rows
  contacts.forEach((cc, idx) => {
    ensureSpace(doc, rowH);
    const rowY = doc.y;

    if (idx % 2 === 0) {
      fill(doc, '#FAFBFC');
      doc.rect(MARGIN, rowY, CONTENT_W, rowH).fill();
    }

    const status = String(cc.status ?? '');
    const errorColWidth = (cols[5]?.w ?? 60) - 8;
    const values = [
      { val: String(cc.contact_name ?? '—'), color: C.text },
      { val: String(cc.contact_phone ?? '—'), color: C.muted },
      { val: status, color: statusColor[status] ?? C.text },
      { val: cc.sent_at ? formatDate(cc.sent_at).slice(0, 10) : '—', color: C.muted },
      { val: cc.delivered_at ? formatDate(cc.delivered_at).slice(0, 10) : '—', color: C.muted },
      { val: truncate(String(cc.error_message ?? ''), 38, errorColWidth), color: C.red },
    ];

    xCursor = MARGIN;
    values.forEach((v, i) => {
      const col = cols[i];
      if (!col) return;
      fill(doc, v.color);
      doc.font('Helvetica').fontSize(7).text(
        v.val,
        xCursor + 4,
        rowY + 4,
        { width: col.w - 8, align: col.align, height: rowH - 8, lineBreak: false },
      );
      xCursor += col.w;
    });

    doc.y = rowY + rowH;
    drawHRule(doc, doc.y);
  });
}

// ─── Função principal exportada ───────────────────────────────────────────────
export async function exportCampaignPdf(
  campaignId: string,
  schemaName: string,
  tenantId: string,
): Promise<Buffer> {
  const schema = quoteIdent(schemaName);

  // Fetch tenant name (request.tenant not available in campaigns guard)
  const tenantRow = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { name: true },
  });
  const tenantName = tenantRow?.name ?? '';

  // Query 1: campaign info
  const campRows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT
       c.*,
       ch.name AS channel_name,
       wt.name AS template_name,
       u.name  AS created_by_name
     FROM ${schema}.campaigns c
     LEFT JOIN ${schema}.channels ch ON ch.id = c.channel_id
     LEFT JOIN ${schema}.whatsapp_templates wt ON wt.id = c.template_id
     LEFT JOIN ${schema}.users u ON u.id = c.created_by
     WHERE c.id = $1::uuid`,
    campaignId,
  );
  const camp = campRows[0];
  if (!camp) throw new Error('Campaign not found');

  // Query 2: breakdown by day
  const breakdown = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT
       DATE(COALESCE(sent_at, failed_at, created_at) AT TIME ZONE 'America/Sao_Paulo')::text AS date,
       COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::int AS sent,
       COUNT(*) FILTER (WHERE status IN ('delivered','read','replied'))::int AS delivered,
       COUNT(*) FILTER (WHERE status IN ('read','replied'))::int AS read,
       COUNT(*) FILTER (WHERE status = 'replied')::int AS replied,
       COUNT(*) FILTER (WHERE status = 'failed')::int AS failed
     FROM ${schema}.campaign_contacts
     WHERE campaign_id = $1::uuid AND (sent_at IS NOT NULL OR failed_at IS NOT NULL)
     GROUP BY 1 ORDER BY 1`,
    campaignId,
  );

  // Query 3: all contacts (full export, no pagination)
  const contacts = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT
       cc.status, cc.sent_at, cc.delivered_at, cc.read_at,
       cc.replied_at, cc.failed_at, cc.error_message,
       c.name AS contact_name,
       COALESCE(c.whatsapp, c.phone) AS contact_phone
     FROM ${schema}.campaign_contacts cc
     JOIN ${schema}.contacts c ON c.id = cc.contact_id
     WHERE cc.campaign_id = $1::uuid
     ORDER BY cc.created_at ASC`,
    campaignId,
  );

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGIN, bottom: 60, left: MARGIN, right: MARGIN },
    });

    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    trackPageNumbers(doc);

    drawHeader(doc, String(camp.name), tenantName, tenantId);
    drawCampaignInfo(doc, camp);
    drawMetrics(doc, camp);
    drawFunnel(doc, camp);
    drawBreakdown(doc, breakdown);
    drawContacts(doc, contacts);

    drawPageFooter(doc, currentPageNumber(doc));
    doc.end();
  });
}
