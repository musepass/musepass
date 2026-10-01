'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Marks a block as a scroll reveal. Adds `.is-visible` when it enters the
 * viewport, once.
 *
 * The hidden start state lives in CSS behind `html.motion` (set by the
 * inline script in the layout), so a page without JavaScript is never
 * blank — the block is simply always visible.
 *
 * `stagger` moves the effect onto the direct children instead of the block
 * itself, one after another; pair it with `className` when the block is a
 * grid (`three-grid`, `pricing-grid`, `faq`, `steps`, `chat`).
 */
export function Reveal({
  children,
  className = '',
  stagger = false,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  stagger?: boolean;
  /** Use `ol` when the reveal is a list, so `li` children stay valid HTML. */
  as?: 'div' | 'ol';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const base = stagger ? 'reveal-children' : 'reveal';
  // Cast keeps the ref typing simple; `as="ol"` still renders an ol.
  const Tag = as as 'div';

  return (
    <Tag ref={ref} className={`${base}${visible ? ' is-visible' : ''}${className ? ` ${className}` : ''}`}>
      {children}
    </Tag>
  );
}
