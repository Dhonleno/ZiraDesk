import {
  type MutableRefObject,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';

type Align = 'left' | 'right' | 'stretch';

interface AnchoredPopoverProps {
  /** Elemento ao qual o painel se alinha (o gatilho ou o wrapper dele). */
  anchorRef: RefObject<HTMLElement>;
  /** Recebe o nó portalizado — necessário para handlers de clique-fora,
   *  já que o painel deixa de ser descendente do gatilho no DOM. */
  popoverRef?: MutableRefObject<HTMLDivElement | null>;
  /** 'right' alinha a borda direita ao gatilho; 'stretch' copia a largura dele. */
  align?: Align;
  gap?: number;
  className?: string;
  children: ReactNode;
}

const VIEWPORT_MARGIN = 8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

/**
 * Painel flutuante renderizado no `body` via portal e posicionado por
 * coordenadas de viewport.
 *
 * Existe porque `position: absolute` é recortado por qualquer ancestral com
 * `overflow` não-visível — o corpo do `Modal` (`overflowY: auto`), o dialog
 * (`overflow: hidden`) e os painéis laterais do omnichannel. z-index não
 * resolve: recorte por overflow não é problema de empilhamento.
 */
export function AnchoredPopover({
  anchorRef,
  popoverRef,
  align = 'right',
  gap = 8,
  className,
  children,
}: AnchoredPopoverProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node;
      if (popoverRef) popoverRef.current = node;
    },
    [popoverRef],
  );

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = innerRef.current;
    if (!anchor || !panel) return;

    const rect = anchor.getBoundingClientRect();
    if (align === 'stretch') panel.style.width = `${rect.width}px`;

    // Medido depois de aplicar a largura — a altura depende dela.
    const height = panel.offsetHeight;
    const width = panel.offsetWidth;

    const roomBelow = window.innerHeight - rect.bottom - gap - VIEWPORT_MARGIN;
    const roomAbove = rect.top - gap - VIEWPORT_MARGIN;
    // Só inverte se de fato não couber embaixo E houver mais espaço em cima.
    const openUpward = height > roomBelow && roomAbove > roomBelow;

    const top = openUpward ? rect.top - gap - height : rect.bottom + gap;
    const left = align === 'right' ? rect.right - width : rect.left;

    panel.style.top = `${clamp(top, VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN)}px`;
    panel.style.left = `${clamp(left, VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN)}px`;
    panel.style.visibility = 'visible';
  }, [align, anchorRef, gap]);

  useLayoutEffect(() => {
    updatePosition();

    // O conteúdo costuma chegar por query depois da montagem: sem observar o
    // próprio painel, a decisão de flip ficaria presa à altura do estado vazio.
    const observer = new ResizeObserver(updatePosition);
    if (innerRef.current) observer.observe(innerRef.current);

    window.addEventListener('resize', updatePosition);
    // capture: o gatilho pode estar dentro de qualquer scroller intermediário.
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [updatePosition]);

  return createPortal(
    <div
      ref={setRefs}
      className={className ? `anchored-popover ${className}` : 'anchored-popover'}
      // top/left definidos no layout effect; oculto até lá para não piscar em (0,0).
      style={{ position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}
