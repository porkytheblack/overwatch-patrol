'use client';

import { useEffect } from 'react';

/**
 * One observer for the whole page: any element with `data-reveal` fades up
 * the first time it scrolls into view. CSS only hides those elements under
 * html[data-js], which an inline script in <head> sets before first paint, so
 * the page is fully visible without JS.
 */
export function RevealObserver() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => (el.dataset.shown = 'true'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            (e.target as HTMLElement).dataset.shown = 'true';
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
