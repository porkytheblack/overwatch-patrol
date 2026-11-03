import type { ReactNode } from 'react';

/** Four 10px amber brackets in the corners of the nearest positioned parent. */
export function Corners({ className = 'border-accent', size = 10 }: { className?: string; size?: number }) {
  const s = { width: size, height: size };
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      <span style={s} className={`absolute -left-px -top-px border-l border-t ${className}`} />
      <span style={s} className={`absolute -right-px -top-px border-r border-t ${className}`} />
      <span style={s} className={`absolute -bottom-px -left-px border-b border-l ${className}`} />
      <span style={s} className={`absolute -bottom-px -right-px border-b border-r ${className}`} />
    </span>
  );
}

/** “+” marks where a section's top edge meets the page's vertical guide lines. */
export function RegMarks() {
  return (
    <>
      <span aria-hidden className="reg -left-[5px] -top-[5px]" />
      <span aria-hidden className="reg -right-[5px] -top-[5px]" />
    </>
  );
}

/**
 * Page section. Lives inside the bordered page frame, so each one draws a
 * top hairline and gets registration marks on the guide lines.
 */
export function Section({
  id,
  children,
  className = '',
  bare = false,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  bare?: boolean;
}) {
  return (
    <section id={id} className={`relative border-t border-border ${className}`}>
      <RegMarks />
      {bare ? children : <div className="px-5 py-20 sm:px-8 md:py-28 lg:px-12">{children}</div>}
    </section>
  );
}

export function SectionHeader({
  index,
  label,
  title,
  lede,
  align = 'split',
}: {
  index: string;
  label: string;
  title: ReactNode;
  lede?: ReactNode;
  align?: 'split' | 'stack';
}) {
  return (
    <div
      className={
        align === 'split'
          ? 'grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-end lg:gap-12'
          : 'flex max-w-3xl flex-col gap-6'
      }
    >
      <div className={align === 'split' ? 'lg:col-span-7' : ''} data-reveal>
        <p className="eyebrow mb-6">
          <span className="text-accent">{index}</span>
          <span className="h-px w-6 bg-border-strong" />
          {label}
        </p>
        <h2 className="h-section text-balance">{title}</h2>
      </div>
      {lede ? (
        <p
          className={`lede text-pretty ${align === 'split' ? 'lg:col-span-5 lg:pb-1' : ''}`}
          data-reveal
          style={{ ['--reveal-delay' as string]: '120ms' }}
        >
          {lede}
        </p>
      ) : null}
    </div>
  );
}

export function Arrow({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" width="14" height="14" className={`arrow ${className}`}>
      <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

export function Check({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" width="14" height="14" className={className}>
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

export function Plus({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 12 12" width="10" height="10" className={className}>
      <path d="M6 1v10M1 6h10" fill="none" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}
