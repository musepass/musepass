'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Counts a number up from zero when it first scrolls into view.
 *
 * It renders the final number on the server and until it is seen, so a
 * page without JavaScript (or a visitor who prefers reduced motion) just
 * sees the number.
 */
export function CountUp({ value, durationMs = 900 }: { value: number; durationMs?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;

    let frame = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - start) / durationMs);
          const eased = 1 - Math.pow(1 - progress, 3);
          setDisplay(Math.round(value * eased));
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value, durationMs]);

  return <span ref={ref}>{display.toLocaleString('en-US')}</span>;
}
