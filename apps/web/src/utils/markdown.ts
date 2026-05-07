function applyInlineMarkdown(text: string): string {
  const codeTokens: string[] = [];

  const withCodePlaceholders = text.replace(/`([^`]+)`/g, (_, code: string) => {
    const token = `__CODE_TOKEN_${codeTokens.length}__`;
    codeTokens.push(
      `<code>${code}</code>`,
    );
    return token;
  });

  const withLinks = withCodePlaceholders.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
  );

  const formatted = withLinks
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![a-zA-Z0-9])_(.+?)_(?![a-zA-Z0-9])/g, '<em>$1</em>')
    .replace(/~~(.+?)~~/g, '<del>$1</del>');

  return formatted.replace(/__CODE_TOKEN_(\d+)__/g, (_, index: string) => codeTokens[Number(index)] ?? '');
}

/**
 * Parse básico de markdown para HTML.
 * Suporta: **negrito**, _itálico_, ~~tachado~~, `código`, links, listas e citações.
 * Seguro contra XSS: escapa HTML antes de aplicar formatação.
 */
export function parseMarkdown(text: string): string {
  if (!text) return '';

  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const lines = escaped.split('\n');
  const html: string[] = [];
  let paragraphBuffer: string[] = [];
  let unorderedItems: string[] = [];
  let orderedItems: string[] = [];
  let quoteItems: string[] = [];

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    html.push(`<p>${applyInlineMarkdown(paragraphBuffer.join('<br>'))}</p>`);
    paragraphBuffer = [];
  };

  const flushUnordered = () => {
    if (!unorderedItems.length) return;
    html.push(`<ul>${unorderedItems.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join('')}</ul>`);
    unorderedItems = [];
  };

  const flushOrdered = () => {
    if (!orderedItems.length) return;
    html.push(`<ol>${orderedItems.map((item) => `<li>${applyInlineMarkdown(item)}</li>`).join('')}</ol>`);
    orderedItems = [];
  };

  const flushQuotes = () => {
    if (!quoteItems.length) return;
    html.push(`<blockquote>${quoteItems.map((item) => applyInlineMarkdown(item)).join('<br>')}</blockquote>`);
    quoteItems = [];
  };

  for (const line of lines) {
    const unorderedMatch = line.match(/^\s*-\s+(.+)$/);
    const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    const quoteMatch = line.match(/^\s*>\s?(.*)$/);

    if (unorderedMatch) {
      flushParagraph();
      flushOrdered();
      flushQuotes();
      unorderedItems.push(unorderedMatch[1] ?? '');
      continue;
    }

    if (orderedMatch) {
      flushParagraph();
      flushUnordered();
      flushQuotes();
      orderedItems.push(orderedMatch[1] ?? '');
      continue;
    }

    if (quoteMatch) {
      flushParagraph();
      flushUnordered();
      flushOrdered();
      quoteItems.push(quoteMatch[1] ?? '');
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushUnordered();
      flushOrdered();
      flushQuotes();
      continue;
    }

    flushUnordered();
    flushOrdered();
    flushQuotes();
    paragraphBuffer.push(line);
  }

  flushParagraph();
  flushUnordered();
  flushOrdered();
  flushQuotes();

  return html.join('');
}
