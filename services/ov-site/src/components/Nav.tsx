'use client';

import { useEffect, useState } from 'react';
import { nav } from '@/lib/site';
import { Arrow } from './primitives';

export function Wordmark() {
  return (
    <a href="#top" className="flex items-center gap-2.5" aria-label="Overwatch — back to top">
      <span className="pulse-dot" />
      <span className="wordmark text-[13px]">Overwatch</span>
    </a>
  );
}

export function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <header
      className={`sticky top-0 z-50 border-b transition-colors ${
        scrolled || open ? 'border-border bg-bg/85 backdrop-blur-md' : 'border-transparent bg-bg'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-site items-center justify-between px-5 sm:px-8 lg:px-12">
        <Wordmark />

        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-7">
            {nav.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  className="mono text-[11px] uppercase tracking-[0.08em] text-text-muted transition-colors hover:text-text"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center gap-3">
          <a href="#contact" className="btn btn-primary btn-sm hidden sm:inline-flex">
            Book a site survey <Arrow />
          </a>
          <button
            type="button"
            className="btn btn-sm lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Close' : 'Menu'}
          </button>
        </div>
      </div>

      <div
        id="mobile-nav"
        hidden={!open}
        className="fixed inset-x-0 bottom-0 top-16 z-40 overflow-y-auto border-t border-border bg-bg lg:hidden"
      >
        <ul className="px-5 sm:px-8">
          {nav.map((item, i) => (
            <li key={item.href} className="border-b border-border">
              <a
                href={item.href}
                onClick={() => setOpen(false)}
                className="flex items-center justify-between py-5 text-2xl font-medium tracking-tight"
              >
                {item.label}
                <span className="mono text-xs text-text-dim">0{i + 1}</span>
              </a>
            </li>
          ))}
        </ul>
        <div className="px-5 py-8 sm:px-8">
          <a href="#contact" onClick={() => setOpen(false)} className="btn btn-primary btn-lg w-full">
            Book a site survey <Arrow />
          </a>
        </div>
      </div>
    </header>
  );
}
